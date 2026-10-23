import os
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import settings
from app.core.security import CurrentUser, require_roles
from app.ingestion import repository as repo
from app.ingestion import service
from app.ingestion.extractors import ExtractionError, file_extension, validate_upload
from app.ingestion.search import SearchError, get_provider, provider_configured

router = APIRouter(prefix="/api/ingest", tags=["ingestion"])
teacher = require_roles("TEACHER", "ADMIN")


class TopicRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    topic: str = Field(min_length=3, max_length=200)
    use_web_search: bool = Field(default=True, alias="useWebSearch")


def _summary(row: dict) -> dict:
    return {
        "id": str(row["id"]), "kind": row["kind"], "title": row["title"],
        "topic": row["topic_query"], "status": row["status"], "error": row["error_message"],
        "createdAt": row["created_at"].isoformat(),
        "documents": int(row.get("documents", 0)), "chars": int(row.get("chars", 0)),
    }


def _owned_or_404(source_id: uuid.UUID, user: CurrentUser) -> dict:
    src = repo.get_source(str(source_id))
    if not src or (user.role != "ADMIN" and str(src["owner_id"]) != user.id):
        raise HTTPException(404, "Source not found")
    return src


@router.post("/document", status_code=202)
async def upload_document(background: BackgroundTasks, file: UploadFile = File(...),
                          user: CurrentUser = Depends(teacher)):
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File is larger than {settings.max_upload_mb} MB.")
    filename = os.path.basename(file.filename or "upload")[:255] or "upload"
    try:
        validate_upload(filename, data)
    except ExtractionError as exc:
        code = 415 if file_extension(filename) not in {".pdf", ".docx", ".pptx", ".txt"} else 400
        raise HTTPException(code, str(exc))
    source_id = await run_in_threadpool(repo.create_source, user.id, "DOCUMENT", filename)
    background.add_task(service.process_document, source_id, filename, data)
    return {"sourceId": source_id, "status": "PENDING"}


@router.post("/topic", status_code=202)
def submit_topic(body: TopicRequest, background: BackgroundTasks, response: Response,
                 user: CurrentUser = Depends(teacher)):
    topic = " ".join(body.topic.split())
    if len(topic) < 3:
        raise HTTPException(422, "Topic is too short.")

    if not body.use_web_search:
        existing = repo.find_ready_topic_source(user.id, topic)
        if existing:
            response.status_code = 200
            return {"sourceId": existing, "status": "READY", "reused": True}
        raise HTTPException(409, "No saved sources for this topic yet. Turn on web search to fetch fresh sources.")

    try:
        provider = get_provider()
    except SearchError as exc:
        raise HTTPException(503, str(exc))
    used = repo.count_topic_searches_this_month()
    if used >= settings.search_monthly_cap:
        raise HTTPException(
            429,
            f"Monthly web-search cap reached ({used}/{settings.search_monthly_cap}). "
            "Turn off web search to reuse saved sources, or raise SEARCH_MONTHLY_CAP.",
        )
    source_id = repo.create_source(user.id, "TOPIC", topic, topic_query=topic)
    background.add_task(service.process_topic, source_id, topic, provider)
    return {"sourceId": source_id, "status": "PENDING", "reused": False}


@router.get("/usage")
def usage(user: CurrentUser = Depends(teacher)):
    return {
        "provider": settings.search_provider.lower(),
        "configured": provider_configured(),
        "searchesThisMonth": repo.count_topic_searches_this_month(),
        "monthlyCap": settings.search_monthly_cap,
    }


@router.get("/sources")
def list_sources(user: CurrentUser = Depends(teacher)):
    rows = repo.list_sources(None if user.role == "ADMIN" else user.id)
    return [_summary(r) for r in rows]


@router.get("/sources/{source_id}")
def get_source(source_id: uuid.UUID, user: CurrentUser = Depends(teacher)):
    src = _owned_or_404(source_id, user)
    docs = src["documents"]
    out = _summary({**src, "documents": len(docs), "chars": sum(d["char_count"] or 0 for d in docs)})
    out["documentList"] = [
        {"id": str(d["id"]), "url": d["url"], "filename": d["filename"], "title": d["title"],
         "retrievedAt": d["retrieved_at"].isoformat(), "chars": d["char_count"] or 0}
        for d in docs
    ]
    return out


@router.delete("/sources/{source_id}", status_code=204)
def delete_source(source_id: uuid.UUID, user: CurrentUser = Depends(teacher)):
    _owned_or_404(source_id, user)
    try:
        repo.delete_source(str(source_id))
    except Exception:
        raise HTTPException(409, "This source is used by questions and cannot be deleted.")
    return Response(status_code=204)
