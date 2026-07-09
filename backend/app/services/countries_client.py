"""HTTP client for the countries.dev API (free, keyless).

This is the outermost layer of the cache hierarchy — only reached when both
Redis and PostgreSQL miss.
"""

from typing import Any

import httpx

from app.core.config import get_settings


class CountriesAPIError(Exception):
    """Raised when countries.dev is unreachable or returns an error."""


class CountryNotFoundError(Exception):
    """Raised when a country code does not exist upstream."""


class CountriesClient:
    def __init__(self) -> None:
        self._base_url = get_settings().countries_api_base_url

    async def fetch_country(self, code: str) -> dict[str, Any]:
        """Fetch a single country by ISO 3166 alpha-2 or alpha-3 code."""
        return await self._get(f"/alpha/{code}")

    async def fetch_all_countries(self) -> list[dict[str, Any]]:
        """Fetch all countries (full payloads)."""
        return await self._get("/countries", params={"limit": 500})

    async def _get(self, path: str, params: dict | None = None) -> Any:
        try:
            async with httpx.AsyncClient(base_url=self._base_url, timeout=20.0) as client:
                response = await client.get(path, params=params)
        except httpx.HTTPError as exc:
            raise CountriesAPIError(f"countries.dev request failed: {exc}") from exc

        if response.status_code == 404:
            raise CountryNotFoundError(path)
        if response.is_error:
            raise CountriesAPIError(
                f"countries.dev returned {response.status_code} for {path}"
            )
        return response.json()
