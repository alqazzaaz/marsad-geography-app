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

    # --- Map worldview (comma-separated ISO codes; list BOTH alpha-2 and
    # alpha-3 forms, e.g. "IL,ISR"). Excluded countries are removed from map
    # interactivity and labels; promoted countries are made clickable even
    # where the base cartography marks their territory as disputed, and get
    # a custom label.
    map_excluded_countries: str = ""
    map_promoted_countries: str = ""

    @property
    def map_excluded_list(self) -> list[str]:
        return [c.strip().upper() for c in self.map_excluded_countries.split(",") if c.strip()]

    @property
    def map_promoted_list(self) -> list[str]:
        return [c.strip().upper() for c in self.map_promoted_countries.split(",") if c.strip()]

    # --- Caching (country hard facts) ---
    country_cache_ttl_seconds: int = 86400  # Redis TTL: 24h
    country_refresh_days: int = 30  # PostgreSQL rows older than this are re-fetched

    # --- AI insights (Claude) ---
    anthropic_model: str = "claude-sonnet-4-6"
    claude_max_tokens: int = 4096
    # Tighter cap for the insights profile (entries are 2-3 sentences).
    claude_insights_max_tokens: int = 2600
    # Pricing per million tokens for the model above — used by the budget guard.
    claude_input_cost_per_mtok: float = 3.0
    claude_output_cost_per_mtok: float = 15.0
    # Hard daily spend ceiling (USD). Once reached, no more Claude calls that day.
    claude_daily_budget_usd: float = 5.0
    # Insights stay in Redis this long; PostgreSQL keeps them forever so the
    # same country never triggers a second Claude call.
    insights_cache_ttl_seconds: int = 86400
    # Max AI-generation requests per IP per day.
    ai_rate_limit_per_day: int = 30

    # --- Observability ---
    # Sentry error tracking activates only when a DSN is provided.
    sentry_dsn: str = ""

    # --- Authentication (JWT) ---
    # MUST be overridden with a long random value in production (.env).
    jwt_secret_key: str = "dev-only-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

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
