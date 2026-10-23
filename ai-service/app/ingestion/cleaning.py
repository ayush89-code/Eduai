"""The shared 'extract & clean text' step: both the file path and the web path end up here."""
from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from collections import Counter

# control chars + soft hyphen (0xAD) + zero-width chars (0x200B-0x200D) + BOM (0xFEFF)
_CONTROL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f" + "".join(map(chr, (0xAD, 0x200B, 0x200C, 0x200D, 0xFEFF))) + "]")
_HYPHEN_BREAK = re.compile(r"([a-z])-\n([a-z])")
_SPACES = re.compile("[ \t" + chr(0xA0) + "]+")   # spaces, tabs, non-breaking space
_BLANK_RUNS = re.compile(r"\n{3,}")
_DIGITS = re.compile(r"\d+")
_EXPLICIT_PAGE = re.compile(
    r"^(page\s*\d{1,4}(\s*(/|of)\s*\d{1,4})?|\d{1,4}\s*(/|of)\s*\d{1,4}|-\s*\d{1,4}\s*-)$", re.I
)
_BARE_NUMBER = re.compile(r"^\d{1,3}$")

MIN_PAGES_FOR_BOILERPLATE = 4   # need enough pages to tell "repeated header" from "content"
REPEAT_FRACTION = 0.6           # a header/footer line repeats on at least this share of pages
EDGE_LINES = 3                  # only the first/last 3 lines of a page can be header/footer
SHORT_LINE = 50                 # only short lines are matched ignoring digits ("Chapter 3 | Notes")
MAX_REMOVED_FRACTION = 0.4      # safety net: if "boilerplate" is >40% of the text, it is really content


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL.sub("", text)
    text = _HYPHEN_BREAK.sub(r"\1\2", text)
    text = _SPACES.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return _BLANK_RUNS.sub("\n\n", text).strip()


def _key(line: str) -> str:
    return _DIGITS.sub("#", line.lower()) if len(line) <= SHORT_LINE else line.lower()


def _nonblank(lines: list[str]) -> list[int]:
    return [i for i, ln in enumerate(lines) if ln.strip()]


def _edge(lines: list[str], n: int) -> set[int]:
    idx = _nonblank(lines)
    return set(idx[:n] + idx[-n:])


def _drop_repeated_edges(split: list[list[str]]) -> list[list[str]]:
    seen: Counter[str] = Counter()
    for lines in split:
        seen.update({_key(lines[i]) for i in _edge(lines, EDGE_LINES) if len(lines[i]) <= 80})
    threshold = max(3, math.ceil(len(split) * REPEAT_FRACTION))
    repeated = {k for k, n in seen.items() if n >= threshold}
    if not repeated:
        return split
    out = []
    for lines in split:
        edge = _edge(lines, EDGE_LINES)
        out.append([ln for i, ln in enumerate(lines)
                    if not (i in edge and 0 < len(ln) <= 80 and _key(ln) in repeated)])
    return out


def _strip_page_numbers(lines: list[str]) -> list[str]:
    """Remove page numbers at the very top/bottom of a page ("Page 3", "3 of 10", "- 3 -", bare "3")."""
    idx = _nonblank(lines)
    edge = set(idx[:2] + idx[-2:])
    long_page = len(idx) >= 5   # a bare number is only trusted as a page number on a real page of text
    return [ln for i, ln in enumerate(lines)
            if not (i in edge and (_EXPLICIT_PAGE.match(ln.strip())
                                   or (long_page and _BARE_NUMBER.match(ln.strip()))))]


def clean_pages(pages: list[str], remove_boilerplate: bool = True) -> str:
    """Clean multi-page text (PDF pages / slides). Header/footer removal is for PDFs only."""
    pages = [normalize(p) for p in pages]
    split = [p.split("\n") for p in pages]

    if remove_boilerplate and len(pages) >= MIN_PAGES_FOR_BOILERPLATE:
        trimmed = _drop_repeated_edges(split)
        before = sum(len(p) for p in pages)
        after = sum(len("\n".join(lines)) for lines in trimmed)
        if after >= (1 - MAX_REMOVED_FRACTION) * before:
            split = trimmed

    split = [_strip_page_numbers(lines) for lines in split]
    cleaned = [normalize("\n".join(lines)) for lines in split]
    return "\n\n".join(p for p in cleaned if len(p) >= 20)


def clean_text(text: str) -> str:
    """Clean a single block of text (web page, plain text)."""
    return normalize(text)


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
