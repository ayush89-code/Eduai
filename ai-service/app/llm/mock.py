"""Offline test provider: builds simple template questions straight from the study material.

Used automatically when no Gemini / Groq key is configured, so the whole pipeline (jobs, progress,
storage, citations, review screen) can be tested without any AI account. The questions are NOT
good exam questions - they only prove the plumbing works.
"""
from __future__ import annotations

import itertools
import re

from app.llm.base import LLMRequest, Provider

NOTE = "Offline test question built from the material (no AI key is configured)."


def _sentences(text: str) -> list[str]:
    parts = [s.strip() for s in re.split(r"(?<=[.!?])\s+", " ".join(text.split())) if len(s.strip()) >= 30]
    return parts or [" ".join(text.split())[:200]]


def _trim(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


class MockProvider(Provider):
    name = "mock"

    def __init__(self):
        self._counter = itertools.count()  # makes every generated question different within a job

    def complete_json(self, req: LLMRequest) -> dict:
        task = req.task or {}
        if task.get("kind") == "verify":
            return {"results": [{"id": it["id"], "supported": True} for it in task.get("items", [])]}
        return {"questions": [self._make(task, i) for i in range(int(task.get("count", 1)))]}

    # ------------------------------------------------------------------
    def _make(self, task: dict, i: int) -> dict:
        chunks: list[str] = task["chunks"]
        qtype: str = task["type"]
        n = next(self._counter)
        c = n % len(chunks)
        sents = _sentences(chunks[c])
        s = sents[(n // len(chunks)) % len(sents)]
        diffs = task.get("difficulties") or ["MEDIUM"]
        base = {
            "chunk_ref": c + 1,
            "topic": _trim(" ".join(s.split()[:4]).strip(".,;:") or "General", 60),
            "difficulty": diffs[min(i, len(diffs) - 1)],
            "explanation": NOTE,
        }
        return {**base, **getattr(self, "_" + qtype.lower())(task, n, s, sents, chunks[c])}

    def _mcq(self, task, i, s, sents, chunk):
        distractors = ["The material states the opposite.", "The material does not mention this.", "None of the above."]
        k = i % 4
        options = distractors[:k] + [_trim(s, 140)] + distractors[k:]
        topic = " ".join(s.split()[:4]).strip(".,;:")
        return {"question": f'Which of the following statements about "{topic}" is supported by the study material?',
                "options": options, "correct_index": k}

    def _true_false(self, task, i, s, sents, chunk):
        if i % 2 == 0:
            return {"question": _trim(s, 300), "answer": True}
        return {"question": "It is not true that " + _trim(s[0].lower() + s[1:], 280), "answer": False}

    def _fill_blank(self, task, i, s, sents, chunk):
        words = re.findall(r"[A-Za-z']{5,}", s)
        target = max(words, key=len) if words else s.split()[0]
        return {"question": s.replace(target, "_____", 1), "answer": target, "alt_answers": []}

    def _short_answer(self, task, i, s, sents, chunk):
        return {"question": "Explain briefly: " + " ".join(s.split()[:8]) + "…?", "answer": s, "key_points": [_trim(s, 120)]}

    def _long_answer(self, task, i, s, sents, chunk):
        points = sents[:4] if len(sents) >= 2 else [s, "Clear explanation with examples."]
        topic = " ".join(s.split()[:5]).strip(".,;:")
        return {"question": f"Discuss in detail: {topic}.", "answer": " ".join(chunk.split())[:700],
                "marking_points": [_trim(p, 150) for p in points]}

    def _match(self, task, i, s, sents, chunk):
        pool = [x for ch in task["chunks"] for x in _sentences(ch)]
        pairs = []
        for j in range(4):
            right = _trim(pool[(i + j) % len(pool)], 60) + f" ({j + 1})"
            pairs.append({"left": f"Statement {j + 1}", "right": right})
        return {"question": "Match the items in Column A with Column B.", "pairs": pairs}

    def _case_based(self, task, i, s, sents, chunk):
        passage = " ".join(" ".join(task["chunks"]).split())[:700]
        subs = []
        for j in range(3):
            sent = sents[j % len(sents)]
            subs.append({"question": "According to the passage, what is stated about: "
                                     + " ".join(sent.split()[:5]).strip(".,;:") + "?", "answer": sent})
        return {"passage": passage, "sub_questions": subs}
