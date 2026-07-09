"""Tracks when a full dataset was last synced into PostgreSQL.

Without this, the presence of a few individually cached rows would be
indistinguishable from a complete dataset (e.g. one country fetched by code
must not make the all-countries list serve a single row from PostgreSQL).
"""

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class CacheSync(Base):
    __tablename__ = "cache_syncs"

    dataset: Mapped[str] = mapped_column(String(60), primary_key=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
