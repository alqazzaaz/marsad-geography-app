"""Persistent cache for AI-generated content.

One row per (country, kind). `kind` distinguishes content types so later
phases (language & culture card, "Did You Know?" feed) reuse the same table
and caching pipeline.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class CountryInsight(Base):
    __tablename__ = "country_insights"

    alpha2_code: Mapped[str] = mapped_column(String(2), primary_key=True)
    kind: Mapped[str] = mapped_column(String(30), primary_key=True)  # e.g. "insights"
    model: Mapped[str] = mapped_column(String(60))
    data: Mapped[dict] = mapped_column(JSONB)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
