"""The "Did You Know?" feed.

Serving is free: readers get a random selection from the PostgreSQL fact
pool, so refreshing costs nothing. Generation is pooled — a background job
tops the pool up in batches when it runs low, gated by the daily budget.
"""

import logging
from typing import Any

import redis.asyncio as redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.feed_fact import FeedFact
from app.services.insights_service import InsightsService

logger = logging.getLogger(__name__)

KIND_FEED = "feed"
FEED_JOB_CODE = "WW"  # feed jobs are world-scoped, not per-country
BATCH_SIZE = 10


class FeedService:
    def __init__(self, db: AsyncSession, cache: redis.Redis) -> None:
        self._db = db
        self._cache = cache
        self._settings = get_settings()

    async def pool_size(self) -> int:
        return (await self._db.execute(select(func.count(FeedFact.id)))).scalar_one()

    async def get_random_facts(self, limit: int) -> list[dict[str, Any]]:
        rows = (
            (await self._db.execute(select(FeedFact).order_by(func.random()).limit(limit)))
            .scalars()
            .all()
        )
        return [
            {
                "id": row.id,
                "country_name": row.country_name,
                "alpha2_code": row.alpha2_code,
                "fact": row.fact,
            }
            for row in rows
        ]

    async def request_top_up(self) -> bool:
        """Queue a batch-generation job (deduplicated via the pending lock)."""
        return await InsightsService(self._db, self._cache).request_generation(
            FEED_JOB_CODE, KIND_FEED
        )

    async def covered_countries(self, sample: int = 40) -> list[str]:
        rows = (
            (
                await self._db.execute(
                    select(FeedFact.country_name).distinct().limit(sample)
                )
            )
            .scalars()
            .all()
        )
        return list(rows)

    async def store_facts(self, facts: list[dict[str, Any]]) -> None:
        for fact in facts:
            code = (fact.get("alpha2_code") or "").upper()
            self._db.add(
                FeedFact(
                    alpha2_code=code if len(code) == 2 else None,
                    country_name=fact["country_name"],
                    fact=fact["fact"],
                    model=self._settings.anthropic_model,
                )
            )
        await self._db.commit()
