"""Daily USD budget guard: metered from real token counts, hard stop at cap."""

from datetime import datetime, timezone

import pytest

from app.core.config import get_settings
from app.services.claude_client import BUDGET_KEY, ClaudeClient


def _today_key() -> str:
    return BUDGET_KEY.format(day=datetime.now(timezone.utc).strftime("%Y-%m-%d"))


@pytest.mark.asyncio
async def test_budget_available_when_untouched(cache):
    assert await ClaudeClient(cache).budget_available() is True


@pytest.mark.asyncio
async def test_record_spend_uses_real_token_pricing(cache):
    client = ClaudeClient(cache)
    # 1M input @ $3 + 1M output @ $15 = $18 exactly (sonnet pricing defaults)
    await client._record_spend(1_000_000, 1_000_000)
    assert float(await cache.get(_today_key())) == pytest.approx(18.0)


@pytest.mark.asyncio
async def test_budget_blocks_once_cap_reached(cache, clean_settings):
    clean_settings.setenv("CLAUDE_DAILY_BUDGET_USD", "0.05")
    get_settings.cache_clear()
    client = ClaudeClient(cache)
    assert await client.budget_available() is True
    await client._record_spend(10_000, 1_000)  # $0.03 + $0.015 = $0.045
    assert await client.budget_available() is True
    await client._record_spend(10_000, 1_000)  # now $0.09 > $0.05
    assert await client.budget_available() is False


@pytest.mark.asyncio
async def test_spend_accumulates_across_clients(cache):
    await ClaudeClient(cache)._record_spend(500_000, 0)  # $1.50
    await ClaudeClient(cache)._record_spend(500_000, 0)  # $3.00 total
    assert float(await cache.get(_today_key())) == pytest.approx(3.0)
