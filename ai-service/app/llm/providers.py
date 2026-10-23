"""Step 6 - Gemini and Groq behind one interface, with per-provider rate limits and automatic failover.

Both talk plain HTTPS through httpx (already a dependency). API keys travel in headers, never in URLs,
so they cannot leak through logged error messages.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time

import httpx

from app.llm.base import LLMError, LLMRequest, Provider
from app.llm.mock import MockProvider
from app.llm.settings import LLMSettings, llm_settings

log = logging.getLogger("eduai.llm")


# ---- HTTP helpers --------------------------------------------------------

def _retry_after(r: httpx.Response) -> float | None:
    try:
        return min(float(r.headers.get("retry-after", "")), 120.0)
    except ValueError:
        return None


def _error_text(r: httpx.Response) -> str:
    try:
        msg = r.json()["error"]["message"]
    except Exception:
        msg = r.text
    return " ".join(str(msg).split())[:200]


def _post_json(url: str, *, headers: dict, payload: dict, timeout: float, provider: str) -> dict:
    try:
        r = httpx.post(url, headers=headers, json=payload, timeout=timeout)
    except httpx.TimeoutException:
        raise LLMError(f"{provider} timed out", transient=True)
    except httpx.HTTPError as exc:
        raise LLMError(f"{provider} connection problem ({type(exc).__name__})", transient=True)
    if r.status_code == 429:
        raise LLMError(f"{provider} rate limit reached", rate_limited=True, retry_after=_retry_after(r))
    if r.status_code >= 500:
        raise LLMError(f"{provider} server error {r.status_code}", transient=True)
    if r.status_code >= 400:
        raise LLMError(f"{provider} rejected the request ({r.status_code}): {_error_text(r)}")
    try:
        return r.json()
    except ValueError:
        raise LLMError(f"{provider} sent an unreadable response", transient=True)


def parse_json_text(text: str, provider: str) -> dict:
    """Models sometimes wrap JSON in ```json fences or add a sentence around it."""
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    for candidate in (t, t[t.find("{"): t.rfind("}") + 1] if "{" in t else ""):
        try:
            data = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(data, dict):
            return data
    raise LLMError(f"{provider} did not return valid JSON", transient=True)


# ---- providers -----------------------------------------------------------

class GeminiProvider(Provider):
    name = "gemini"

    def __init__(self, api_key: str, model: str, timeout: float):
        self.api_key, self.model, self.timeout = api_key, model, timeout

    def complete_json(self, req: LLMRequest) -> dict:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        payload = {
            "systemInstruction": {"parts": [{"text": req.system}]},
            "contents": [{"role": "user", "parts": [{"text": req.user}]}],
            "generationConfig": {
                "temperature": req.temperature,
                "maxOutputTokens": req.max_tokens,
                "responseMimeType": "application/json",
            },
        }
        data = _post_json(url, headers={"x-goog-api-key": self.api_key}, payload=payload,
                          timeout=self.timeout, provider=self.name)
        candidates = data.get("candidates") or []
        if not candidates:
            raise LLMError("gemini returned no answer (it may have been blocked by its safety filter)")
        parts = (candidates[0].get("content") or {}).get("parts") or []
        return parse_json_text("".join(p.get("text", "") for p in parts), self.name)


class GroqProvider(Provider):
    name = "groq"

    def __init__(self, api_key: str, model: str, timeout: float):
        self.api_key, self.model, self.timeout = api_key, model, timeout

    def complete_json(self, req: LLMRequest) -> dict:
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": req.system}, {"role": "user", "content": req.user}],
            "temperature": req.temperature,
            "max_tokens": req.max_tokens,
            "response_format": {"type": "json_object"},
        }
        data = _post_json("https://api.groq.com/openai/v1/chat/completions",
                          headers={"Authorization": f"Bearer {self.api_key}"}, payload=payload,
                          timeout=self.timeout, provider=self.name)
        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise LLMError("groq returned no answer", transient=True)
        return parse_json_text(text, self.name)


# ---- rate limiting -------------------------------------------------------

class Gate:
    """Caps simultaneous requests and spaces request starts to stay under a per-minute limit."""

    def __init__(self, rpm: int, max_concurrent: int):
        self._sem = threading.BoundedSemaphore(max(1, max_concurrent))
        self._interval = 60.0 / max(1, rpm)
        self._lock = threading.Lock()
        self._next_slot = 0.0
        self._cooldown_until = 0.0
        self.max_concurrent = max(1, max_concurrent)

    def acquire(self) -> None:
        self._sem.acquire()
        with self._lock:
            start = max(time.monotonic(), self._next_slot, self._cooldown_until)
            self._next_slot = start + self._interval
        delay = start - time.monotonic()
        if delay > 0:
            time.sleep(delay)

    def release(self) -> None:
        self._sem.release()

    def cool_down(self, seconds: float) -> None:
        with self._lock:
            self._cooldown_until = max(self._cooldown_until, time.monotonic() + seconds)

    @property
    def cooling(self) -> bool:
        return time.monotonic() < self._cooldown_until


# ---- router --------------------------------------------------------------

class LLMRouter:
    """Picks a provider per request (preference order), retries transient failures and fails over."""

    def __init__(self, providers: dict[str, Provider], gates: dict[str, Gate]):
        self.providers, self.gates = providers, gates

    @classmethod
    def from_settings(cls, s: LLMSettings | None = None) -> "LLMRouter":
        s = s or llm_settings
        force = s.llm_force.strip().lower()
        providers: dict[str, Provider] = {}
        gates: dict[str, Gate] = {}

        def add(p: Provider, rpm: int, conc: int) -> None:
            providers[p.name], gates[p.name] = p, Gate(rpm, conc)

        if force == "mock":
            add(MockProvider(), 600, 4)
        else:
            if s.gemini_api_key and force in ("", "gemini"):
                add(GeminiProvider(s.gemini_api_key, s.gemini_model, s.llm_timeout_seconds),
                    s.gemini_rpm, s.gemini_max_concurrent)
            if s.groq_api_key and force in ("", "groq"):
                add(GroqProvider(s.groq_api_key, s.groq_model, s.llm_timeout_seconds),
                    s.groq_rpm, s.groq_max_concurrent)
            if not providers:
                if force in ("gemini", "groq"):
                    raise LLMError(f"LLM_FORCE={force} but its API key is not set")
                add(MockProvider(), 600, 4)
        return cls(providers, gates)

    @property
    def names(self) -> list[str]:
        return list(self.providers)

    @property
    def is_mock(self) -> bool:
        return self.names == ["mock"]

    @property
    def total_concurrency(self) -> int:
        return sum(g.max_concurrent for g in self.gates.values())

    def complete(self, req: LLMRequest, prefer: tuple[str, ...] = (), exclude: frozenset[str] | set[str] = frozenset()
                 ) -> tuple[dict, str]:
        names = [n for n in self.names if n not in exclude]
        order = [n for n in prefer if n in names] + [n for n in names if n not in prefer]
        order.sort(key=lambda n: self.gates[n].cooling)  # stable: cooled-down providers go last
        if not order:
            raise LLMError("No AI provider is available for this request")

        last: LLMError | None = None
        for idx, name in enumerate(order):
            gate, provider = self.gates[name], self.providers[name]
            is_last = idx == len(order) - 1
            for attempt in range(2):
                gate.acquire()
                try:
                    return provider.complete_json(req), name
                except LLMError as exc:
                    last = exc
                    log.warning("LLM %s attempt %d failed: %s", name, attempt + 1, exc)
                    if exc.rate_limited:
                        gate.cool_down(exc.retry_after or 20.0)
                        if not is_last:
                            break              # another provider is free: switch now
                    elif not exc.transient:
                        break                  # retrying the same request will not help
                finally:
                    gate.release()
                if attempt == 0 and last is not None and last.transient and not last.rate_limited:
                    time.sleep(2.0)
        raise LLMError(f"All AI providers failed. Last problem: {last}")
