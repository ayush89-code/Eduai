"""Step 5 - text cleaning and chunking.

~800 chars per chunk with 120 overlap. all-MiniLM-L6-v2 truncates input at
256 word-pieces, so chunks must stay well under that or their tails are
silently ignored by the embedder.
"""
import re
from dataclasses import dataclass

from langchain_text_splitters import RecursiveCharacterTextSplitter

CHUNK_SIZE = 800
CHUNK_OVERLAP = 120
MIN_CHUNK_CHARS = 40  # drop fragments such as stray headings / page numbers

_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
    separators=["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ""],
)


@dataclass(frozen=True)
class Chunk:
    index: int
    text: str
    token_count: int  # rough word count, informational only


def clean_text(raw: str) -> str:
    text = raw.replace("\x00", " ").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_text(raw: str) -> list[Chunk]:
    text = clean_text(raw or "")
    if not text:
        return []
    pieces = [p.strip() for p in _splitter.split_text(text)]
    pieces = [p for p in pieces if len(p) >= MIN_CHUNK_CHARS]
    return [Chunk(index=i, text=p, token_count=len(p.split())) for i, p in enumerate(pieces)]
