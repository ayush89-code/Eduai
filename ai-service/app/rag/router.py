"""Step 5 - embed + retrieval endpoints (sits next to app/ingestion/router.py).

POST /api/rag/embed          start (re)indexing the documents of a source (returns at once)
GET  /api/rag/status/{id}    pending -> indexing -> indexed / failed, plus per-document detail
POST /api/rag/search         top-k chunks for a question, with citation info

All routes need a TEACHER or ADMIN login, and a teacher can only touch their own sources.
Normally indexing starts by itself when ingestion finishes; /embed is for re-indexing.
"""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.security import CurrentUser, require_roles
from app.generation import repository as gen_repo
from app.ingestion import repository as ingest_repo
from app.rag import repository as repo
from app.rag.embedder import embed_query
from app.rag.indexer import index_documents, queue_source

router = APIRouter(prefix="/api/rag", tags=["rag"])
teacher = require_roles("TEACHER", "ADMIN")


# ---- schemas -------------------------------------------------------------

class EmbedRequest(BaseModel):
    source_id: UUID
    force: bool = False  # re-index documents that are already 'indexed' (or stuck 'indexing')


class DocumentStatus(BaseModel):
    id: UUID
    status: str
    error: str | None = None
    chunk_count: int = 0


class SourceStatus(BaseModel):
    source_id: UUID
    status: str  # pending | indexing | indexed | failed
    total_documents: int
    indexed_documents: int
    chunk_count: int
    documents: list[DocumentStatus]


class SearchRequest(BaseModel):
    query: str = Field(min_length=2)
    source_id: UUID  # required: a teacher only ever searches their own source
    source_document_ids: list[UUID] | None = None
    top_k: int = Field(default=5, ge=1, le=20)


class SearchHit(BaseModel):
    chunk_id: UUID
    source_id: UUID
    source_document_id: UUID
    chunk_index: int
    content: str
    score: float
    citation_ref: str | None = None  # URL for web pages, filename for uploads
    title: str | None = None
    retrieved_at: datetime | None = None


# ---- helpers -------------------------------------------------------------

def _owned_or_404(source_id: UUID, user: CurrentUser) -> None:
    src = ingest_repo.get_source(str(source_id))
    if not src or (user.role != "ADMIN" and str(src["owner_id"]) != user.id):
        raise HTTPException(404, "Source not found")


def _rollup(source_id: UUID) -> SourceStatus:
    docs = repo.list_documents(source_id)
    if not docs:
        raise HTTPException(status_code=404, detail="Source not found or it has no documents")
    states = [d["embed_status"] for d in docs]
    if "failed" in states:
        overall = "failed"
    elif "indexing" in states:
        overall = "indexing"
    elif "pending" in states:
        overall = "pending"
    else:
        overall = "indexed"
    return SourceStatus(
        source_id=source_id,
        status=overall,
        total_documents=len(docs),
        indexed_documents=states.count("indexed"),
        chunk_count=sum(d["chunk_count"] or 0 for d in docs),
        documents=[
            DocumentStatus(id=d["id"], status=d["embed_status"], error=d["embed_error"],
                           chunk_count=d["chunk_count"] or 0)
            for d in docs
        ],
    )


# ---- endpoints -----------------------------------------------------------

@router.post("/embed", status_code=202, response_model=SourceStatus)
def embed_source(req: EmbedRequest, background: BackgroundTasks,
                 user: CurrentUser = Depends(teacher)) -> SourceStatus:
    _owned_or_404(req.source_id, user)
    if not repo.list_documents(req.source_id):
        raise HTTPException(status_code=404, detail="Source not found or it has no documents")
    if req.force and gen_repo.source_has_questions(req.source_id):
        # questions point at specific chunks, and re-indexing replaces every chunk
        raise HTTPException(status_code=409, detail="This source already has generated questions, so it cannot be "
                                                    "re-indexed. Discard its questions first.")
    todo = queue_source(req.source_id, req.force)
    if todo:
        background.add_task(index_documents, todo)
    return _rollup(req.source_id)


@router.get("/status/{source_id}", response_model=SourceStatus)
def embed_status(source_id: UUID, user: CurrentUser = Depends(teacher)) -> SourceStatus:
    _owned_or_404(source_id, user)
    return _rollup(source_id)


@router.post("/search", response_model=list[SearchHit])
def search_chunks(req: SearchRequest, user: CurrentUser = Depends(teacher)) -> list[SearchHit]:
    _owned_or_404(req.source_id, user)
    rows = repo.search(embed_query(req.query), req.top_k, req.source_id, req.source_document_ids)
    return [
        SearchHit(
            chunk_id=r["id"],
            source_id=r["source_id"],
            source_document_id=r["source_document_id"],
            chunk_index=r["chunk_index"],
            content=r["content"],
            score=float(r["score"]),
            citation_ref=r["citation_ref"],
            title=r["title"],
            retrieved_at=r["retrieved_at"],
        )
        for r in rows
    ]
