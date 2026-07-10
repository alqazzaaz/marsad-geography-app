"""Country imagery from Wikimedia (keyless, attribution-friendly).

- Hero banner: Wikivoyage page image (purpose-made wide travel banners),
  falling back to the Wikipedia page image.
- Emblem photos: Wikipedia search thumbnails, resolved at generation time by
  the worker and cached inside the emblem payload.

Everything is cached in the same Redis -> PostgreSQL pipeline as AI content
(kind="media"), so each country hits Wikimedia once, ever.
"""

import logging
from typing import Any
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

KIND_MEDIA = "media"
MEDIA_MODEL = "wikimedia"

HEADERS = {"User-Agent": "Marsad/1.0 (https://github.com/alqazzaaz/marsad-geography-app)"}
TIMEOUT = httpx.Timeout(8.0)


def simple_name(name: str) -> str:
    """'Palestine, State of' -> 'Palestine'; 'Korea (Republic of)' -> 'Korea'."""
    return name.split(",")[0].split("(")[0].strip()


async def fetch_banner(country_name: str) -> str | None:
    """Wide hero image for a country page, or None.

    Order: Wikidata P948 (the purpose-made Wikivoyage page banner) ->
    Wikidata P18 (representative image) -> Wikipedia page image, always
    filtering out flags/maps/heraldry.
    """
    name = simple_name(country_name)
    async with httpx.AsyncClient(headers=HEADERS, timeout=TIMEOUT) as client:
        qid = await _wikidata_entity(client, name)
        if qid:
            for prop in ("P948", "P18"):
                filename = await _wikidata_image_claim(client, qid, prop)
                if filename and _is_scenic(filename):
                    url = await _commons_url(client, filename)
                    if url:
                        return url
        return await _wikipedia_image(client, name)


# Page images that are cartography/heraldry, not scenery.
_NON_SCENIC = ("flag", "map", "coat", "emblem", "locator", "orthographic", "globe", "seal")


def _is_scenic(url: str) -> bool:
    lowered = url.lower()
    return not any(term in lowered for term in _NON_SCENIC)


async def _wikidata_entity(client: httpx.AsyncClient, name: str) -> str | None:
    try:
        response = await client.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "format": "json",
                "prop": "pageprops",
                "ppprop": "wikibase_item",
                "redirects": 1,
                "titles": name,
            },
        )
        for page in response.json().get("query", {}).get("pages", {}).values():
            qid = (page.get("pageprops") or {}).get("wikibase_item")
            if qid:
                return qid
    except (httpx.HTTPError, ValueError, KeyError):
        logger.warning("Wikidata entity lookup failed for %s", name)
    return None


async def _wikidata_image_claim(
    client: httpx.AsyncClient, qid: str, prop: str
) -> str | None:
    try:
        response = await client.get(
            "https://www.wikidata.org/w/api.php",
            params={"action": "wbgetclaims", "format": "json", "entity": qid, "property": prop},
        )
        claims = response.json().get("claims", {}).get(prop, [])
        for claim in claims:
            value = claim.get("mainsnak", {}).get("datavalue", {}).get("value")
            if isinstance(value, str):
                return value
    except (httpx.HTTPError, ValueError, KeyError):
        pass
    return None


async def _commons_url(client: httpx.AsyncClient, filename: str) -> str | None:
    try:
        response = await client.get(
            "https://commons.wikimedia.org/w/api.php",
            params={
                "action": "query",
                "format": "json",
                "titles": f"File:{filename}",
                "prop": "imageinfo",
                "iiprop": "url",
                "iiurlwidth": 1400,
            },
        )
        for page in response.json().get("query", {}).get("pages", {}).values():
            image_info = (page.get("imageinfo") or [{}])[0]
            url = image_info.get("thumburl") or image_info.get("url")
            if url:
                return url
    except (httpx.HTTPError, ValueError, KeyError):
        pass
    return None


async def _wikipedia_image(client: httpx.AsyncClient, name: str) -> str | None:
    try:
        response = await client.get(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(name)}"
        )
        data = response.json()
        image = data.get("originalimage") or data.get("thumbnail")
        if image and _is_scenic(image.get("source", "")):
            return image["source"]
        return None
    except (httpx.HTTPError, ValueError, KeyError):
        logger.warning("Wikipedia image lookup failed for %s", name)
        return None


async def enrich_emblems_with_images(
    emblems: list[dict[str, Any]], country_name: str
) -> list[dict[str, Any]]:
    """Attach a Wikipedia search thumbnail to each emblem (best effort)."""
    country = simple_name(country_name)
    async with httpx.AsyncClient(headers=HEADERS, timeout=TIMEOUT) as client:
        for emblem in emblems:
            term = emblem.get("name", "").split("(")[0].strip()
            emblem["image_url"] = await _search_thumbnail(client, f"{term} {country}") or (
                await _search_thumbnail(client, term)
            )
    return emblems


async def _search_thumbnail(client: httpx.AsyncClient, query: str) -> str | None:
    try:
        response = await client.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "format": "json",
                "generator": "search",
                "gsrsearch": query,
                "gsrlimit": 1,
                "prop": "pageimages",
                "pithumbsize": 500,
            },
        )
        pages = response.json().get("query", {}).get("pages", {})
        for page in pages.values():
            thumbnail = page.get("thumbnail")
            if thumbnail:
                return thumbnail["source"]
    except (httpx.HTTPError, ValueError, KeyError):
        pass
    return None
