"""Pool of "Did You Know?" facts.

Facts are generated in batches by the background worker and served as random
selections, so refreshing the feed is free — new Claude calls only happen
when the pool runs low, and always under the daily budget guard.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class FeedFact(Base):
    __tablename__ = "feed_facts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    alpha2_code: Mapped[str | None] = mapped_column(String(2), index=True)
    country_name: Mapped[str] = mapped_column(String(120))
    fact: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
