"""Per-IP daily rate limiting for AI-generation requests (Redis-backed)."""

from datetime import datetime, timezone

import redis.asyncio as redis
from fastapi import Request

from app.core.config import get_settings

RATE_KEY = "ratelimit:ai:{ip}:{day}"


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def check_ai_rate_limit(cache: redis.Redis, request: Request) -> bool:
    """Count one AI-generation request for this IP. Returns False if over quota."""
    settings = get_settings()
    key = RATE_KEY.format(
        ip=client_ip(request), day=datetime.now(timezone.utc).strftime("%Y-%m-%d")
    )
    async with cache.pipeline(transaction=False) as pipe:
        pipe.incr(key)
        pipe.expire(key, 86400)
        count, _ = await pipe.execute()
    return int(count) <= settings.ai_rate_limit_per_day
