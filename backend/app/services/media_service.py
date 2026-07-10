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

    ONLY Wikidata P948 — the human-curated Wikivoyage page banner — is used.
    No fuzzy fallbacks: a missing banner beats a wrong one.
    """
    name = simple_name(country_name)
    async with httpx.AsyncClient(headers=HEADERS, timeout=TIMEOUT) as client:
        qid = await _wikidata_entity(client, name)
        if not qid:
            return None
        filename = await _wikidata_image_claim(client, qid, "P948")
        if not filename:
            return None
        return await _commons_url(client, filename)


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


async def enrich_emblems_with_images(
    emblems: list[dict[str, Any]], country_name: str
) -> list[dict[str, Any]]:
    """Attach each emblem's Wikipedia page image, by EXACT article title.

    Claude supplies the canonical article title (wikipedia_title) when it is
    confident one exists; we never search. No title, or no page image → no
    image. A missing photo beats a wrong one.
    """
    async with httpx.AsyncClient(headers=HEADERS, timeout=TIMEOUT) as client:
        for emblem in emblems:
            title = (emblem.get("wikipedia_title") or "").strip()
            emblem["image_url"] = (
                await _page_thumbnail(client, title) if title else None
            )
    return emblems


async def _page_thumbnail(client: httpx.AsyncClient, title: str) -> str | None:
    try:
        response = await client.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "format": "json",
                "titles": title,
                "redirects": 1,
                "prop": "pageimages",
                "pithumbsize": 500,
            },
        )
        pages = response.json().get("query", {}).get("pages", {})
        for page_id, page in pages.items():
            if page_id == "-1":  # page does not exist
                continue
            thumbnail = page.get("thumbnail")
            if thumbnail:
                return thumbnail["source"]
    except (httpx.HTTPError, ValueError, KeyError):
        pass
    return None
