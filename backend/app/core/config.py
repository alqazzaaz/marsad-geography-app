"""Application configuration.

All settings are read from environment variables (or a local .env file in
development). Nothing secret is ever hardcoded here — see .env.example at the
repository root for the full list of required variables.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- App ---
    app_name: str = "Marsad API"
    environment: str = "development"  # development | production
    api_prefix: str = "/api"

    # --- CORS ---
    # Comma-separated list of allowed origins (the Angular dev server by default).
    cors_origins: str = "http://localhost:4200"

    # --- PostgreSQL ---
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "marsad"
    postgres_password: str = "marsad"
    postgres_db: str = "marsad"

    # --- Redis ---
    redis_url: str = "redis://localhost:6379/0"

    # --- External services (used from Phase 2/4 onward) ---
    countries_api_base_url: str = "https://countries.dev"
    anthropic_api_key: str = ""
    mapbox_access_token: str = ""

    # --- Caching (country hard facts) ---
    country_cache_ttl_seconds: int = 86400  # Redis TTL: 24h
    country_refresh_days: int = 30  # PostgreSQL rows older than this are re-fetched

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
