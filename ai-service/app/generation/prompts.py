"""Step 6 - prompts. The AI sees only the numbered passages and must say which one each question uses."""
from __future__ import annotations

from app.generation.types import TYPE_LABELS
from app.llm.base import LLMRequest

SYSTEM = (
    "You are an experienced exam setter for coaching classes. Write exam questions strictly from the STUDY "
    "MATERIAL supplied by the user; never add facts that contradict it. Write in the same language as the material. "
    "Reply with a single JSON object and nothing else (no markdown, no commentary)."
)

_COMMON = '"chunk_ref": <number of the passage used>, "topic": "<2-4 word topic label>", "difficulty": "<EASY|MEDIUM|HARD>"'
SCHEMAS = {
    "MCQ": '{' + _COMMON + ', "question": "...", "options": ["...", "...", "...", "..."], "correct_index": <0-3>, "explanation": "why the answer is right"}',
    "TRUE_FALSE": '{' + _COMMON + ', "question": "a clear statement that is either true or false", "answer": true, "explanation": "..."}',
    "FILL_BLANK": '{' + _COMMON + ', "question": "a sentence containing exactly one blank written as _____", "answer": "the missing word or phrase", "alt_answers": ["other accepted answers"], "explanation": "..."}',
    "SHORT_ANSWER": '{' + _COMMON + ', "question": "...", "answer": "model answer in 1-3 sentences", "key_points": ["..."], "explanation": "..."}',
    "LONG_ANSWER": '{' + _COMMON + ', "question": "...", "answer": "full model answer of one or two paragraphs", "marking_points": ["3-6 points a marker should look for"], "explanation": "..."}',
    "MATCH": '{' + _COMMON + ', "question": "Match the following", "pairs": [{"left": "...", "right": "..."}, "... 4 or 5 pairs, every left and every right different ..."], "explanation": "..."}',
    "CASE_BASED": '{' + _COMMON + ', "passage": "a 80-150 word passage based on the material", "sub_questions": [{"question": "...", "answer": "..."}, "... 3 or 4 questions answerable from the passage ..."], "explanation": "..."}',
}
EXTRA_RULES = {
    "MCQ": "Exactly four options, exactly one correct, no 'all of the above' / 'none of the above', plausible distractors.",
    "TRUE_FALSE": "Mix true and false statements. Avoid trick wording.",
    "FILL_BLANK": "Exactly one blank per question; the answer must be unambiguous.",
    "MATCH": "Do not put the pairs in a revealing order; do not include numbers or letters in the items.",
    "CASE_BASED": "The sub-questions must be answerable from the passage alone.",
}


def generate_request(qtype: str, difficulties, chunk_texts: list[str], subject: str, focus: str | None) -> LLMRequest:
    n = len(difficulties)
    passages = "\n\n".join(f"[{i + 1}] {t.strip()}" for i, t in enumerate(chunk_texts))
    lines = [
        f"Subject / title: {subject}",
        f"Create exactly {n} {TYPE_LABELS[qtype]} question{'s' if n != 1 else ''}.",
        f"Difficulty of each question, in order: {', '.join(difficulties)}.",
    ]
    if focus:
        lines.append(f"The teacher wants the focus to be: {focus}.")
    lines += [
        "",
        "STUDY MATERIAL (numbered passages). Base each question on ONE passage and give its number in chunk_ref.",
        "For language subjects (grammar, vocabulary, comprehension) a question may test the skill the passage illustrates.",
        passages,
        "",
        f'Return JSON of the form {{"questions": [ ... ]}} where each item looks like:',
        SCHEMAS[qtype],
        "Rules: vary the wording; make questions clear and unambiguous; do not copy long sentences word for word; "
        + EXTRA_RULES.get(qtype, "Give a useful explanation or marking guidance."),
    ]
    task = {"kind": "generate", "type": qtype, "count": n, "difficulties": list(difficulties),
            "chunks": chunk_texts, "subject": subject, "focus": focus}
    return LLMRequest(system=SYSTEM, user="\n".join(lines), task=task)


def verify_request(items: list[dict], chunk_texts: list[str]) -> LLMRequest:
    passages = "\n\n".join(f"[{i + 1}] {t.strip()}" for i, t in enumerate(chunk_texts))
    rows = []
    for i, it in enumerate(items):
        if it["type"] == "MCQ":
            opts = "; ".join(f"{chr(65 + k)}) {t}" for k, (t, _) in enumerate(it["options"]))
            rows.append(f'{i}. [passage {it["chunk_ref"]}] {it["question_text"]} Options: {opts}. Stated answer: {it["correct_answer"]}')
        else:
            rows.append(f'{i}. [passage {it["chunk_ref"]}] {it["question_text"]} Stated answer: {it["correct_answer"]}')
    user = (
        "STUDY MATERIAL:\n" + passages + "\n\nFor each numbered question below decide whether the stated answer is "
        "correct and consistent with the material (for language-skill questions, correct English is enough). "
        'Reply as JSON: {"results": [{"id": <number>, "supported": true|false}]}.\n\n' + "\n".join(rows)
    )
    task = {"kind": "verify", "items": [{"id": i} for i in range(len(items))]}
    return LLMRequest(system=SYSTEM, user=user, task=task, temperature=0.0, max_tokens=1500)
