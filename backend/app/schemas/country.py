"""Pydantic schemas for country responses.

These map the raw countries.dev payload into a stable API contract, so the
frontend never depends on the upstream provider's exact shape.
"""

from typing import Any

from pydantic import BaseModel, Field


class CountryLanguage(BaseModel):
    name: str
    native_name: str | None = None
    iso639_1: str | None = None


class CountryCurrency(BaseModel):
    code: str | None = None
    name: str | None = None
    symbol: str | None = None


class CountrySummary(BaseModel):
    """Light representation used for the world list / map layer."""

    alpha2_code: str
    alpha3_code: str
    name: str
    capital: str | None = None
    region: str | None = None
    flag_emoji: str | None = None
    flag_png: str | None = None
    latlng: list[float] | None = None
    population: int | None = None


class CountryDetail(CountrySummary):
    """Full country profile for the explorer panel."""

    native_name: str | None = None
    subregion: str | None = None
    demonym: str | None = None
    area: float | None = None
    borders: list[str] = Field(default_factory=list)
    timezones: list[str] = Field(default_factory=list)
    languages: list[CountryLanguage] = Field(default_factory=list)
    currencies: list[CountryCurrency] = Field(default_factory=list)
    calling_codes: list[str] = Field(default_factory=list)
    top_level_domains: list[str] = Field(default_factory=list)
    flag_svg: str | None = None


# Curated corrections applied on top of the upstream payload.
CAPITAL_OVERRIDES = {"PS": "Jerusalem"}


def _base_fields(raw: dict[str, Any]) -> dict[str, Any]:
    flags = raw.get("flags") or {}
    alpha2 = raw["alpha2Code"]
    return {
        "alpha2_code": alpha2,
        "alpha3_code": raw["alpha3Code"],
        "name": raw["name"],
        "capital": CAPITAL_OVERRIDES.get(alpha2, raw.get("capital")),
        "region": raw.get("region"),
        "flag_emoji": raw.get("flag"),
        "flag_png": flags.get("png"),
        "latlng": raw.get("latlng"),
        "population": raw.get("population"),
    }


def summary_from_raw(raw: dict[str, Any]) -> CountrySummary:
    return CountrySummary(**_base_fields(raw))


def detail_from_raw(raw: dict[str, Any]) -> CountryDetail:
    flags = raw.get("flags") or {}
    return CountryDetail(
        **_base_fields(raw),
        native_name=raw.get("nativeName"),
        subregion=raw.get("subregion"),
        demonym=raw.get("demonym"),
        area=raw.get("area"),
        borders=raw.get("borders") or [],
        timezones=raw.get("timezones") or [],
        languages=[
            CountryLanguage(
                name=lang.get("name", ""),
                native_name=lang.get("nativeName"),
                iso639_1=lang.get("iso639_1"),
            )
            for lang in raw.get("languages") or []
        ],
        currencies=[CountryCurrency(**cur) for cur in raw.get("currencies") or []],
        calling_codes=raw.get("callingCodes") or [],
        top_level_domains=raw.get("topLevelDomain") or [],
        flag_svg=flags.get("svg"),
    )
