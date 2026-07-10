"""Claude API client for AI-generated country insights.

Cost controls live here:
  - a daily budget guard (Redis-tracked USD spend, hard stop when exceeded)
  - structured JSON output via output_config, so responses parse reliably
The caching that guarantees "one Claude call per country, ever" lives in
insights_service.py.
"""

import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

import anthropic
import redis.asyncio as redis

from app.core.config import get_settings

logger = logging.getLogger(__name__)

BUDGET_KEY = "claude:spend_usd:{day}"

SYSTEM_PROMPT = """You are the voice of Marsad (مرصد, "observatory"), a platform where curious \
people explore countries in depth. You write genuinely interesting, well-crafted insights that \
go far beyond a Wikipedia summary — surprising history, real cultural texture, what locals \
actually experience versus tourist clichés.

Accuracy rules (critical):
- Only state things you are confident are true. Prefer well-established facts.
- Never invent specific statistics, dates, or figures. If unsure of a precise detail, \
describe it in general terms instead.
- Basic facts (capital, population, currency) are shown to users from a separate verified \
source — do not repeat them; spend your words on what that source cannot provide: stories, \
context, and meaning.
- Write in polished, evocative but concise English. No filler, no clichés like "hidden gem \
nestled in"."""


class BudgetExceededError(Exception):
    """Raised when the daily Claude spend ceiling has been reached."""


class ClaudeGenerationError(Exception):
    """Raised when the Claude API call fails or returns unparseable output."""


INSIGHTS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "surprising_history": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "detail": {"type": "string"}},
                "required": ["title", "detail"],
                "additionalProperties": False,
            },
        },
        "cultural_context": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "detail": {"type": "string"}},
                "required": ["title", "detail"],
                "additionalProperties": False,
            },
        },
        "notable_people": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "known_for": {"type": "string"},
                    "widely_known": {"type": "boolean"},
                },
                "required": ["name", "known_for", "widely_known"],
                "additionalProperties": False,
            },
        },
        "hidden_gems": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"name": {"type": "string"}, "detail": {"type": "string"}},
                "required": ["name", "detail"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["surprising_history", "cultural_context", "notable_people", "hidden_gems"],
    "additionalProperties": False,
}

CULTURE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "key_phrases": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "meaning": {"type": "string"},
                    "local": {"type": "string"},
                    "pronunciation": {"type": "string"},
                },
                "required": ["meaning", "local", "pronunciation"],
                "additionalProperties": False,
            },
        },
        "dos": {"type": "array", "items": {"type": "string"}},
        "donts": {"type": "array", "items": {"type": "string"}},
        "etiquette": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"topic": {"type": "string"}, "advice": {"type": "string"}},
                "required": ["topic", "advice"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["key_phrases", "dos", "donts", "etiquette"],
    "additionalProperties": False,
}

CULTURE_PROMPT = """Write the Marsad language & culture card for {country_name} \
(primary language(s): {languages}).

Produce:
- key_phrases: 6 essential phrases in the country's most widely spoken local language — \
meaning (in English, e.g. "Hello", "Thank you"), local (written in the local script), and \
pronunciation (simple phonetic spelling an English speaker can read aloud).
- dos: 4 things a visitor should do to be polite and respectful.
- donts: 4 things considered rude or offensive that visitors often get wrong.
- etiquette: 4 practical briefings, one each on the topics "Tipping", "Dress code", \
"Greetings", and "Dining" — concrete, locally accurate advice, not generic travel tips."""

FEED_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "facts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "country_name": {"type": "string"},
                    "alpha2_code": {"type": "string"},
                    "fact": {"type": "string"},
                },
                "required": ["country_name", "alpha2_code", "fact"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["facts"],
    "additionalProperties": False,
}

FEED_PROMPT = """Write {count} entries for Marsad's "Did You Know?" feed — genuinely \
surprising, well-written facts, each about a DIFFERENT country. Each entry: country_name, \
its ISO 3166-1 alpha-2 code, and one fact of 1–3 sentences that would make a curious reader \
say "I had no idea." Draw from history, geography, language, culture, or science. Spread \
across different continents.{avoid_clause}"""

INSIGHTS_PROMPT = """Write the Marsad insights profile for {country_name} ({region}).

Produce:
- surprising_history: 3 lesser-known, genuinely surprising historical facts or stories.
- cultural_context: 3 pieces of real cultural context — what daily life and society are \
actually like, versus the tourist-brochure version.
- notable_people: 4 notable people — mix widely famous figures with people who deserve to \
be better known (set widely_known accordingly).
- hidden_gems: 3 places or experiences most visitors miss, with what makes each special.

Length discipline (strict):
- Every detail and known_for text: 2–3 sentences maximum.
- One idea per entry, stated once — cut any sentence that elaborates on a point already made.
- Sharp and surprising, never encyclopedic. Readers skim; every sentence must earn its place."""


