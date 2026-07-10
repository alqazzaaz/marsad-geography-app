"""Runtime configuration for the frontend.

The Mapbox token lives in environment variables (never in the frontend
bundle). It is a public, URL-restricted token by design — see README.
"""

from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(tags=["config"])


@router.get("/config")
async def get_client_config() -> dict:
    settings = get_settings()
    return {
        "mapbox_token": settings.mapbox_access_token,
        "map_excluded": settings.map_excluded_list,
        "map_promoted": settings.map_promoted_list,
    }
