from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://eduai:eduai_pass@localhost:5432/eduai"
    kafka_bootstrap_servers: str = "localhost:9092"
    jwt_secret: str = "dev-only-change-me-in-prod-please"

    huggingface_api_key: str = ""
    tavily_api_key: str = ""
    serper_api_key: str = ""

    # --- Step 4: ingestion ---
    search_provider: str = "tavily"          # "tavily" | "serper"
    search_monthly_cap: int = 800            # block new web searches past this (Tavily free = 1000 credits)
    topic_max_results: int = 5               # pages fetched per topic search
    max_upload_mb: int = 20
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
