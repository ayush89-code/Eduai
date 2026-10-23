"""Step 6 - the generation job runner.

One job = N questions for one source. The work is cut into small AI calls (one question type each),
run in parallel across the available providers (Groq / Gemini, or the offline mock), saved as DRAFT
questions with their citation, then topped up once if some calls came back short.
"""
from __future__ import annotations

import json
import logging
import random
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from uuid import UUID

from app.generation import prompts
from app.generation import repository as repo
from app.generation.types import (ALL_TYPES, CHUNKS_PER_BATCH, PREFERENCE, SUGGESTED_MARKS, TYPE_LABELS,
                                  Batch, build_blueprint, make_batches, normalize)
from app.ingestion import repository as ingest_repo
from app.llm.base import LLMError
from app.llm.providers import LLMRouter
from app.llm.settings import llm_settings
from app.rag import repository as rag_repo
from app.rag.embedder import embed_query

log = logging.getLogger("eduai.generation")
VERIFIED_TYPES = ("MCQ", "TRUE_FALSE", "FILL_BLANK")


def run_job(job_id: UUID) -> None:
    """Entry point for the background task. Never raises."""
    try:
        _run(job_id)
    except Exception:
        log.exception("generation job %s crashed", job_id)
        try:
            repo.update_job(job_id, status="FAILED", error="Unexpected error while generating questions.", finished=True)
        except Exception:
            log.exception("could not record failure of job %s", job_id)


def _chunk_pool(source_id: UUID, focus: str | None, job_id: UUID) -> list[dict]:
    if focus:
        hits = rag_repo.search(embed_query(focus), 40, source_id, None)  # most relevant first
        if hits:
            return hits
    chunks = repo.load_chunks(source_id)
    random.Random(str(job_id)).shuffle(chunks)  # spread questions over the whole material
    return chunks


def _dedupe_key(item: dict) -> str:
    """Two questions are duplicates only if the wording, the answer and the options all match."""
    options = "|".join(t for t, _ in item["options"])
    # MATCH and CASE_BASED share generic wording, so their pairs / sub-questions are part of the identity
    extra = json.dumps(item["payload"], sort_keys=True) if item["type"] in ("MATCH", "CASE_BASED") else ""
    raw = f'{item["type"]}|{item["question_text"]}|{item["correct_answer"]}|{options}|{extra}'
    return re.sub(r"\W+", " ", raw.lower()).strip()


def _verify(router: LLMRouter, items: list[dict], picked: list[dict], generator: str) -> list[dict]:
    """Ask a different provider to double-check objective answers; drop the ones it rejects."""
    req = prompts.verify_request(items, [c["content"] for c in picked])
    others = tuple(n for n in router.names if n != generator)
    try:
        data, _ = router.complete(req, prefer=others, exclude={generator})
    except LLMError as exc:
        log.warning("verification skipped: %s", exc)
        return items
    verdict = {r.get("id"): r.get("supported") for r in (data.get("results") or []) if isinstance(r, dict)}
    kept = []
    for i, it in enumerate(items):
        if verdict.get(i) is False:
            continue
        it["payload"]["verified"] = verdict.get(i) is True
        kept.append(it)
    return kept


def _generate_batch(router: LLMRouter, batch: Batch, picked: list[dict], subject: str, focus: str | None,
                    seed: str) -> tuple[list[dict], str]:
    req = prompts.generate_request(batch.type, batch.difficulties, [c["content"] for c in picked], subject, focus)
    data, provider = router.complete(req, prefer=PREFERENCE[batch.type])
    raw_items = data.get("questions") if isinstance(data, dict) else None
    if not isinstance(raw_items, list):
        raise LLMError("The AI answer did not contain a list of questions.")
    items: list[dict] = []
    for i, raw in enumerate(raw_items):
        item = normalize(batch.type, raw, len(picked), f"{seed}-{i}")
        if item is None:
            continue
        if item["difficulty"] is None:
            item["difficulty"] = batch.difficulties[min(i, len(batch.difficulties) - 1)]
        items.append(item)
        if len(items) == len(batch.difficulties):
            break
    if items and llm_settings.llm_verify and batch.type in VERIFIED_TYPES and len(router.names) > 1:
        items = _verify(router, items, picked, provider)
    return items, provider


