from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func

from database import Base


class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, index=True)

    title = Column(String(500), nullable=False)

    summary = Column(Text, nullable=True)

    # Full article URL
    url = Column(Text, nullable=False)

    # SHA-256 hash of URL.
    # We will use this to prevent duplicate articles.
    url_hash = Column(
        String(64),
        unique=True,
        nullable=False,
        index=True
    )

    source = Column(String(100), nullable=False)

    category = Column(String(100), nullable=True)

    published_at = Column(DateTime, nullable=True)

    created_at = Column(
        DateTime,
        server_default=func.now()
    )