class ClaudeClient:
    def __init__(self, cache: redis.Redis) -> None:
        self._settings = get_settings()
        self._cache = cache
        self._client = anthropic.AsyncAnthropic(api_key=self._settings.anthropic_api_key)

    # ------------------------------------------------------------------ #
    # Budget guard
    # ------------------------------------------------------------------ #

    def _budget_key(self) -> str:
        return BUDGET_KEY.format(day=datetime.now(timezone.utc).strftime("%Y-%m-%d"))

    async def budget_available(self) -> bool:
        spent = await self._cache.get(self._budget_key())
        return float(spent or 0.0) < self._settings.claude_daily_budget_usd

    async def _record_spend(self, input_tokens: int, output_tokens: int) -> None:
        cost = (
            input_tokens * self._settings.claude_input_cost_per_mtok
            + output_tokens * self._settings.claude_output_cost_per_mtok
        ) / 1_000_000
        key = self._budget_key()
        async with self._cache.pipeline(transaction=False) as pipe:
            pipe.incrbyfloat(key, cost)
            pipe.expire(key, 172800)  # keep two days, then let it drop
            await pipe.execute()
        logger.info("Claude call cost $%.4f (in=%d out=%d)", cost, input_tokens, output_tokens)

    # ------------------------------------------------------------------ #
    # Generation
    # ------------------------------------------------------------------ #

    async def generate_insights(self, country_name: str, region: str | None) -> dict[str, Any]:
        """Generate the country insights profile. Raises on budget/API errors."""
        return await self._generate_json(
            prompt=INSIGHTS_PROMPT.format(country_name=country_name, region=region or "the world"),
            schema=INSIGHTS_SCHEMA,
            max_tokens=self._settings.claude_insights_max_tokens,
        )

    async def generate_culture(self, country_name: str, languages: list[str]) -> dict[str, Any]:
        """Generate the language & culture card. Raises on budget/API errors."""
        return await self._generate_json(
            prompt=CULTURE_PROMPT.format(
                country_name=country_name, languages=", ".join(languages) or "unknown"
            ),
            schema=CULTURE_SCHEMA,
        )

    async def generate_feed_facts(
        self, count: int, avoid_countries: list[str]
    ) -> list[dict[str, Any]]:
        """Generate a batch of "Did You Know?" facts. Raises on budget/API errors."""
        avoid_clause = (
            f" Do NOT use these countries (already covered): {', '.join(avoid_countries)}."
            if avoid_countries
            else ""
        )
        result = await self._generate_json(
            prompt=FEED_PROMPT.format(count=count, avoid_clause=avoid_clause),
            schema=FEED_SCHEMA,
        )
        return result["facts"]

    async def stream_answer(
        self, system: str, messages: list[dict[str, str]], max_tokens: int = 1024
    ) -> AsyncIterator[str]:
        """Stream a free-text answer (country Q&A). Applies the budget guard."""
        if not self._settings.anthropic_api_key:
            raise ClaudeGenerationError("ANTHROPIC_API_KEY is not configured")
        if not await self.budget_available():
            raise BudgetExceededError("Daily Claude budget reached")

        try:
            async with self._client.messages.stream(
                model=self._settings.anthropic_model,
                max_tokens=max_tokens,
                system=system,
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    yield text
                final = await stream.get_final_message()
        except anthropic.APIError as exc:
            raise ClaudeGenerationError(f"Claude API error: {exc}") from exc

        await self._record_spend(final.usage.input_tokens, final.usage.output_tokens)

    async def _generate_json(
        self, prompt: str, schema: dict[str, Any], max_tokens: int | None = None
    ) -> dict[str, Any]:
        if not self._settings.anthropic_api_key:
            raise ClaudeGenerationError("ANTHROPIC_API_KEY is not configured")
        if not await self.budget_available():
            raise BudgetExceededError("Daily Claude budget reached")

        try:
            response = await self._client.messages.create(
                model=self._settings.anthropic_model,
                max_tokens=max_tokens or self._settings.claude_max_tokens,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
                output_config={"format": {"type": "json_schema", "schema": schema}},
            )
        except anthropic.APIError as exc:
            raise ClaudeGenerationError(f"Claude API error: {exc}") from exc

        await self._record_spend(response.usage.input_tokens, response.usage.output_tokens)

        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise ClaudeGenerationError(f"No text in Claude response (stop: {response.stop_reason})")
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise ClaudeGenerationError("Claude returned invalid JSON") from exc