def _run(job_id: UUID) -> None:
    job = repo.get_job(job_id)
    if job is None:
        return
    params = job["params"] or {}
    types = [t for t in ALL_TYPES if t in (params.get("types") or ALL_TYPES)]
    focus = (params.get("focus") or "").strip() or None
    source_id, user_id, requested = job["source_id"], job["requested_by"], job["requested_count"]
    repo.update_job(job_id, status="RUNNING")

    src = ingest_repo.get_source(str(source_id)) or {}
    subject = src.get("title") or "the study material"
    pool = _chunk_pool(source_id, focus, job_id)
    if not pool:
        repo.update_job(job_id, status="FAILED", error="No indexed text was found for this source.", finished=True)
        return

    thin = requested > len(pool) * 3  # roughly 3 questions per passage is the most a passage can honestly give
    router = LLMRouter.from_settings()
    mode = "mock" if router.is_mock else "+".join(router.names)
    repo.update_job(job_id, params_patch={"mode": mode})
    workers = min(8, max(2, router.total_concurrency))

    plan = build_blueprint(requested, types)
    seen: set[str] = set()
    got: Counter = Counter()          # (type, difficulty) -> saved
    per_type: Counter = Counter()
    providers: Counter = Counter()
    errors: list[str] = []
    cursor = [0]
    batch_no = [0]
    generated = [0]

    def pick(k: int) -> list[dict]:
        k = min(k, len(pool))
        picked = [pool[(cursor[0] + j) % len(pool)] for j in range(k)]
        cursor[0] += k
        return picked

    def persist(items: list[dict], picked: list[dict], provider: str) -> int:
        saved = 0
        for it in items:
            key = _dedupe_key(it)
            if key in seen:
                continue
            chunk = picked[it["chunk_ref"] - 1]
            payload = {**it["payload"], "marks": SUGGESTED_MARKS[it["type"]], "generated_by": provider,
                       "chunk_index": chunk["chunk_index"]}
            try:
                repo.insert_question(job_id, source_id, user_id, {
                    "type": it["type"], "difficulty": it["difficulty"], "topic": it["topic"],
                    "question_text": it["question_text"], "correct_answer": it["correct_answer"],
                    "explanation": it["explanation"], "options": it["options"], "payload": payload,
                    "source_chunk_id": chunk["id"], "citation_ref": chunk["citation_ref"],
                    "citation_retrieved_at": chunk["retrieved_at"],
                })
            except Exception:
                log.exception("could not save a generated question for job %s", job_id)
                continue
            seen.add(key)
            got[(it["type"], it["difficulty"])] += 1
            per_type[it["type"]] += 1
            providers[provider] += 1
            saved += 1
        generated[0] += saved
        repo.update_job(job_id, generated=generated[0])
        return saved

    def run_round(batches: list[Batch]) -> int:
        tasks = []
        for b in batches:
            batch_no[0] += 1
            tasks.append((b, pick(CHUNKS_PER_BATCH[b.type]), f"{job_id}-{batch_no[0]}"))
        productive = 0
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(_generate_batch, router, b, picked, subject, focus, seed): picked
                       for b, picked, seed in tasks}
            for fut in as_completed(futures):
                try:
                    items, provider = fut.result()
                except LLMError as exc:
                    errors.append(str(exc))
                    continue
                except Exception:
                    log.exception("unexpected error in a generation batch (job %s)", job_id)
                    errors.append("Unexpected error while generating a batch.")
                    continue
                if items and persist(items, futures[fut], provider):
                    productive += 1
        return productive

    first = run_round(make_batches(plan))

    missing = {t: len(plan[t]) - per_type[t] for t in plan if len(plan[t]) > per_type[t]}
    if missing and first > 0:  # one top-up round, only if the providers are actually working
        topup: dict[str, list[str]] = {}
        for t, m in missing.items():
            have = Counter()
            for (tt, d), n in got.items():
                if tt == t:
                    have[d] += n
            diffs = list((Counter(plan[t]) - have).elements())[:m]
            topup[t] = diffs + ["MEDIUM"] * (m - len(diffs))
        run_round(make_batches(topup))

    patch = {"provider_counts": dict(providers), "mode": mode}
    if generated[0] == 0:
        repo.update_job(job_id, status="FAILED", finished=True, params_patch=patch,
                        error=errors[0] if errors else "The AI did not return any usable questions. Please try again.")
        return
    notes = []
    short = {t: len(plan[t]) - per_type[t] for t in plan if len(plan[t]) > per_type[t]}
    if short:
        notes.append(f"Generated {generated[0]} of {requested}. Short on: "
                     + ", ".join(f"{TYPE_LABELS[t]} ({n})" for t, n in short.items()) + ".")
    if thin:
        notes.append(f"Your material has only {len(pool)} passage{'s' if len(pool) != 1 else ''}, so {requested} "
                     "questions may overlap. Add more material for more variety.")
    if errors:
        notes.append(f"Some AI requests failed ({errors[0]}).")
    repo.update_job(job_id, status="DONE", finished=True, params_patch=patch, error=" ".join(notes) or None)
