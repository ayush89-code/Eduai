"""Step 5 - pgvector persistence and retrieval (matches V1/V2/V3 schema).

Tables used:
  source_documents(id, source_id, url, filename, title, retrieved_at, raw_text,
                   embed_status, embed_error, chunk_count, indexed_at)
  chunks(id, source_id, source_document_id, chunk_index, content, token_count,
         embedding vector(384), embedding_model)
"""
import uuid
from typing import Any

import numpy as np
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.core.config import settings


def _dsn() -> str:
    url = settings.database_url
    # tolerate SQLAlchemy / JDBC style prefixes if compose passes one
    for prefix in ("postgresql+psycopg://", "postgresql+psycopg2://", "jdbc:postgresql://"):
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix):]
    return url


def _configure(conn) -> None:
    register_vector(conn)
    conn.commit()  # leave the pooled connection idle


_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            _dsn(),
            min_size=1,
            max_size=5,
            configure=_configure,
            kwargs={"row_factory": dict_row},
            open=True,
        )
    return _pool


# ---- documents -----------------------------------------------------------

def list_documents(source_id: uuid.UUID) -> list[dict]:
    with get_pool().connection() as conn:
        return conn.execute(
            """SELECT id, embed_status, embed_error, chunk_count
                 FROM source_documents
                WHERE source_id = %s
                ORDER BY retrieved_at, id""",
            (source_id,),
        ).fetchall()


def get_document(doc_id: uuid.UUID) -> dict | None:
    with get_pool().connection() as conn:
        return conn.execute(
            "SELECT id, source_id, raw_text FROM source_documents WHERE id = %s",
            (doc_id,),
        ).fetchone()


def set_status(doc_id: uuid.UUID, status: str, *, error: str | None = None,
               chunk_count: int | None = None) -> None:
    with get_pool().connection() as conn:
        conn.execute(
            """UPDATE source_documents
                  SET embed_status = %s,
                      embed_error  = %s,
                      chunk_count  = COALESCE(%s, chunk_count),
                      indexed_at   = CASE WHEN %s = 'indexed' THEN now() ELSE indexed_at END
                WHERE id = %s""",
            (status, error, chunk_count, status, doc_id),
        )


# ---- chunks --------------------------------------------------------------

def replace_chunks(doc_id: uuid.UUID, source_id: uuid.UUID, chunks: list,
                   vectors: np.ndarray, model_name: str) -> int:
    """Idempotent: delete the document's old chunks and insert the new set atomically."""
    with get_pool().connection() as conn:
        with conn.transaction():
            conn.execute("DELETE FROM chunks WHERE source_document_id = %s", (doc_id,))
            with conn.cursor() as cur:
                cur.executemany(
                    """INSERT INTO chunks
                         (source_id, source_document_id, chunk_index, content,
                          token_count, embedding, embedding_model)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    [
                        (source_id, doc_id, c.index, c.text, c.token_count, vectors[i], model_name)
                        for i, c in enumerate(chunks)
                    ],
                )
    return len(chunks)


def search(query_vec: np.ndarray, top_k: int, source_id: uuid.UUID | None,
           doc_ids: list[uuid.UUID] | None) -> list[dict]:
    clauses: list[str] = []
    filter_params: list[Any] = []
    if source_id is not None:
        clauses.append("c.source_id = %s")
        filter_params.append(source_id)
    if doc_ids:
        clauses.append("c.source_document_id = ANY(%s)")
        filter_params.append(doc_ids)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    sql = f"""
        SELECT c.id, c.source_id, c.source_document_id, c.chunk_index, c.content,
               1 - (c.embedding <=> %s::vector) AS score,
               COALESCE(sd.url, sd.filename) AS citation_ref,
               sd.title, sd.retrieved_at
          FROM chunks c
          JOIN source_documents sd ON sd.id = c.source_document_id
          {where}
         ORDER BY c.embedding <=> %s::vector
         LIMIT %s
    """
    params = [query_vec, *filter_params, query_vec, top_k]
    with get_pool().connection() as conn:
        with conn.transaction():
            conn.execute("SET LOCAL hnsw.ef_search = 100")
            return conn.execute(sql, params).fetchall()
