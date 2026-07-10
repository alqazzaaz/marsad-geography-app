"""Dynamic country Q&A — ask the observatory about the country you're viewing.

POST /countries/{code}/ask streams the answer as Server-Sent Events:
  data: {"text": "..."}   — incremental chunks
  data: {"done": true}    — end of answer
  data: {"error": "..."}  — mid-stream failure

Unlike insights, answers are NOT cached — every question is a live Claude
call, so the per-IP rate limit and the daily budget guard both apply to
every request.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import check_ai_rate_limit
from app.core.redis import get_redis
from app.db.session import get_db
from app.services.claude_client import (
    BudgetExceededError,
    ClaudeClient,
    ClaudeGenerationError,
)
from app.services.countries_client import CountriesAPIError, CountryNotFoundError
from app.services.country_service import CountryService
from app.services.insights_service import KIND_INSIGHTS, InsightsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/countries", tags=["ask"])

MAX_HISTORY = 6

ASK_SYSTEM_PROMPT = """You are the Marsad observatory's cultural guide for {country_name}. \
A curious visitor is exploring this country and asking you questions.

The visitor can already see a profile with these AI-crafted insights — do NOT repeat them; \
build on them or cover new ground:
{insights_context}

Rules:
- Answer only about {country_name} (its history, culture, people, places, language, daily \
life). If asked about something unrelated, gently steer back to the country.
- Be accurate. Never invent specific statistics, dates, or figures — if unsure of a precise \
detail, describe it in general terms.
- Write 2–5 short, polished paragraphs at most. Plain text only, no markdown or lists.
- Basic facts (capital, population, currency) are shown to the visitor from a verified \
source; don't recite them unless directly asked."""


class ChatMessage(BaseModel):
    role: str = Field(pattern=r"^(user|assistant)$")
    content: str = Field(min_length=1, max_length=4000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    history: list[ChatMessage] = Field(default_factory=list, max_length=MAX_HISTORY)


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@router.post("/{code}/ask")
async def ask_country(
    body: AskRequest,
    request: Request,
    code: str = Path(min_length=2, max_length=3, pattern=r"^[A-Za-z]+$"),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    cache = get_redis()

    try:
        raw, _ = await CountryService(db, cache).get_country(code)
    except CountryNotFoundError:
        raise HTTPException(status_code=404, detail=f"Unknown country code: {code.upper()}")
    except CountriesAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    claude = ClaudeClient(cache)
    if not await claude.budget_available():
        raise HTTPException(
            status_code=503,
            detail="The observatory has reached its daily limit. Try again tomorrow.",
        )
    if not await check_ai_rate_limit(cache, request):
        raise HTTPException(
            status_code=429,
            detail="You have reached today's limit for questions. Try again tomorrow.",
        )

    # Cached insights become context so answers complement what's on screen.
    cached = await InsightsService(db, cache).get_cached(raw["alpha2Code"], KIND_INSIGHTS)
    insights_context = (
        json.dumps(cached["data"], ensure_ascii=False)
        if cached
        else "(no insights generated yet)"
    )

    system = ASK_SYSTEM_PROMPT.format(
        country_name=raw["name"], insights_context=insights_context
    )
    messages = [{"role": m.role, "content": m.content} for m in body.history[-MAX_HISTORY:]]
    messages.append({"role": "user", "content": body.question})

    async def event_stream():
        try:
            async for chunk in claude.stream_answer(system, messages):
                yield _sse({"text": chunk})
            yield _sse({"done": True})
        except BudgetExceededError:
            yield _sse({"error": "The observatory has reached its daily limit."})
        except ClaudeGenerationError:
            logger.exception("Q&A stream failed for %s", code)
            yield _sse({"error": "The observatory could not answer. Please try again."})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
