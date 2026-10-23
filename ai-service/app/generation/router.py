"""Step 6 - question generation endpoints.

POST /api/generate/jobs                      start a job {source_id, count, types?, focus?}   (returns at once)
GET  /api/generate/jobs/{job_id}             progress
GET  /api/generate/jobs/{job_id}/questions   the generated questions (DRAFT) with citations
GET  /api/generate/sources/{source_id}/jobs  recent jobs of a source (newest first)

Teacher/admin login required; a teacher only sees their own sources and jobs.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from psycopg import errors as pg_errors
from pydantic import BaseModel, Field

from app.core.security import CurrentUser, require_roles
from app.generation import repository as repo
from app.generation.service import run_job
from app.generation.types import ALL_TYPES
from app.ingestion import repository as ingest_repo
from app.rag import repository as rag_repo

router = APIRouter(prefix="/api/generate", tags=["generation"])
teacher = require_roles("TEACHER", "ADMIN")


class JobRequest(BaseModel):
    source_id: UUID
    count: int = Field(default=10, ge=1, le=100)
    types: list[str] | None = None            # default: all types
    focus: str | None = Field(default=None, max_length=200)


def _owned_source_or_404(source_id: UUID, user: CurrentUser) -> dict:
    src = ingest_repo.get_source(str(source_id))
    if not src or (user.role != "ADMIN" and str(src["owner_id"]) != user.id):
        raise HTTPException(404, "Source not found")
    return src


def _job_or_404(job_id: UUID, user: CurrentUser) -> dict:
    job = repo.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    _owned_source_or_404(job["source_id"], user)  # 404 for other teachers' jobs
    return job


def _summary(job: dict, by_type: dict[str, int] | None) -> dict:
    params = job["params"] or {}
    return {
        "id": job["id"], "source_id": job["source_id"], "status": job["status"],
        "requested_count": job["requested_count"], "generated_count": job["generated_count"],
        "error": job["error_message"], "created_at": job["created_at"], "finished_at": job["finished_at"],
        "types": params.get("types"), "focus": params.get("focus"), "mode": params.get("mode"),
        "provider_counts": params.get("provider_counts"), "by_type": by_type or {},
    }


@router.post("/jobs", status_code=202)
def start_job(req: JobRequest, background: BackgroundTasks, user: CurrentUser = Depends(teacher)) -> dict:
    src = _owned_source_or_404(req.source_id, user)
    if src["status"] != "READY":
        raise HTTPException(409, "This source is not ready yet.")
    docs = rag_repo.list_documents(req.source_id)
    if not docs or any(d["embed_status"] != "indexed" for d in docs):
        raise HTTPException(409, "This source is still being indexed. Try again in a moment.")

    wanted = req.types if req.types is not None else ALL_TYPES
    unknown = [t for t in wanted if t not in ALL_TYPES]
    types = [t for t in ALL_TYPES if t in wanted]
    if unknown or not types:
        raise HTTPException(422, "Choose at least one valid question type.")
    if repo.active_job(req.source_id):
        raise HTTPException(409, "Questions are already being generated for this source.")

    job_id = repo.create_job(req.source_id, UUID(user.id), req.count, types, (req.focus or "").strip() or None)
    background.add_task(run_job, job_id)
    return _summary(repo.get_job(job_id), None)


@router.get("/jobs/{job_id}")
def job_status(job_id: UUID, user: CurrentUser = Depends(teacher)) -> dict:
    job = _job_or_404(job_id, user)
    return _summary(job, repo.counts_for_jobs([job_id]).get(job_id))


@router.get("/jobs/{job_id}/questions")
def job_questions(job_id: UUID, user: CurrentUser = Depends(teacher)) -> list[dict]:
    _job_or_404(job_id, user)
    order = {t: i for i, t in enumerate(ALL_TYPES)}
    questions = sorted(repo.list_questions(job_id), key=lambda q: (order.get(q["type"], 99), q["created_at"]))
    return [{k: v for k, v in q.items() if k != "created_at"} for q in questions]


@router.delete("/jobs/{job_id}", status_code=204)
def discard_job(job_id: UUID, user: CurrentUser = Depends(teacher)) -> Response:
    """Throw away a generation run and its DRAFT questions (so the source can be deleted or regenerated cleanly)."""
    job = _job_or_404(job_id, user)
    if repo.active_job(job["source_id"]) == job_id:
        raise HTTPException(409, "Wait for the generation to finish before discarding it.")
    try:
        repo.delete_job(job_id)
    except pg_errors.ForeignKeyViolation:
        raise HTTPException(409, "Some of these questions are already used in an exam, so they cannot be discarded.")
    return Response(status_code=204)


@router.get("/sources/{source_id}/jobs")
def source_jobs(source_id: UUID, user: CurrentUser = Depends(teacher)) -> list[dict]:
    _owned_source_or_404(source_id, user)
    jobs = repo.list_jobs(source_id)
    counts = repo.counts_for_jobs([j["id"] for j in jobs])
    return [_summary(j, counts.get(j["id"])) for j in jobs]
