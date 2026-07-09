"""Country ORM model — the persistent (PostgreSQL) cache layer for hard facts.

The full countries.dev payload is stored as JSONB so nothing is lost, with a
few frequently queried fields promoted to real columns.
"""

from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Country(Base):
    __tablename__ = "countries"

    alpha2_code: Mapped[str] = mapped_column(String(2), primary_key=True)
    alpha3_code: Mapped[str] = mapped_column(String(3), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    region: Mapped[str | None] = mapped_column(String(60))
    subregion: Mapped[str | None] = mapped_column(String(60))
    population: Mapped[int | None] = mapped_column(BigInteger)

    # Full countries.dev payload, verbatim.
    data: Mapped[dict] = mapped_column(JSONB)

    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )
