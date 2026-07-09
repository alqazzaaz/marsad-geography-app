"""AI insight endpoints.

GET /countries/{code}/insights
  200 {status: "ready", data, generated_at}   — served from cache
  202 {status: "generating"}                  — job queued or in flight; poll again
  429                                         — per-IP daily AI quota exceeded
  503                                         — daily Claude budget reached

Rate limiting and the budget guard only apply when generation would actually
be triggered — cached insights are always served freely.
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import check_ai_rate_limit
from app.core.redis import get_redis
from app.db.session import get_db
from app.services.claude_client import ClaudeClient
from app.services.countries_client import CountriesAPIError, CountryNotFoundError
from app.services.country_service import CountryService
from app.services.insights_service import KIND_INSIGHTS, InsightsService

router = APIRouter(prefix="/countries", tags=["insights"])


@router.get("/{code}/insights")
async def get_country_insights(
    request: Request,
    response: Response,
    code: str = Path(min_length=2, max_length=3, pattern=r"^[A-Za-z]+$"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    cache = get_redis()
    service = InsightsService(db, cache)

    # Insights are keyed by alpha-2; resolve alpha-3 lookups through the
    # (cached) country layer, which also 404s unknown codes.
    try:
        raw, _ = await CountryService(db, cache).get_country(code)
    except CountryNotFoundError:
        raise HTTPException(status_code=404, detail=f"Unknown country code: {code.upper()}")
    except CountriesAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    alpha2 = raw["alpha2Code"]

    cached = await service.get_cached(alpha2, KIND_INSIGHTS)
    if cached is not None:
        return {"status": "ready", **cached}

    if await service.is_generating(alpha2, KIND_INSIGHTS):
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

    await service.request_generation(alpha2, KIND_INSIGHTS)
    response.status_code = 202
    return {"status": "generating"}
