"""Fetch a web page and extract its main article text with trafilatura."""
from __future__ import annotations

import ipaddress
import logging
import socket
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import httpx
import trafilatura

from app.ingestion.search import SearchHit

log = logging.getLogger(__name__)

MAX_BYTES = 3_000_000
MIN_CHARS = 500
MAX_REDIRECTS = 3
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; EduAIBot/0.1; educational use)"}


@dataclass(frozen=True)
class ScrapedPage:
    title: str
    text: str


def is_public_http_url(url: str) -> bool:
    """Only fetch public http(s) hosts, never localhost / private networks (SSRF guard)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443, proto=socket.IPPROTO_TCP)
        return all(ipaddress.ip_address(i[4][0]).is_global for i in infos)
    except (socket.gaierror, ValueError):
        return False


def fetch_html(url: str, client: httpx.Client) -> str | None:
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        if not is_public_http_url(current):
            return None
        with client.stream("GET", current, headers=HEADERS, follow_redirects=False) as resp:
            if resp.is_redirect:
                location = resp.headers.get("location")
                if not location:
                    return None
                current = urljoin(current, location)
                continue
            if resp.status_code != 200:
                return None
            if "html" not in resp.headers.get("content-type", "").lower():
                return None
            buf = bytearray()
            for chunk in resp.iter_bytes():
                buf += chunk
                if len(buf) > MAX_BYTES:
                    break
            return bytes(buf).decode(resp.encoding or "utf-8", errors="replace")
    return None


def scrape(url: str, client: httpx.Client) -> ScrapedPage | None:
    try:
        html = fetch_html(url, client)
        if not html:
            return None
        text = trafilatura.extract(
            html, url=url, include_comments=False, include_tables=True,
            favor_precision=True, deduplicate=True, output_format="txt",
        )
        if not text or len(text) < MIN_CHARS:
            return None
        meta = trafilatura.extract_metadata(html)
        return ScrapedPage(title=(meta.title if meta and meta.title else ""), text=text)
    except Exception as exc:  # one bad page must never fail the whole topic
        log.info("scrape failed for %s: %s", url, exc)
        return None


def scrape_many(hits: list[SearchHit], max_workers: int = 5) -> list[tuple[SearchHit, ScrapedPage | None]]:
    with httpx.Client(timeout=12) as client, ThreadPoolExecutor(max_workers=max_workers) as pool:
        pages = list(pool.map(lambda h: scrape(h.url, client), hits))
    return list(zip(hits, pages))
