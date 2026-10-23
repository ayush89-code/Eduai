# EduAI — Intelligent Examination & Assessment Platform

MCA major project. Multi-service AI platform for RAG-based question
generation, secure online exams, lightweight AI proctoring, and
real-time performance analytics.

## Architecture

```
                    ┌─────────────┐
                    │   Frontend  │  React + Tailwind (Vite)
                    │  (5173)     │
                    └──────┬──────┘
                           │ REST + WebSocket
                    ┌──────▼──────┐        Kafka topics       ┌──────────────┐
                    │   Backend   │◄────────────────────────►│  AI Service   │
                    │ Spring Boot │   ingestion.jobs           │   FastAPI     │
                    │   (8080)    │   generation.results        │   (8000)     │
                    │             │   proctoring.events          │              │
                    └──────┬──────┘                             └──────┬───────┘
                           │                                            │
                           └──────────────┬─────────────────────────────┘
                                          ▼
                                ┌───────────────────┐
                                │  PostgreSQL +      │
                                │  pgvector (5432)   │
                                └───────────────────┘
```

## Key architecture decisions (why things are wired this way)

1. **Backend ↔ AI service is hybrid, not purely REST.**
   Quick calls (submit a document/topic, check status) are synchronous
   REST. The actual generation work (ingest → embed → generate
   questions) is dispatched as a Kafka event; the AI service consumes
   it, does the work, and publishes a result event back. The backend
   consumes that and pushes it to the teacher's browser over
   WebSocket. Proctoring events use the same async pattern — one
   consistent event-driven backbone for both features, which is also
   what "suspicious events are streamed as async events rather than
   written directly to the DB" required.

2. **Auth: backend issues JWTs, AI service validates them independently.**
   Both services share `JWT_SECRET`. The AI service does not proxy
   every call through the backend — it verifies the JWT itself. Keeps
   the two services decoupled and avoids an extra network hop on
   every AI request.

3. **Proctoring inference runs in the browser**, using MediaPipe
   (JS/WASM) for face-presence and the Page Visibility API for
   tab-switch detection. Only derived events (`face_missing`,
   `tab_switch`, etc.) leave the client — raw video never does. This
   keeps MVP infra simple (no video streaming pipeline) and matches
   the "async events, not raw data" requirement.

4. **Monorepo.** One `docker-compose.yml` orchestrates everything for
   local dev and for the CI/CD demo.

## Services

| Service     | Tech                          | Port | Purpose                                      |
|-------------|--------------------------------|------|-----------------------------------------------|
| frontend    | React + Tailwind (Vite)        | 5173 | Teacher/student/admin UI                      |
| backend     | Spring Boot + Security + JWT   | 8080 | Auth, exam logic, WebSocket gateway, orchestration |
| ai-service  | FastAPI + LangChain            | 8000 | Document/topic ingestion, RAG question generation |
| postgres    | Postgres 16 + pgvector         | 5432 | Relational data + vector embeddings, one DB   |
| kafka       | Bitnami Kafka (KRaft, no ZK)   | 9092 | Event backbone: ingestion jobs, generation results, proctoring events |
| kafka-ui    | Provectus Kafka UI             | 8085 | Inspect topics/messages during development    |

## Running locally

```bash
cp .env.example .env        # fill in HF/Tavily/Serper keys when you reach Step 4+
docker compose up --build
```

Once containers are healthy:
- Frontend: http://localhost:5173 (shows a live backend health badge)
- Backend health: http://localhost:8080/api/health
- AI service health: http://localhost:8000/api/health
- Kafka UI: http://localhost:8085

## Build roadmap

This repo is being built step by step, each step landing as a runnable
increment:

1. ✅ Repo skeleton + Docker Compose (this step)
2. ⬜ Postgres schema (users, documents, questions, exams, proctoring_events, results)
3. ⬜ Auth (Spring Security + JWT, register/login, role-based guards)
4. ⬜ Document + topic ingestion (upload parsing, Tavily/Serper + trafilatura)
5. ⬜ Chunk + embed → pgvector
6. ⬜ RAG question generation (difficulty tagging, citations)
7. ⬜ Question paper builder + teacher review/publish
8. ⬜ Exam-taking UI + objective auto-eval
9. ⬜ Kafka proctoring event pipeline
10. ⬜ WebSocket live dashboard
11. ⬜ Analytics (weak-topic breakdown)
12. ⬜ CI/CD + deploy

## Explicitly out of scope for v1 (future roadmap)

Subjective-answer AI evaluation, adaptive difficulty, YOLO multi-person/
phone detection, voice-based viva, coding assessment module, AI tutor/
chatbot, multilingual support, plagiarism detection.
