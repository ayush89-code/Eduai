"""Step 6 - database access for generation jobs and generated questions (shares the Step 5 pool)."""
from __future__ import annotations

from uuid import UUID

from psycopg.types.json import Jsonb

from app.rag.repository import get_pool

_UNSET = object()


# ---- jobs ------------------------------------------------------------------

def create_job(source_id: UUID, user_id: UUID, count: int, types: list[str], focus: str | None) -> UUID:
    with get_pool().connection() as conn:
        row = conn.execute(
            """INSERT INTO generation_jobs (source_id, requested_by, params, status, requested_count)
               VALUES (%s, %s, %s, 'QUEUED', %s) RETURNING id""",
            (source_id, user_id, Jsonb({"types": types, "focus": focus}), count),
        ).fetchone()
    return row["id"]


def get_job(job_id: UUID) -> dict | None:
    with get_pool().connection() as conn:
        return conn.execute("SELECT * FROM generation_jobs WHERE id = %s", (job_id,)).fetchone()


def update_job(job_id: UUID, *, status: str | None = None, generated: int | None = None,
               error=_UNSET, finished: bool = False, params_patch: dict | None = None) -> None:
    sets: list[str] = []
    args: list = []
    if status is not None:
        sets.append("status = %s"); args.append(status)
    if generated is not None:
        sets.append("generated_count = %s"); args.append(generated)
    if error is not _UNSET:
        sets.append("error_message = %s"); args.append(error)
    if finished:
        sets.append("finished_at = now()")
    if params_patch:
        sets.append("params = params || %s"); args.append(Jsonb(params_patch))
    if not sets:
        return
    args.append(job_id)
    with get_pool().connection() as conn:
        conn.execute(f"UPDATE generation_jobs SET {', '.join(sets)} WHERE id = %s", args)


def active_job(source_id: UUID, max_age_minutes: int = 15) -> UUID | None:
    """A QUEUED/RUNNING job. Jobs older than max_age_minutes are treated as dead (e.g. the service restarted)."""
    with get_pool().connection() as conn:
        row = conn.execute(
            """SELECT id FROM generation_jobs
                WHERE source_id = %s AND status IN ('QUEUED', 'RUNNING')
                  AND created_at > now() - make_interval(mins => %s)
                LIMIT 1""",
            (source_id, max_age_minutes),
        ).fetchone()
    return row["id"] if row else None


def list_jobs(source_id: UUID, limit: int = 10) -> list[dict]:
    with get_pool().connection() as conn:
        return conn.execute(
            "SELECT * FROM generation_jobs WHERE source_id = %s ORDER BY created_at DESC LIMIT %s",
            (source_id, limit),
        ).fetchall()


def delete_job(job_id: UUID) -> None:
    """Discard a job and its DRAFT questions. Approved questions survive (their job link becomes empty).
    Raises psycopg.errors.ForeignKeyViolation if a draft is already used in an exam."""
    with get_pool().connection() as conn:
        with conn.transaction():
            conn.execute("DELETE FROM questions WHERE generation_job_id = %s AND status = 'DRAFT'", (job_id,))
            conn.execute("DELETE FROM generation_jobs WHERE id = %s", (job_id,))


def source_has_questions(source_id: UUID) -> bool:
    with get_pool().connection() as conn:
        return conn.execute("SELECT EXISTS (SELECT 1 FROM questions WHERE source_id = %s) AS x",
                            (source_id,)).fetchone()["x"]


def counts_for_jobs(job_ids: list[UUID]) -> dict[UUID, dict[str, int]]:
    if not job_ids:
        return {}
    with get_pool().connection() as conn:
        rows = conn.execute(
            """SELECT generation_job_id AS job_id, type, count(*) AS n
                 FROM questions WHERE generation_job_id = ANY(%s) GROUP BY 1, 2""",
            (job_ids,),
        ).fetchall()
    out: dict[UUID, dict[str, int]] = {}
    for r in rows:
        out.setdefault(r["job_id"], {})[r["type"]] = r["n"]
    return out


# ---- chunks (same row shape as app.rag.repository.search) --------------------

def load_chunks(source_id: UUID) -> list[dict]:
    with get_pool().connection() as conn:
        return conn.execute(
            """SELECT c.id, c.source_document_id, c.chunk_index, c.content,
                      COALESCE(sd.url, sd.filename) AS citation_ref, sd.retrieved_at, sd.title
                 FROM chunks c JOIN source_documents sd ON sd.id = c.source_document_id
                WHERE c.source_id = %s
                ORDER BY sd.retrieved_at, sd.id, c.chunk_index""",
            (source_id,),
        ).fetchall()


# ---- questions -------------------------------------------------------------

def insert_question(job_id: UUID, source_id: UUID, user_id: UUID, q: dict) -> UUID:
    """Insert one question (and its options for MCQ) atomically."""
    with get_pool().connection() as conn:
        with conn.transaction():
            row = conn.execute(
                """INSERT INTO questions
                     (source_id, generation_job_id, created_by, type, difficulty, topic, question_text,
                      correct_answer, explanation, status, source_chunk_id, citation_ref,
                      citation_retrieved_at, payload)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'DRAFT', %s, %s, %s, %s)
                   RETURNING id""",
                (source_id, job_id, user_id, q["type"], q["difficulty"], q["topic"][:200], q["question_text"],
                 q["correct_answer"], q["explanation"], q["source_chunk_id"], q["citation_ref"],
                 q["citation_retrieved_at"], Jsonb(q["payload"])),
            ).fetchone()
            for pos, (text, correct) in enumerate(q["options"], start=1):
                conn.execute(
                    "INSERT INTO question_options (question_id, position, option_text, is_correct) VALUES (%s, %s, %s, %s)",
                    (row["id"], pos, text, correct),
                )
    return row["id"]


def list_questions(job_id: UUID) -> list[dict]:
    with get_pool().connection() as conn:
        qs = conn.execute(
            """SELECT id, type, difficulty, topic, question_text, correct_answer, explanation, status,
                      citation_ref, citation_retrieved_at, payload, created_at
                 FROM questions WHERE generation_job_id = %s ORDER BY created_at, id""",
            (job_id,),
        ).fetchall()
        opts = conn.execute(
            """SELECT question_id, position, option_text, is_correct FROM question_options
                WHERE question_id = ANY(%s) ORDER BY question_id, position""",
            ([q["id"] for q in qs],),
        ).fetchall() if qs else []
    by_q: dict[UUID, list[dict]] = {}
    for o in opts:
        by_q.setdefault(o["question_id"], []).append(
            {"position": o["position"], "text": o["option_text"], "is_correct": o["is_correct"]})
    for q in qs:
        q["options"] = by_q.get(q["id"], [])
    return qs
