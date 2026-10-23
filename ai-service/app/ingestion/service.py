"""Background jobs: file -> cleaned text, topic -> search -> scrape -> cleaned text."""
from __future__ import annotations

import logging

from app.core.config import settings
from app.ingestion import repository as repo
from app.ingestion.cleaning import clean_pages, clean_text
from app.ingestion.extractors import ExtractionError, extract, file_extension
from app.ingestion.scraper import scrape_many
from app.ingestion.search import SearchError
from app.rag.indexer import auto_index_source  # Step 5: chunk + embed once a source is READY

log = logging.getLogger(__name__)

MIN_TEXT_CHARS = 50
MIN_SNIPPET_CHARS = 200


class IngestError(Exception):
    """A processing failure that is safe to show to the user."""


def _fail(source_id: str, message: str) -> None:
    repo.set_status(source_id, "FAILED", message)


def process_document(source_id: str, filename: str, data: bytes) -> None:
    try:
        repo.set_status(source_id, "PROCESSING")
        text = clean_pages(extract(filename, data), remove_boilerplate=file_extension(filename) == ".pdf")
        if len(text) < MIN_TEXT_CHARS:
            raise IngestError("Almost no readable text was found in this file.")
        repo.add_document(source_id, url=None, filename=filename, title=filename, raw_text=text)
        repo.set_status(source_id, "READY")
        auto_index_source(source_id)  # Step 5 (never raises)
    except (ExtractionError, IngestError) as exc:
        _fail(source_id, str(exc))
    except Exception:
        log.exception("document ingestion failed for source %s", source_id)
        _fail(source_id, "Unexpected error while processing the file.")


def process_topic(source_id: str, topic: str, provider) -> None:
    try:
        repo.set_status(source_id, "PROCESSING")
        hits = provider.search(topic, settings.topic_max_results)
        seen: set[str] = set()
        unique = [h for h in hits if not (h.url in seen or seen.add(h.url))]

        saved = 0
        for hit, page in scrape_many(unique):
            if page:
                text, title = clean_text(page.text), page.title or hit.title
            elif len(hit.snippet) >= MIN_SNIPPET_CHARS:   # scrape failed: fall back to the search excerpt
                text, title = clean_text(hit.snippet), f"{hit.title} (search excerpt)"
            else:
                continue
            repo.add_document(source_id, url=hit.url, filename=None, title=title, raw_text=text)
            saved += 1
        if saved == 0:
            raise IngestError("The search found no pages with readable text. Try a more specific topic.")
        repo.set_status(source_id, "READY")
        auto_index_source(source_id)  # Step 5 (never raises)
    except (SearchError, IngestError) as exc:
        _fail(source_id, str(exc))
    except Exception:
        log.exception("topic ingestion failed for source %s", source_id)
        _fail(source_id, "Unexpected error while processing the topic.")
