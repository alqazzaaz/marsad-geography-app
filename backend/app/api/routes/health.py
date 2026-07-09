"""Health-check endpoints.

/api/health verifies connectivity to both PostgreSQL and Redis so that a
single request confirms the whole Phase 1 stack is wired together.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import get_redis
from app.db.session import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)) -> dict:
    postgres_status = "ok"
    redis_status = "ok"

    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        postgres_status = "unavailable"

    try:
        await get_redis().ping()
    except Exception:
        redis_status = "unavailable"

    healthy = postgres_status == "ok" and redis_status == "ok"
    return {
        "status": "healthy" if healthy else "degraded",
        "services": {"postgres": postgres_status, "redis": redis_status},
    }
