"""Redis outage: cached content keeps flowing from PostgreSQL, generation fails closed."""

from datetime import datetime, timezone

import pytest
import redis.asyncio as redis

from app.services.claude_client import ClaudeClient
from app.services.country_service import SOURCE_POSTGRES, CountryService
from app.services.insights_service import KIND_INSIGHTS, InsightsService


class _DownRedis:
    """Every command raises, like an unreachable Redis host."""

    def __getattr__(self, name):
        def fail(*args, **kwargs):
            raise redis.ConnectionError("Redis is down")

        return fail


class _Row:
    def __init__(self, data):
        self.data = data
        self.generated_at = datetime.now(timezone.utc)
        self.fetched_at = datetime.now(timezone.utc)


class _DbWithInsight:
    async def get(self, model, key):
        return _Row({"surprising_history": []})


@pytest.mark.asyncio
async def test_insights_fall_back_to_postgres():
    service = InsightsService(_DbWithInsight(), _DownRedis())
    cached = await service.get_cached("JO", KIND_INSIGHTS)
    assert cached["data"] == {"surprising_history": []}
    assert await service.is_generating("JO", KIND_INSIGHTS) is False


@pytest.mark.asyncio
async def test_country_falls_back_to_postgres(monkeypatch):
    raw = {"alpha2Code": "JO", "alpha3Code": "JOR", "name": "Jordan"}
    service = CountryService(db=None, cache=_DownRedis())

    async def fake_row(code):
        return _Row(raw)

    monkeypatch.setattr(service, "_get_row", fake_row)
    assert await service.get_country("jo") == (raw, SOURCE_POSTGRES)


@pytest.mark.asyncio
async def test_budget_guard_fails_closed():
    assert await ClaudeClient(_DownRedis()).budget_available() is False
