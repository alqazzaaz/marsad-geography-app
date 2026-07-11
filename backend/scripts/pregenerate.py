"""One-time pre-generation of AI content for the whole catalog.

Runs the exact same generation + storage path as the live worker, writing
straight to the configured PostgreSQL/Redis — point DATABASE_URL/REDIS_URL
at production and every country's insights, culture card, emblems (with
photos), and hero banner are cached permanently before any visitor asks.

    python -m scripts.pregenerate [--limit N] [--dry-run]

Safe to re-run: cached kinds are skipped, so an interrupted run resumes
where it left off. Countries excluded from the map worldview are skipped.
Processes most-populous countries first so the famous ones land even if
the budget runs out mid-run.
"""

import argparse
import asyncio
import logging
from datetime import datetime, timezone

from app.core.config import get_settings
from app.core.redis import get_redis
from app.db.session import async_session_factory
from app.services.claude_client import BUDGET_KEY, BudgetExceededError, ClaudeClient
from app.services.country_service import CountryService
from app.services.insights_service import (
    KIND_CULTURE,
    KIND_EMBLEMS,
    KIND_INSIGHTS,
    InsightsService,
)
from app.services.media_service import (
    KIND_MEDIA,
    MEDIA_MODEL,
    enrich_emblems_with_images,
    fetch_banner,
)

logger = logging.getLogger("pregenerate")

CONCURRENCY = 3
AI_KINDS = (KIND_INSIGHTS, KIND_CULTURE, KIND_EMBLEMS)


class Stats:
    def __init__(self) -> None:
        self.generated = 0
        self.skipped = 0
        self.failed: list[str] = []
        self.done_countries = 0


async def _process_country(
    raw: dict, stats: Stats, stop: asyncio.Event, total: int, dry_run: bool
) -> None:
    code = raw["alpha2Code"]
    name = raw["name"]
    cache = get_redis()
    claude = ClaudeClient(cache)

    async with async_session_factory() as db:
        service = InsightsService(db, cache)

        for kind in AI_KINDS:
            if stop.is_set():
                return
            if await service.get_cached(code, kind) is not None:
                stats.skipped += 1
                continue
            if dry_run:
                logger.info("[dry-run] would generate %s/%s", kind, code)
                stats.generated += 1
                continue
            try:
                if kind == KIND_INSIGHTS:
                    data = await claude.generate_insights(name, raw.get("region"))
                elif kind == KIND_EMBLEMS:
                    data = await claude.generate_emblems(name, raw.get("region"))
                    data["emblems"] = await enrich_emblems_with_images(
                        data.get("emblems", []), name
                    )
                else:
                    languages = [
                        lang.get("name", "") for lang in raw.get("languages") or []
                    ]
                    data = await claude.generate_culture(name, languages)
                await service.store(code, kind, data)
                stats.generated += 1
            except BudgetExceededError:
                logger.error("Budget ceiling reached — stopping all generation.")
                stop.set()
                return
            except Exception:
                logger.exception("Failed: %s/%s", kind, code)
                stats.failed.append(f"{kind}/{code}")

        # Hero banner: free Wikimedia lookup, cached forever like the rest.
        if not dry_run and await service.get_cached(code, KIND_MEDIA) is None:
            try:
                banner = await fetch_banner(name)
                await service.store(code, KIND_MEDIA, {"banner_url": banner}, MEDIA_MODEL)
            except Exception:
                logger.exception("Banner failed: %s", code)
                stats.failed.append(f"media/{code}")

    stats.done_countries += 1
    logger.info(
        "[%d/%d] %s done (generated %d, skipped %d, failed %d)",
        stats.done_countries, total, name, stats.generated, stats.skipped, len(stats.failed),
    )


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="only the N most populous")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    settings = get_settings()
    cache = get_redis()

    async with async_session_factory() as db:
        countries, _ = await CountryService(db, cache).get_all_countries()

    excluded = set(settings.map_excluded_list)
    countries = [
        c for c in countries
        if c["alpha2Code"] not in excluded and c["alpha3Code"] not in excluded
    ]
    countries.sort(key=lambda c: c.get("population") or 0, reverse=True)
    if args.limit:
        countries = countries[: args.limit]

    logger.info(
        "Pre-generating %d countries (budget cap $%.2f, model %s)%s",
        len(countries), settings.claude_daily_budget_usd, settings.anthropic_model,
        " [DRY RUN]" if args.dry_run else "",
    )

    stats = Stats()
    stop = asyncio.Event()
    semaphore = asyncio.Semaphore(CONCURRENCY)

    async def worker(raw: dict) -> None:
        if stop.is_set():
            return
        async with semaphore:
            await _process_country(raw, stats, stop, len(countries), args.dry_run)

    await asyncio.gather(*(worker(c) for c in countries))

    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    spend = await cache.get(BUDGET_KEY.format(day=day))
    logger.info("=" * 60)
    logger.info(
        "Finished: %d generated, %d skipped, %d failed. Today's spend: $%s",
        stats.generated, stats.skipped, len(stats.failed), spend or "0",
    )
    if stats.failed:
        logger.info("Failed items (re-run the script to retry): %s", ", ".join(stats.failed))
    if stop.is_set():
        logger.warning("Run stopped early: budget ceiling reached.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    asyncio.run(main())
