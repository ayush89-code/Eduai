"""LLM provider settings (environment variables or .env, same mechanism as app/core/config.py).

With no API keys set, generation runs in offline test mode (template questions built from your
material) so the whole pipeline can be tried before any key exists.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class LLMSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: str = ""   # Google AI Studio key
    groq_api_key: str = ""     # console.groq.com key

    # Model names and free-tier limits change often: check each dashboard and override in .env.
    gemini_model: str = "gemini-flash-latest"   # Google's "always the current Flash model" alias
    groq_model: str = "llama-3.3-70b-versatile"
    gemini_rpm: int = 10                 # requests per minute we allow ourselves (keep below the real limit)
    groq_rpm: int = 20
    gemini_max_concurrent: int = 2       # simultaneous requests
    groq_max_concurrent: int = 3

    llm_force: str = ""                  # "", "mock", "gemini" or "groq": force a single provider
    llm_verify: bool = False             # second provider double-checks MCQ / true-false / fill-blank answers
    llm_timeout_seconds: int = 90


llm_settings = LLMSettings()
