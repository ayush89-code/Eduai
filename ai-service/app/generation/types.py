"""Step 6 - question types, the exam blueprint (how many of what) and answer validation."""
from __future__ import annotations

import random
import re
from dataclasses import dataclass

ALL_TYPES = ["MCQ", "TRUE_FALSE", "FILL_BLANK", "SHORT_ANSWER", "LONG_ANSWER", "MATCH", "CASE_BASED"]
DIFFICULTIES = ("EASY", "MEDIUM", "HARD")

TYPE_LABELS = {
    "MCQ": "multiple choice", "TRUE_FALSE": "true/false", "FILL_BLANK": "fill in the blanks",
    "SHORT_ANSWER": "short answer", "LONG_ANSWER": "long answer", "MATCH": "match the following",
    "CASE_BASED": "passage based",
}
# Share of an exam when every type is selected (re-balanced over the types the teacher ticks).
WEIGHTS = {"MCQ": 35, "TRUE_FALSE": 10, "FILL_BLANK": 15, "SHORT_ANSWER": 15, "LONG_ANSWER": 10,
           "MATCH": 5, "CASE_BASED": 10}
SUGGESTED_MARKS = {"MCQ": 1, "TRUE_FALSE": 1, "FILL_BLANK": 1, "SHORT_ANSWER": 2, "LONG_ANSWER": 5,
                   "MATCH": 4, "CASE_BASED": 5}
# Questions per AI call (kept small so each call is fast and a failure loses little work).
BATCH_SIZE = {"MCQ": 5, "TRUE_FALSE": 6, "FILL_BLANK": 6, "SHORT_ANSWER": 5, "LONG_ANSWER": 2,
              "MATCH": 2, "CASE_BASED": 2}
CHUNKS_PER_BATCH = {"MCQ": 4, "TRUE_FALSE": 4, "FILL_BLANK": 4, "SHORT_ANSWER": 4, "LONG_ANSWER": 3,
                    "MATCH": 3, "CASE_BASED": 2}
# Which provider is tried first: Groq is fastest for short items, Gemini is better for long reasoning.
PREFERENCE = {t: ("groq", "gemini") for t in ALL_TYPES}
PREFERENCE.update({"LONG_ANSWER": ("gemini", "groq"), "CASE_BASED": ("gemini", "groq")})
# Slow types first so they start early.
SCHEDULE_ORDER = ["LONG_ANSWER", "CASE_BASED", "MATCH", "MCQ", "SHORT_ANSWER", "FILL_BLANK", "TRUE_FALSE"]
DIFFICULTY_CYCLE = ["EASY", "MEDIUM", "MEDIUM", "HARD", "EASY", "MEDIUM", "EASY", "MEDIUM", "HARD", "MEDIUM"]


@dataclass(frozen=True)
class Batch:
    type: str
    difficulties: tuple  # one entry per question in the batch


def allocate(count: int, types: list[str]) -> dict[str, int]:
    """Split `count` questions over the chosen types by weight (largest remainder),
    giving every chosen type at least one question when there is room."""
    types = [t for t in ALL_TYPES if t in types]
    total = sum(WEIGHTS[t] for t in types)
    raw = {t: count * WEIGHTS[t] / total for t in types}
    out = {t: int(raw[t]) for t in types}
    leftover = count - sum(out.values())
    for t in sorted(types, key=lambda t: (-(raw[t] - out[t]), ALL_TYPES.index(t)))[:leftover]:
        out[t] += 1
    if count >= len(types):
        for t in types:
            if out[t] == 0:
                donor = max(types, key=lambda x: out[x])
                out[donor] -= 1
                out[t] += 1
    return out


def build_blueprint(count: int, types: list[str]) -> dict[str, list[str]]:
    """type -> list of difficulties (about 30% easy, 50% medium, 20% hard)."""
    plan = {}
    for t, n in allocate(count, types).items():
        off = ALL_TYPES.index(t) * 3
        plan[t] = [DIFFICULTY_CYCLE[(i + off) % len(DIFFICULTY_CYCLE)] for i in range(n)]
    return plan


def make_batches(plan: dict[str, list[str]]) -> list[Batch]:
    batches = []
    for t in SCHEDULE_ORDER:
        diffs = plan.get(t) or []
        for i in range(0, len(diffs), BATCH_SIZE[t]):
            batches.append(Batch(t, tuple(diffs[i:i + BATCH_SIZE[t]])))
    return batches


# ---- validation ------------------------------------------------------------

def _line(v, limit: int) -> str:
    return " ".join(str(v).split())[:limit] if v is not None else ""


def _text(v, limit: int) -> str:
    return str(v).strip()[:limit] if v is not None else ""


def _int(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, str) and v.strip().isdigit():
        return int(v.strip())
    return None


def _index(v, n: int):
    i = _int(v)
    if i is None and isinstance(v, str) and len(v.strip()) == 1 and v.strip().upper().isalpha():
        i = ord(v.strip().upper()) - 65
    return i if i is not None and 0 <= i < n else None


def _strip_label(s: str) -> str:
    return re.sub(r"^\(?[A-Da-d][\).:]\s+", "", s)


