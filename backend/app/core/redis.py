"""Redis connection management.

Redis serves two roles in Marsad's architecture:
  1. Fast cache layer (Redis -> PostgreSQL -> external API, from Phase 2).
  2. Pub/Sub message queue for background AI generation (from Phase 4).
"""

import redis.asyncio as redis

from app.core.config import get_settings

_pool: redis.ConnectionPool | None = None


def get_redis() -> redis.Redis:
    """Return a Redis client backed by a shared connection pool."""
    global _pool
    if _pool is None:
        _pool = redis.ConnectionPool.from_url(get_settings().redis_url, decode_responses=True)
    return redis.Redis(connection_pool=_pool)


async def close_redis() -> None:
    global _pool
    if _pool is not None:
        await _pool.disconnect()
        _pool = None
