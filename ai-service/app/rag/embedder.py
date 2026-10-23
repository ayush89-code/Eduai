"""Step 5 - local embeddings (all-MiniLM-L6-v2, 384-dim, free, no API key).

The model (~90 MB) downloads on first use, then loads once per process.
"""
import os
import threading

import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
EMBEDDING_DIM = 384
BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "32"))

_model: SentenceTransformer | None = None
_lock = threading.Lock()


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                _model = SentenceTransformer(MODEL_NAME)
    return _model


def embed_texts(texts: list[str]) -> np.ndarray:
    """Return an (n, 384) float32 array of L2-normalised vectors."""
    if not texts:
        return np.zeros((0, EMBEDDING_DIM), dtype=np.float32)
    vectors = get_model().encode(
        texts,
        batch_size=BATCH_SIZE,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return vectors.astype(np.float32)


def embed_query(query: str) -> np.ndarray:
    return embed_texts([query])[0]
