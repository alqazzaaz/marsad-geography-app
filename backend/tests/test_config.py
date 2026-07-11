"""Settings: provider URL normalization and worldview parsing."""

from app.core.config import get_settings


def test_neon_url_is_normalized_for_asyncpg(clean_settings):
    clean_settings.setenv(
        "DATABASE_URL", "postgres://user:pw@host.neon.tech/marsad?sslmode=require"
    )
    get_settings.cache_clear()
    url = get_settings().database_url
    assert url == "postgresql+asyncpg://user:pw@host.neon.tech/marsad?ssl=require"


def test_postgresql_scheme_also_normalized(clean_settings):
    clean_settings.setenv("DATABASE_URL", "postgresql://u:p@h/db")
    get_settings.cache_clear()
    assert get_settings().database_url.startswith("postgresql+asyncpg://")


def test_local_url_assembled_from_pieces(clean_settings):
    url = get_settings().database_url
    assert url == "postgresql+asyncpg://marsad:marsad@localhost:5432/marsad"


def test_worldview_lists_parse_trim_and_uppercase(clean_settings):
    clean_settings.setenv("MAP_EXCLUDED_COUNTRIES", " il ,ISR, ")
    clean_settings.setenv("MAP_PROMOTED_COUNTRIES", "ps,pse")
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.map_excluded_list == ["IL", "ISR"]
    assert settings.map_promoted_list == ["PS", "PSE"]


def test_worldview_lists_empty_by_default(clean_settings):
    settings = get_settings()
    assert settings.map_excluded_list == []
    assert settings.map_promoted_list == []


def test_cors_origin_list_splits_and_trims(clean_settings):
    clean_settings.setenv("CORS_ORIGINS", "https://a.example, https://b.example")
    get_settings.cache_clear()
    assert get_settings().cors_origin_list == ["https://a.example", "https://b.example"]
