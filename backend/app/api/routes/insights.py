"""AI content endpoints (insights + language & culture card).

GET /countries/{code}/insights | /countries/{code}/culture
  200 {status: "ready", data, generated_at}   — served from cache
  202 {status: "generating"}                  — job queued or in flight; poll again
  429                                         — per-IP daily AI quota exceeded
  503                                         — daily Claude budget reached

Rate limiting and the budget guard only apply when generation would actually
be triggered — cached content is always served freely.
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import check_ai_rate_limit
from app.core.redis import get_redis
from app.db.session import get_db
from app.services.claude_client import ClaudeClient
from app.services.countries_client import CountriesAPIError, CountryNotFoundError
from app.services.country_service import CountryService
from app.services.insights_service import (
    KIND_CULTURE,
    KIND_EMBLEMS,
    KIND_INSIGHTS,
    InsightsService,
)
from app.services.media_service import KIND_MEDIA, MEDIA_MODEL, fetch_banner

router = APIRouter(prefix="/countries", tags=["insights"])

CODE_PATH = Path(min_length=2, max_length=3, pattern=r"^[A-Za-z]+$")


async def _serve_ai_content(
    kind: str, code: str, request: Request, response: Response, db: AsyncSession
) -> dict:
    cache = get_redis()
    service = InsightsService(db, cache)

    # AI content is keyed by alpha-2; resolve alpha-3 lookups through the
    # (cached) country layer, which also 404s unknown codes.
    try:
        raw, _ = await CountryService(db, cache).get_country(code)
    except CountryNotFoundError:
        raise HTTPException(status_code=404, detail=f"Unknown country code: {code.upper()}")
    except CountriesAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    alpha2 = raw["alpha2Code"]

    cached = await service.get_cached(alpha2, kind)
    if cached is not None:
        return {"status": "ready", **cached}

    if await service.is_generating(alpha2, kind):
        response.status_code = 202
        return {"status": "generating"}

    # A generation is needed — apply cost controls before queueing.
    if not await ClaudeClient(cache).budget_available():
        raise HTTPException(
            status_code=503,
            detail="The observatory has reached its daily limit for new insights. "
            "Already-explored countries remain available — try again tomorrow.",
        )
    if not await check_ai_rate_limit(cache, request):
        raise HTTPException(
            status_code=429,
            detail="You have reached today's limit for new AI insights. Try again tomorrow.",
        )

    await service.request_generation(alpha2, kind)
    response.status_code = 202
    return {"status": "generating"}


@router.get("/{code}/insights")
async def get_country_insights(
    request: Request,
    response: Response,
    code: str = CODE_PATH,
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await _serve_ai_content(KIND_INSIGHTS, code, request, response, db)


@router.get("/{code}/culture")
async def get_country_culture(
    request: Request,
    response: Response,
    code: str = CODE_PATH,
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await _serve_ai_content(KIND_CULTURE, code, request, response, db)


@router.get("/{code}/emblems")
async def get_country_emblems(
    request: Request,
    response: Response,
    code: str = CODE_PATH,
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await _serve_ai_content(KIND_EMBLEMS, code, request, response, db)


@router.get("/{code}/media")
async def get_country_media(
    code: str = CODE_PATH,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Hero banner from Wikivoyage/Wikipedia — free APIs, cached forever."""
    cache = get_redis()
    service = InsightsService(db, cache)

    try:
        raw, _ = await CountryService(db, cache).get_country(code)
    except CountryNotFoundError:
        raise HTTPException(status_code=404, detail=f"Unknown country code: {code.upper()}")
    except CountriesAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    alpha2 = raw["alpha2Code"]

    cached = await service.get_cached(alpha2, KIND_MEDIA)
    if cached is None:
        banner = await fetch_banner(raw["name"])
        cached = await service.store(alpha2, KIND_MEDIA, {"banner_url": banner}, MEDIA_MODEL)

    return {"banner_url": cached["data"].get("banner_url")}
