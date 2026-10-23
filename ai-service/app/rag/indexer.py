"""Step 5 - chunk + embed + store.

Shared by the /api/rag endpoints and by automatic indexing after ingestion
(ingestion/service.py calls auto_index_source once a source is READY).
"""
import logging
from uuid import UUID

from app.rag import repository as repo
from app.rag.chunker import chunk_text
from app.rag.embedder import MODEL_NAME, embed_texts

log = logging.getLogger("eduai.rag")


def queue_source(source_id: UUID, force: bool = False) -> list[UUID]:
    """Mark the documents that need indexing as 'indexing' and return their ids.

    Without force, only 'pending' and 'failed' documents are picked up.
    A document stuck in 'indexing' (e.g. the container restarted mid-job) needs force=True.
    """
    docs = repo.list_documents(source_id)
    if force:
        todo = [d["id"] for d in docs]
    else:
        todo = [d["id"] for d in docs if d["embed_status"] in ("pending", "failed")]
    for doc_id in todo:
        repo.set_status(doc_id, "indexing")
    return todo


def index_documents(doc_ids: list[UUID]) -> None:
    """Chunk + embed + store each document, recording the outcome on its row."""
    for doc_id in doc_ids:
        try:
            doc = repo.get_document(doc_id)
            if doc is None:
                continue
            chunks = chunk_text(doc["raw_text"] or "")
            if not chunks:
                repo.set_status(doc_id, "failed", error="No usable text in this document")
                continue
            vectors = embed_texts([c.text for c in chunks])
            count = repo.replace_chunks(doc_id, doc["source_id"], chunks, vectors, MODEL_NAME)
            repo.set_status(doc_id, "indexed", chunk_count=count)
        except Exception as exc:  # keep the failure visible on the row, keep going
            log.exception("Embedding failed for document %s", doc_id)
            try:
                repo.set_status(doc_id, "failed", error=str(exc)[:500])
            except Exception:
                log.exception("Could not record failure for document %s", doc_id)


def auto_index_source(source_id) -> None:
    """Called by ingestion after a source becomes READY. Never raises:
    an indexing problem must not turn a successful ingestion into a failed one."""
    try:
        todo = queue_source(UUID(str(source_id)))
        if todo:
            index_documents(todo)
    except Exception:
        log.exception("Auto-indexing failed for source %s", source_id)
