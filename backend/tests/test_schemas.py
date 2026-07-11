"""Country schema mapping: upstream payload -> stable API contract."""

from app.schemas.country import detail_from_raw, summary_from_raw

RAW = {
    "alpha2Code": "JO",
    "alpha3Code": "JOR",
    "name": "Jordan",
    "capital": "Amman",
    "region": "Asia",
    "flag": "🇯🇴",
    "flags": {"png": "https://flagcdn.com/w320/jo.png", "svg": "https://flagcdn.com/jo.svg"},
    "latlng": [31.0, 36.0],
    "population": 10203134,
    "nativeName": "الأردن",
    "subregion": "Western Asia",
    "demonym": "Jordanian",
    "area": 89342.0,
    "borders": ["IRQ", "ISR", "PSE", "SAU", "SYR"],
    "timezones": ["UTC+03:00"],
    "languages": [{"name": "Arabic", "nativeName": "العربية", "iso639_1": "ar"}],
    "currencies": [{"code": "JOD", "name": "Jordanian dinar", "symbol": "د.ا"}],
    "callingCodes": ["962"],
    "topLevelDomain": [".jo"],
}


def test_detail_maps_all_fields():
    detail = detail_from_raw(RAW)
    assert detail.alpha2_code == "JO"
    assert detail.capital == "Amman"
    assert detail.flag_png == "https://flagcdn.com/w320/jo.png"
    assert detail.flag_svg == "https://flagcdn.com/jo.svg"
    assert detail.latlng == [31.0, 36.0]
    assert detail.languages[0].native_name == "العربية"
    assert detail.currencies[0].code == "JOD"
    assert detail.borders == ["IRQ", "ISR", "PSE", "SAU", "SYR"]


def test_summary_is_light_subset():
    summary = summary_from_raw(RAW)
    assert summary.alpha2_code == "JO"
    assert summary.population == 10203134
    assert "borders" not in type(summary).model_fields


def test_palestine_capital_override():
    raw = {**RAW, "alpha2Code": "PS", "alpha3Code": "PSE", "name": "Palestine", "capital": "Ramallah"}
    assert detail_from_raw(raw).capital == "Jerusalem"
    assert summary_from_raw(raw).capital == "Jerusalem"


def test_missing_optionals_default_gracefully():
    minimal = {"alpha2Code": "XX", "alpha3Code": "XXX", "name": "Testland"}
    detail = detail_from_raw(minimal)
    assert detail.capital is None
    assert detail.borders == []
    assert detail.languages == []
    assert detail.flag_png is None
