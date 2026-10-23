"""Web-search providers for the topic path. Switch with SEARCH_PROVIDER=tavily|serper."""
from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.config import settings


@dataclass(frozen=True)
class SearchHit:
    url: str
    title: str
    snippet: str


class SearchError(Exception):
    """A search problem that is safe to show to the user."""


def _raise_for_status(provider: str, resp: httpx.Response) -> None:
    code = resp.status_code
    if code == 200:
        return
    if code in (401, 403):
        raise SearchError(f"{provider} rejected the API key. Check it in your .env file.")
    if code == 429 or code in (432, 433):
        raise SearchError(f"{provider} rate or credit limit reached. Try again later.")
    if code >= 500:
        raise SearchError(f"{provider} is temporarily unavailable. Try again shortly.")
    raise SearchError(f"{provider} search failed (HTTP {code}).")


class TavilyProvider:
    name = "tavily"
    url = "https://api.tavily.com/search"

    def __init__(self, api_key: str, client: httpx.Client | None = None):
        self.api_key = api_key
        self.client = client or httpx.Client(timeout=20)

    def search(self, query: str, max_results: int) -> list[SearchHit]:
        try:
            resp = self.client.post(
                self.url,
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"query": query, "search_depth": "basic", "max_results": max_results},
            )
        except httpx.HTTPError as exc:
            raise SearchError("Could not reach Tavily. Check your internet connection.") from exc
        _raise_for_status("Tavily", resp)
        return [
            SearchHit(url=r["url"], title=r.get("title") or r["url"], snippet=r.get("content") or "")
            for r in resp.json().get("results", [])
            if r.get("url")
        ]


class SerperProvider:
    name = "serper"
    url = "https://google.serper.dev/search"

    def __init__(self, api_key: str, client: httpx.Client | None = None):
        self.api_key = api_key
        self.client = client or httpx.Client(timeout=20)

    def search(self, query: str, max_results: int) -> list[SearchHit]:
        try:
            resp = self.client.post(
                self.url,
                headers={"X-API-KEY": self.api_key, "Content-Type": "application/json"},
                json={"q": query, "num": max_results},
            )
        except httpx.HTTPError as exc:
            raise SearchError("Could not reach Serper. Check your internet connection.") from exc
        _raise_for_status("Serper", resp)
        return [
            SearchHit(url=r["link"], title=r.get("title") or r["link"], snippet=r.get("snippet") or "")
            for r in resp.json().get("organic", [])
            if r.get("link")
        ]


def provider_configured() -> bool:
    name = settings.search_provider.lower()
    if name == "serper":
        return bool(settings.serper_api_key)
    return bool(settings.tavily_api_key)


def get_provider():
    name = settings.search_provider.lower()
    if name == "serper":
        if not settings.serper_api_key:
            raise SearchError("Web search is not configured: SERPER_API_KEY is not set.")
        return SerperProvider(settings.serper_api_key)
    if name == "tavily":
        if not settings.tavily_api_key:
            raise SearchError("Web search is not configured: TAVILY_API_KEY is not set.")
        return TavilyProvider(settings.tavily_api_key)
    raise SearchError(f"Unknown SEARCH_PROVIDER '{settings.search_provider}'. Use 'tavily' or 'serper'.")
