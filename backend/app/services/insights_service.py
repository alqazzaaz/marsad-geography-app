"""AI insights through the same multi-layer cache as country facts.

Lookup: Redis -> PostgreSQL -> (background) Claude generation.

Cost invariant: PostgreSQL rows never expire, so the same country never
triggers a second Claude call. Generation itself is asynchronous — a cache
miss publishes a job on Redis Pub/Sub and returns immediately; the background
worker (insights_worker.py) does the slow Claude call and writes back to both
stores. A short-lived Redis lock deduplicates concurrent requests.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as redis
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.country_insight import CountryInsight

logger = logging.getLogger(__name__)

JOBS_CHANNEL = "marsad:insight-jobs"
REDIS_KEY = "insights:{kind}:{code}"
PENDING_KEY = "insights:pending:{kind}:{code}"
PENDING_TTL = 180  # seconds — lock expires if the worker dies mid-generation

KIND_INSIGHTS = "insights"
KIND_CULTURE = "culture"
KIND_EMBLEMS = "emblems"


class InsightsService:
    def __init__(self, db: AsyncSession, cache: redis.Redis) -> None:
        self._db = db
        self._cache = cache
        self._settings = get_settings()

    async def get_cached(self, code: str, kind: str) -> dict[str, Any] | None:
        """Return cached insight payload (Redis, then PostgreSQL) or None."""
        code = code.upper()

        cached = await self._cache.get(REDIS_KEY.format(kind=kind, code=code))
        if cached:
            return json.loads(cached)

        row = await self._db.get(CountryInsight, (code, kind))
        if row is not None:
            payload = self._payload(row.data, row.generated_at)
            await self._write_redis(code, kind, payload)
            return payload

        return None

    async def is_generating(self, code: str, kind: str) -> bool:
        return bool(await self._cache.exists(PENDING_KEY.format(kind=kind, code=code.upper())))

    async def request_generation(self, code: str, kind: str) -> bool:
        """Enqueue a generation job unless one is already in flight.

        Returns True if a new job was published, False if one was pending.
        """
        code = code.upper()
        acquired = await self._cache.set(
            PENDING_KEY.format(kind=kind, code=code), "1", nx=True, ex=PENDING_TTL
        )
        if not acquired:
            return False
        await self._cache.publish(JOBS_CHANNEL, json.dumps({"code": code, "kind": kind}))
        return True

    async def store(
        self, code: str, kind: str, data: dict[str, Any], model: str | None = None
    ) -> dict[str, Any]:
        """Write a generated payload to BOTH PostgreSQL and Redis."""
        code = code.upper()
        generated_at = datetime.now(timezone.utc)

        stmt = pg_insert(CountryInsight).values(
            alpha2_code=code,
            kind=kind,
            model=model or self._settings.anthropic_model,
            data=data,
            generated_at=generated_at,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[CountryInsight.alpha2_code, CountryInsight.kind],
            set_={"data": stmt.excluded.data, "model": stmt.excluded.model,
                  "generated_at": stmt.excluded.generated_at},
        )
        await self._db.execute(stmt)
        await self._db.commit()

        payload = self._payload(data, generated_at)
        await self._write_redis(code, kind, payload)
        return payload

    async def clear_pending(self, code: str, kind: str) -> None:
        await self._cache.delete(PENDING_KEY.format(kind=kind, code=code.upper()))

    def _payload(self, data: dict[str, Any], generated_at: datetime) -> dict[str, Any]:
        return {"data": data, "generated_at": generated_at.isoformat()}

    async def _write_redis(self, code: str, kind: str, payload: dict[str, Any]) -> None:
        await self._cache.set(
            REDIS_KEY.format(kind=kind, code=code),
            json.dumps(payload),
            ex=self._settings.insights_cache_ttl_seconds,
        )
