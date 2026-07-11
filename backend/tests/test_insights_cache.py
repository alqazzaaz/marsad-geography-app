"""Insights service Redis layer: pending locks deduplicate generation jobs."""

import json

import pytest

from app.services.insights_service import (
    KIND_INSIGHTS,
    PENDING_KEY,
    REDIS_KEY,
    InsightsService,
)


class _NoDb:
    """The Redis-only paths under test never touch the database."""

    def __getattr__(self, name):  # pragma: no cover - fails loudly if they do
        raise AssertionError(f"unexpected DB access: {name}")


@pytest.mark.asyncio
async def test_request_generation_publishes_once(cache):
    service = InsightsService(_NoDb(), cache)

    assert await service.request_generation("jo", KIND_INSIGHTS) is True
    # Second request while the first is pending: deduplicated, not re-published.
    assert await service.request_generation("JO", KIND_INSIGHTS) is False
    assert await cache.exists(PENDING_KEY.format(kind=KIND_INSIGHTS, code="JO"))


@pytest.mark.asyncio
async def test_clear_pending_releases_the_lock(cache):
    service = InsightsService(_NoDb(), cache)
    await service.request_generation("JO", KIND_INSIGHTS)
    await service.clear_pending("JO", KIND_INSIGHTS)
    assert await service.request_generation("JO", KIND_INSIGHTS) is True


@pytest.mark.asyncio
async def test_redis_cache_hit_skips_database(cache):
    payload = {"data": {"surprising_history": []}, "generated_at": "2026-07-11T00:00:00+00:00"}
    await cache.set(REDIS_KEY.format(kind=KIND_INSIGHTS, code="JO"), json.dumps(payload))
    service = InsightsService(_NoDb(), cache)
    assert await service.get_cached("jo", KIND_INSIGHTS) == payload


@pytest.mark.asyncio
async def test_is_generating_reflects_pending_lock(cache):
    service = InsightsService(_NoDb(), cache)
    assert await service.is_generating("JO", KIND_INSIGHTS) is False
    await service.request_generation("JO", KIND_INSIGHTS)
    assert await service.is_generating("JO", KIND_INSIGHTS) is True