def _str_list(v, limit_items: int, limit_len: int) -> list[str]:
    if not isinstance(v, list):
        return []
    return [x for x in (_line(i, limit_len) for i in v) if x][:limit_items]


def _mcq(raw, base, seed):
    q, opts = _text(raw.get("question"), 1200), raw.get("options")
    if not q or not isinstance(opts, list) or len(opts) != 4:
        return None
    texts = [_strip_label(_line(o, 400)) for o in opts]
    if any(not t for t in texts) or len({t.lower() for t in texts}) != 4:
        return None
    idx = _index(raw.get("correct_index"), 4)
    if idx is None:
        return None
    base.update(question_text=q, correct_answer=texts[idx], options=[(t, i == idx) for i, t in enumerate(texts)])
    return base


def _true_false(raw, base, seed):
    q, a = _text(raw.get("question"), 800), raw.get("answer")
    if isinstance(a, str) and a.strip().lower() in ("true", "false"):
        a = a.strip().lower() == "true"
    if not q or not isinstance(a, bool):
        return None
    base.update(question_text=q, correct_answer="true" if a else "false")
    return base


def _fill_blank(raw, base, seed):
    q, ans = _text(raw.get("question"), 1000), _line(raw.get("answer"), 150)
    if not q or not ans or len(re.findall(r"_{2,}", q)) != 1:
        return None
    base.update(question_text=re.sub(r"_{2,}", "_____", q), correct_answer=ans,
                payload={"alt_answers": _str_list(raw.get("alt_answers"), 5, 150)})
    return base


def _short_answer(raw, base, seed):
    q, ans = _text(raw.get("question"), 1000), _text(raw.get("answer"), 1500)
    if not q or len(ans) < 10:
        return None
    base.update(question_text=q, correct_answer=ans, payload={"key_points": _str_list(raw.get("key_points"), 6, 300)})
    return base


def _long_answer(raw, base, seed):
    q, ans = _text(raw.get("question"), 1200), _text(raw.get("answer"), 4000)
    points = _str_list(raw.get("marking_points"), 8, 300)
    if not q or len(ans) < 60 or len(points) < 2:
        return None
    base.update(question_text=q, correct_answer=ans, payload={"marking_points": points})
    return base


def _match(raw, base, seed):
    pairs = raw.get("pairs")
    if not isinstance(pairs, list) or not 4 <= len(pairs) <= 6:
        return None
    lefts, rights = [], []
    for p in pairs:
        if not isinstance(p, dict):
            return None
        lefts.append(_line(p.get("left"), 150))
        rights.append(_line(p.get("right"), 150))
    if any(not x for x in lefts + rights):
        return None
    if len({x.lower() for x in lefts}) != len(lefts) or len({x.lower() for x in rights}) != len(rights):
        return None
    perm = list(range(len(rights)))
    random.Random(seed).shuffle(perm)
    if perm == sorted(perm):
        perm = perm[1:] + perm[:1]
    shuffled = [rights[p] for p in perm]
    key = {str(i + 1): chr(65 + shuffled.index(rights[i])) for i in range(len(lefts))}
    base.update(
        question_text=_text(raw.get("question"), 300) or "Match the items in Column A with those in Column B.",
        correct_answer=", ".join(f"{k}-{v}" for k, v in key.items()),
        payload={"left": lefts, "right": shuffled, "answer_key": key})
    return base


def _case_based(raw, base, seed):
    passage, subs = _text(raw.get("passage"), 2500), raw.get("sub_questions")
    if len(passage) < 80 or not isinstance(subs, list) or not 2 <= len(subs) <= 5:
        return None
    clean = []
    for s in subs:
        if not isinstance(s, dict):
            return None
        q, a = _text(s.get("question"), 500), _text(s.get("answer"), 800)
        if not q or not a:
            return None
        clean.append({"question": q, "answer": a})
    base.update(question_text=passage, correct_answer="\n".join(f"{i + 1}. {s['answer']}" for i, s in enumerate(clean)),
                payload={"sub_questions": clean})
    return base


_NORMALIZERS = {"MCQ": _mcq, "TRUE_FALSE": _true_false, "FILL_BLANK": _fill_blank, "SHORT_ANSWER": _short_answer,
                "LONG_ANSWER": _long_answer, "MATCH": _match, "CASE_BASED": _case_based}


def normalize(qtype: str, raw, n_chunks: int, seed: str):
    """Validate one AI-written question and convert it to the storage shape, or return None if it is unusable.
    Every question must name the passage it came from (chunk_ref), which is how citations are guaranteed."""
    if not isinstance(raw, dict):
        return None
    ref = _int(raw.get("chunk_ref"))
    if ref is None or not 1 <= ref <= n_chunks:
        return None
    diff = str(raw.get("difficulty", "")).strip().upper()
    base = {
        "type": qtype, "chunk_ref": ref, "topic": _line(raw.get("topic"), 120) or "General",
        "explanation": _text(raw.get("explanation"), 1500) or None,
        "difficulty": diff if diff in DIFFICULTIES else None,
        "question_text": "", "correct_answer": None, "options": [], "payload": {},
    }
    return _NORMALIZERS[qtype](raw, base, seed)
