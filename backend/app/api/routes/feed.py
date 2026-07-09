"""The "Did You Know?" feed.

GET /feed?limit=N
  200 {status: "ready", facts: [...]}       — random selection from the pool
  202 {status: "generating", facts: []}     — pool empty, batch being generated

Refreshing is free (a new random selection). The pool tops itself up in the
background when it runs low, gated by the daily Claude budget.
"""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import get_redis
from app.db.session import get_db
from app.services.claude_client import ClaudeClient
from app.services.feed_service import FeedService

router = APIRouter(prefix="/feed", tags=["feed"])

POOL_LOW_WATER = 24


@router.get("")
async def get_feed(
    response: Response,
    limit: int = Query(default=8, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
) -> dict:
    cache = get_redis()
    service = FeedService(db, cache)

    pool = await service.pool_size()
    if pool < POOL_LOW_WATER and await ClaudeClient(cache).budget_available():
        await service.request_top_up()

    if pool == 0:
        response.status_code = 202
        return {"status": "generating", "facts": []}

    return {"status": "ready", "facts": await service.get_random_facts(limit)}
