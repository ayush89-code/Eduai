# syntax=docker/dockerfile:1

FROM python:3.11-slim

WORKDIR /app

# Build deps needed by some ML/parsing libs (sentence-transformers, pypdf, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV PIP_DEFAULT_TIMEOUT=120 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Core deps first - small, fast, rarely change. Cached as its own layer so a
# failure/retry in the ML layer below never re-downloads these.
COPY requirements-core.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install --retries 10 -r requirements-core.txt

# ML deps (langchain, sentence-transformers -> torch) - largest downloads.
# Isolated in its own layer: if this fails on a flaky connection, only this
# layer needs to be retried, not the whole install.
COPY requirements-ml.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --retries 10 -r requirements-ml.txt

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
