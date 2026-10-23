from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.whoami import router as whoami_router
from app.core.config import settings
from app.ingestion.router import router as ingestion_router
from app.rag.router import router as rag_router
from app.generation.router import router as generation_router

app = FastAPI(
    title="EduAI - AI Service",
    description="RAG ingestion, question generation, and proctoring support service",
    version="0.2.0",
)

# The browser calls this service directly (with the backend-issued JWT), so it needs CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(whoami_router)
app.include_router(ingestion_router)
app.include_router(rag_router)
app.include_router(generation_router)


@app.get("/api/health")
def health():
    return {
        "service": "eduai-ai-service",
        "status": "UP",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
