"""Country endpoints — hard facts served through the multi-layer cache.

Every response carries an X-Cache-Source header (redis | postgres | api)
showing which layer served it.
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import get_redis
from app.db.session import get_db
from app.schemas.country import CountryDetail, CountrySummary, detail_from_raw, summary_from_raw
from app.services.countries_client import CountriesAPIError, CountryNotFoundError
from app.services.country_service import CountryService

router = APIRouter(prefix="/countries", tags=["countries"])


def get_country_service(db: AsyncSession = Depends(get_db)) -> CountryService:
    return CountryService(db=db, cache=get_redis())


@router.get("", response_model=list[CountrySummary])
async def list_countries(
    response: Response,
    service: CountryService = Depends(get_country_service),
) -> list[CountrySummary]:
    try:
        payloads, source = await service.get_all_countries()
    except CountriesAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    response.headers["X-Cache-Source"] = source
    return [summary_from_raw(raw) for raw in payloads]


@router.get("/{code}", response_model=CountryDetail)
async def get_country(
    response: Response,
    code: str = Path(min_length=2, max_length=3, pattern=r"^[A-Za-z]+$"),
    service: CountryService = Depends(get_country_service),
) -> CountryDetail:
    try:
        raw, source = await service.get_country(code)
    except CountryNotFoundError:
        raise HTTPException(status_code=404, detail=f"Unknown country code: {code.upper()}")
    except CountriesAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    response.headers["X-Cache-Source"] = source
    return detail_from_raw(raw)
