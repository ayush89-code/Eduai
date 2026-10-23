"""Shared types for the LLM layer."""
from __future__ import annotations

from dataclasses import dataclass


class LLMError(Exception):
    """A provider problem. `transient` errors are worth retrying; `rate_limited` ones also cool the provider down."""

    def __init__(self, message: str, *, transient: bool = False, rate_limited: bool = False,
                 retry_after: float | None = None):
        super().__init__(message)
        self.rate_limited = rate_limited
        self.transient = transient or rate_limited
        self.retry_after = retry_after


@dataclass
class LLMRequest:
    system: str
    user: str
    # Structured copy of what is being asked. Real providers ignore it; the offline mock builds its
    # answer from it.
    task: dict | None = None
    max_tokens: int = 6000
    temperature: float = 0.7


class Provider:
    name = "base"

    def complete_json(self, req: LLMRequest) -> dict:
        """Return the model's answer parsed as a JSON object. Raise LLMError on any problem."""
        raise NotImplementedError
