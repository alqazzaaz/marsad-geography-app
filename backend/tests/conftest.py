"""Shared fixtures: fake Redis and clean settings per test."""

import fakeredis.aioredis
import pytest

from app.core.config import get_settings


@pytest.fixture(autouse=True)
def clean_settings(monkeypatch):
    """Isolate each test from the host environment and the settings cache."""
    for var in (
        "DATABASE_URL",
        "REDIS_URL",
        "POSTGRES_HOST",
        "POSTGRES_PORT",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_DB",
        "MAP_EXCLUDED_COUNTRIES",
        "MAP_PROMOTED_COUNTRIES",
        "CLAUDE_DAILY_BUDGET_USD",
        "AI_RATE_LIMIT_PER_DAY",
        "ANTHROPIC_API_KEY",
    ):
        monkeypatch.delenv(var, raising=False)
    get_settings.cache_clear()
    yield monkeypatch
    get_settings.cache_clear()


@pytest.fixture
def cache():
    """In-memory Redis matching production client config (decoded responses)."""
    return fakeredis.aioredis.FakeRedis(decode_responses=True)
