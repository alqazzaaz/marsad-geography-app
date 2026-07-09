"""Multi-layer cached access to country hard facts.

Lookup order (Marsad's core cost-control architecture, reused for AI insights
in Phase 4):

    1. Redis        — fast cache, TTL-bound
    2. PostgreSQL   — persistent cache
    3. countries.dev — the external source of truth

On a miss, the result is written back to BOTH PostgreSQL and Redis, so the
same data is never fetched from the external API twice while fresh.
"""

import json
from datetime import datetime, timedelta, timezone
from typing import Any

import redis.asyncio as redis
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.cache_sync import CacheSync
from app.models.country import Country
from app.services.countries_client import CountriesClient

DATASET_ALL_COUNTRIES = "countries_full"

REDIS_KEY_ALL = "countries:all"
REDIS_KEY_ONE = "country:{code}"

# Where a response was served from — exposed via the X-Cache-Source header.
SOURCE_REDIS = "redis"
SOURCE_POSTGRES = "postgres"
SOURCE_API = "api"


class CountryService:
    def __init__(self, db: AsyncSession, cache: redis.Redis) -> None:
        self._db = db
        self._cache = cache
        self._client = CountriesClient()
        self._settings = get_settings()

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    async def get_country(self, code: str) -> tuple[dict[str, Any], str]:
        """Return (raw country payload, cache source) for an alpha-2/3 code."""
        code = code.strip().upper()

        cached = await self._cache.get(REDIS_KEY_ONE.format(code=code))
        if cached:
            return json.loads(cached), SOURCE_REDIS

        row = await self._get_row(code)
        if row is not None and not self._is_stale(row.fetched_at):
            await self._write_redis_one(row.data)
            return row.data, SOURCE_POSTGRES

        raw = await self._client.fetch_country(code)
        await self._upsert_rows([raw])
        await self._db.commit()
        await self._write_redis_one(raw)
        return raw, SOURCE_API

    async def get_all_countries(self) -> tuple[list[dict[str, Any]], str]:
        """Return (all raw country payloads, cache source)."""
        cached = await self._cache.get(REDIS_KEY_ALL)
        if cached:
            return json.loads(cached), SOURCE_REDIS

        # PostgreSQL only counts as a hit if a full sync happened and is fresh —
        # a few individually cached countries must not masquerade as the world.
        sync = await self._db.get(CacheSync, DATASET_ALL_COUNTRIES)
        if sync is not None and not self._is_stale(sync.synced_at):
            rows = (await self._db.execute(select(Country))).scalars().all()
            payloads = [row.data for row in rows]
            await self._write_redis_all(payloads)
            return payloads, SOURCE_POSTGRES

        payloads = await self._client.fetch_all_countries()
        await self._upsert_rows(payloads)
        await self._mark_synced(DATASET_ALL_COUNTRIES)
        await self._db.commit()
        await self._write_redis_all(payloads)
        return payloads, SOURCE_API

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #

    def _is_stale(self, fetched_at: datetime) -> bool:
        max_age = timedelta(days=self._settings.country_refresh_days)
        return datetime.now(timezone.utc) - fetched_at > max_age

    async def _get_row(self, code: str) -> Country | None:
        column = Country.alpha2_code if len(code) == 2 else Country.alpha3_code
        result = await self._db.execute(select(Country).where(column == code))
        return result.scalar_one_or_none()

    async def _upsert_rows(self, payloads: list[dict[str, Any]]) -> None:
        values = [
            {
                "alpha2_code": raw["alpha2Code"],
                "alpha3_code": raw["alpha3Code"],
                "name": raw["name"],
                "region": raw.get("region"),
                "subregion": raw.get("subregion"),
                "population": raw.get("population"),
                "data": raw,
                "fetched_at": datetime.now(timezone.utc),
            }
            for raw in payloads
        ]
        stmt = pg_insert(Country).values(values)
        stmt = stmt.on_conflict_do_update(
            index_elements=[Country.alpha2_code],
            set_={
                "alpha3_code": stmt.excluded.alpha3_code,
                "name": stmt.excluded.name,
                "region": stmt.excluded.region,
                "subregion": stmt.excluded.subregion,
                "population": stmt.excluded.population,
                "data": stmt.excluded.data,
                "fetched_at": stmt.excluded.fetched_at,
            },
        )
        await self._db.execute(stmt)

    async def _mark_synced(self, dataset: str) -> None:
        stmt = pg_insert(CacheSync).values(
            dataset=dataset, synced_at=datetime.now(timezone.utc)
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[CacheSync.dataset], set_={"synced_at": stmt.excluded.synced_at}
        )
        await self._db.execute(stmt)

    async def _write_redis_one(self, raw: dict[str, Any]) -> None:
        """Cache a country under both its alpha-2 and alpha-3 codes."""
        ttl = self._settings.country_cache_ttl_seconds
        payload = json.dumps(raw)
        async with self._cache.pipeline(transaction=False) as pipe:
            pipe.set(REDIS_KEY_ONE.format(code=raw["alpha2Code"]), payload, ex=ttl)
            pipe.set(REDIS_KEY_ONE.format(code=raw["alpha3Code"]), payload, ex=ttl)
            await pipe.execute()

    async def _write_redis_all(self, payloads: list[dict[str, Any]]) -> None:
        ttl = self._settings.country_cache_ttl_seconds
        await self._cache.set(REDIS_KEY_ALL, json.dumps(payloads), ex=ttl)
