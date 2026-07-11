"""Per-IP daily rate limit for AI-generation triggers."""

import pytest
from starlette.requests import Request

from app.core.config import get_settings
from app.core.rate_limit import check_ai_rate_limit, client_ip


def _request(client_host: str = "203.0.113.9", forwarded: str | None = None) -> Request:
    headers = []
    if forwarded is not None:
        headers.append((b"x-forwarded-for", forwarded.encode()))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": headers,
            "client": (client_host, 1234),
            "query_string": b"",
        }
    )


def test_client_ip_prefers_first_forwarded_hop():
    req = _request(forwarded="198.51.100.7, 10.0.0.1")
    assert client_ip(req) == "198.51.100.7"


def test_client_ip_falls_back_to_socket_peer():
    assert client_ip(_request()) == "203.0.113.9"


@pytest.mark.asyncio
async def test_limit_allows_up_to_quota_then_blocks(cache, clean_settings):
    clean_settings.setenv("AI_RATE_LIMIT_PER_DAY", "3")
    get_settings.cache_clear()
    req = _request()
    results = [await check_ai_rate_limit(cache, req) for _ in range(4)]
    assert results == [True, True, True, False]


@pytest.mark.asyncio
async def test_limit_is_per_ip(cache, clean_settings):
    clean_settings.setenv("AI_RATE_LIMIT_PER_DAY", "1")
    get_settings.cache_clear()
    assert await check_ai_rate_limit(cache, _request("203.0.113.9")) is True
    assert await check_ai_rate_limit(cache, _request("203.0.113.9")) is False
    # A different visitor is unaffected.
    assert await check_ai_rate_limit(cache, _request("203.0.113.10")) is True
