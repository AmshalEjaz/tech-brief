from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import feedparser
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Tech Brief API",
    description="RSS aggregation API for the TechBrief frontend.",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RSS_SOURCES = [
    {
        "name": "TechCrunch",
        "url": "https://techcrunch.com/feed/",
    },
    {
        "name": "The Verge",
        "url": "https://www.theverge.com/rss/index.xml",
    },
    {
        "name": "Ars Technica",
        "url": "https://feeds.arstechnica.com/arstechnica/index",
    },
]

CATEGORY_RULES: list[tuple[str, str, tuple[str, ...]]] = [
    (
        "AI & Models",
        "🤖",
        (
            "artificial intelligence",
            " ai ",
            "openai",
            "chatgpt",
            "anthropic",
            "claude",
            "gemini",
            "llm",
            "large language model",
            "machine learning",
            "model",
            "inference",
            "agent",
        ),
    ),
    (
        "Developer Tools",
        "💻",
        (
            "developer",
            "github",
            "coding",
            "programming",
            "software",
            "api",
            "open source",
            "linux",
            "cloud",
            "database",
        ),
    ),
    (
        "Startups & Products",
        "🚀",
        (
            "startup",
            "funding",
            "raises",
            "launch",
            "product",
            "app",
            "acquisition",
            "venture",
        ),
    ),
    (
        "Security",
        "🔐",
        (
            "security",
            "cyber",
            "breach",
            "malware",
            "ransomware",
            "vulnerability",
            "hack",
            "privacy",
        ),
    ),
]

CACHE_TTL_SECONDS = 300
_cache: dict[str, Any] = {
    "created_at": 0.0,
    "articles": [],
    "source_status": [],
    "raw_count": 0,
    "duplicates_removed": 0,
}


def clean_html(value: str | None) -> str:
    if not value:
        return ""

    text = re.sub(r"<script.*?</script>", " ", value, flags=re.I | re.S)
    text = re.sub(r"<style.*?</style>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def short_summary(value: str, max_chars: int = 280) -> str:
    text = clean_html(value)
    if len(text) <= max_chars:
        return text

    clipped = text[: max_chars - 1].rsplit(" ", 1)[0].strip()
    return f"{clipped}…"


def parse_published(entry: Any) -> datetime:
    # feedparser often gives us a parsed time tuple. This is the most reliable path.
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if parsed:
        return datetime(*parsed[:6], tzinfo=timezone.utc)

    raw = entry.get("published") or entry.get("updated")
    if raw:
        try:
            dt = parsedate_to_datetime(raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except (TypeError, ValueError, OverflowError):
            pass

    return datetime.now(timezone.utc)


def classify_article(title: str, summary: str) -> tuple[str, str]:
    haystack = f" {title} {summary} ".lower()

    for category, icon, keywords in CATEGORY_RULES:
        if any(keyword in haystack for keyword in keywords):
            return category, icon

    return "Tech & Industry", "🧠"


def fetch_feed(source: dict[str, str]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    try:
        request = Request(
            source["url"],
            headers={
                "User-Agent": "TechBrief/0.2 (+local development RSS reader)",
                "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
            },
        )

        with urlopen(request, timeout=12) as response:
            raw_feed = response.read()

        parsed = feedparser.parse(raw_feed)
        articles: list[dict[str, Any]] = []

        for entry in parsed.entries[:20]:
            title = clean_html(entry.get("title"))
            link = entry.get("link", "").strip()

            if not title or not link:
                continue

            summary_source = (
                entry.get("summary")
                or entry.get("description")
                or (
                    entry.get("content", [{}])[0].get("value", "")
                    if entry.get("content")
                    else ""
                )
            )
            summary = short_summary(summary_source)
            published = parse_published(entry)
            category, icon = classify_article(title, summary)

            articles.append(
                {
                    "id": link,
                    "title": title,
                    "summary": summary or "Open the source to read the full story.",
                    "source": source["name"],
                    "source_url": source["url"],
                    "url": link,
                    "published_at": published.isoformat(),
                    "category": category,
                    "category_icon": icon,
                }
            )

        status = {
            "name": source["name"],
            "url": source["url"],
            "ok": True,
            "article_count": len(articles),
            "error": None,
        }
        return articles, status

    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        return [], {
            "name": source["name"],
            "url": source["url"],
            "ok": False,
            "article_count": 0,
            "error": str(exc),
        }


def build_article_cache(force: bool = False) -> dict[str, Any]:
    now = time.time()
    cache_is_fresh = now - _cache["created_at"] < CACHE_TTL_SECONDS

    if cache_is_fresh and not force:
        return _cache

    collected: list[dict[str, Any]] = []
    source_status: list[dict[str, Any]] = []

    for source in RSS_SOURCES:
        articles, status = fetch_feed(source)
        collected.extend(articles)
        source_status.append(status)

    raw_count = len(collected)

    # Remove the most common RSS duplicate case: the same canonical URL appears twice.
    unique_by_url: dict[str, dict[str, Any]] = {}
    for article in collected:
        unique_by_url.setdefault(article["url"], article)

    unique_articles = list(unique_by_url.values())
    unique_articles.sort(key=lambda item: item["published_at"], reverse=True)

    _cache.update(
        {
            "created_at": now,
            "articles": unique_articles,
            "source_status": source_status,
            "raw_count": raw_count,
            "duplicates_removed": raw_count - len(unique_articles),
        }
    )
    return _cache


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Tech Brief API is running"}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "tech-brief-backend",
        "version": "0.2.0",
    }


@app.get("/api/sources")
def sources() -> dict[str, Any]:
    return {
        "count": len(RSS_SOURCES),
        "sources": RSS_SOURCES,
    }


@app.get("/api/articles")
def articles(
    limit: int = Query(default=30, ge=1, le=60),
    refresh: bool = Query(default=False),
) -> dict[str, Any]:
    data = build_article_cache(force=refresh)
    selected = data["articles"][:limit]

    return {
        "articles": selected,
        "meta": {
            "returned": len(selected),
            "available": len(data["articles"]),
            "raw_articles": data["raw_count"],
            "duplicates_removed": data["duplicates_removed"],
            "sources_configured": len(RSS_SOURCES),
            "sources_ok": sum(1 for source in data["source_status"] if source["ok"]),
            "cache_ttl_seconds": CACHE_TTL_SECONDS,
            "source_status": data["source_status"],
        },
    }
