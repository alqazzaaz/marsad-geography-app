"""Background worker for AI insight generation.

Subscribes to the Redis Pub/Sub jobs channel and performs the slow Claude
calls off the request path, writing results back to PostgreSQL + Redis.
Started as an asyncio task from the FastAPI lifespan.
"""

import asyncio
import json
import logging

from app.core.redis import get_redis
from app.db.session import async_session_factory
from app.services.claude_client import BudgetExceededError, ClaudeClient, ClaudeGenerationError
from app.services.country_service import CountryService
from app.services.insights_service import JOBS_CHANNEL, KIND_INSIGHTS, InsightsService

logger = logging.getLogger(__name__)


async def run_insights_worker() -> None:
    cache = get_redis()
    pubsub = cache.pubsub()
    await pubsub.subscribe(JOBS_CHANNEL)
    logger.info("Insights worker subscribed to %s", JOBS_CHANNEL)

    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            try:
                job = json.loads(message["data"])
                await _process_job(job["code"], job["kind"])
            except Exception:
                logger.exception("Insight job failed: %r", message["data"])
    except asyncio.CancelledError:
        await pubsub.unsubscribe(JOBS_CHANNEL)
        await pubsub.aclose()
        raise


async def _process_job(code: str, kind: str) -> None:
    cache = get_redis()
    claude = ClaudeClient(cache)

    async with async_session_factory() as db:
        service = InsightsService(db, cache)
        try:
            # Someone may have generated it between enqueue and pickup.
            if await service.get_cached(code, kind) is not None:
                return

            raw_country, _ = await CountryService(db, cache).get_country(code)
            name = raw_country["name"]
            region = raw_country.get("region")

            if kind == KIND_INSIGHTS:
                data = await claude.generate_insights(name, region)
            else:
                logger.error("Unknown insight kind: %s", kind)
                return

            await service.store(code, kind, data)
            logger.info("Generated %s for %s", kind, code)
        except BudgetExceededError:
            logger.warning("Budget exceeded — dropping job %s/%s", kind, code)
        except ClaudeGenerationError:
            logger.exception("Claude generation failed for %s/%s", kind, code)
        finally:
            await service.clear_pending(code, kind)
