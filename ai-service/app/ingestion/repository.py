"""All SQL for the ingestion service (psycopg 3, plain SQL; Flyway in the backend owns the schema)."""
from __future__ import annotations

import psycopg
from psycopg.rows import dict_row

from app.core.config import settings
from app.ingestion.cleaning import content_hash


def _conn() -> psycopg.Connection:
    return psycopg.connect(settings.database_url, row_factory=dict_row)


def create_source(owner_id: str, kind: str, title: str, topic_query: str | None = None) -> str:
    with _conn() as conn:
        row = conn.execute(
            "INSERT INTO sources (owner_id, kind, title, topic_query) "
            "VALUES (%s::uuid, %s, %s, %s) RETURNING id",
            (owner_id, kind, title[:255], topic_query),
        ).fetchone()
    return str(row["id"])


def set_status(source_id: str, status: str, error: str | None = None) -> None:
    with _conn() as conn:
        conn.execute(
            "UPDATE sources SET status = %s, error_message = %s WHERE id = %s::uuid",
            (status, error[:500] if error else None, source_id),
        )


def add_document(source_id: str, *, url: str | None, filename: str | None, title: str, raw_text: str) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT INTO source_documents (source_id, url, filename, title, content_hash, raw_text, char_count) "
            "VALUES (%s::uuid, %s, %s, %s, %s, %s, %s)",
            (source_id, url, filename, title[:500], content_hash(raw_text), raw_text, len(raw_text)),
        )


def list_sources(owner_id: str | None) -> list[dict]:
    sql = (
        "SELECT s.id, s.kind, s.title, s.topic_query, s.status, s.error_message, s.created_at, "
        "COUNT(d.id) AS documents, COALESCE(SUM(d.char_count), 0) AS chars "
        "FROM sources s LEFT JOIN source_documents d ON d.source_id = s.id "
        "{where} GROUP BY s.id ORDER BY s.created_at DESC LIMIT 100"
    )
    with _conn() as conn:
        if owner_id:
            return conn.execute(sql.format(where="WHERE s.owner_id = %s::uuid"), (owner_id,)).fetchall()
        return conn.execute(sql.format(where="")).fetchall()


def get_source(source_id: str) -> dict | None:
    with _conn() as conn:
        src = conn.execute(
            "SELECT id, owner_id, kind, title, topic_query, status, error_message, created_at "
            "FROM sources WHERE id = %s::uuid", (source_id,)
        ).fetchone()
        if not src:
            return None
        src["documents"] = conn.execute(
            "SELECT id, url, filename, title, retrieved_at, char_count "
            "FROM source_documents WHERE source_id = %s::uuid ORDER BY retrieved_at, title", (source_id,)
        ).fetchall()
    return src


def delete_source(source_id: str) -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM sources WHERE id = %s::uuid", (source_id,))


def find_ready_topic_source(owner_id: str, topic: str) -> str | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM sources WHERE owner_id = %s::uuid AND kind = 'TOPIC' AND status = 'READY' "
            "AND lower(topic_query) = lower(%s) ORDER BY created_at DESC LIMIT 1", (owner_id, topic)
        ).fetchone()
    return str(row["id"]) if row else None


def count_topic_searches_this_month() -> int:
    """Each new TOPIC source = one web search (reusing saved sources creates no row)."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM sources WHERE kind = 'TOPIC' AND created_at >= date_trunc('month', now())"
        ).fetchone()
    return int(row["n"])
