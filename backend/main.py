from __future__ import annotations

import hashlib
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import os
from pydantic import BaseModel
from google import genai
from dotenv import load_dotenv
from sqlalchemy import select, or_

import feedparser
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from database import engine, SessionLocal
from models import Base, Article


app = FastAPI(
    title="Tech Brief API",
    description="RSS aggregation API for the TechBrief frontend.",
    version="0.3.0",
)
load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY is missing from .env")

gemini_client = genai.Client(
    api_key=GEMINI_API_KEY
)

GEMINI_MODELS = [
    "gemini-3.7-flash",
    "gemini-2.5-flash",
]


def generate_with_gemini_fallback(prompt: str) -> str:
    """Try Gemini models in order and return the first successful response."""
    last_error = None

    for model_name in GEMINI_MODELS:
        try:
            print(f"Trying Gemini model: {model_name}")

            response = gemini_client.models.generate_content(
                model=model_name,
                contents=prompt,
            )

            answer = getattr(response, "text", None)

            if not answer:
                raise RuntimeError(
                    f"{model_name} returned an empty response."
                )

            print(f"Gemini success: {model_name}")
            return answer

        except Exception as exc:
            last_error = exc
            print(
                f"Gemini model failed ({model_name}):",
                repr(exc),
            )

    raise RuntimeError(
        f"All Gemini models failed. Last error: {last_error}"
    )
# Create database tables if they do not already exist
Base.metadata.create_all(bind=engine)


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
    "saved_to_db": 0,
}


def clean_html(value: str | None) -> str:
    if not value:
        return ""

    text = re.sub(
        r"<script.*?</script>",
        " ",
        value,
        flags=re.I | re.S,
    )

    text = re.sub(
        r"<style.*?</style>",
        " ",
        text,
        flags=re.I | re.S,
    )

    text = re.sub(r"<[^>]+>", " ", text)

    text = unescape(text)

    return re.sub(r"\s+", " ", text).strip()


def short_summary(
    value: str,
    max_chars: int = 280,
) -> str:

    text = clean_html(value)

    if len(text) <= max_chars:
        return text

    clipped = (
        text[: max_chars - 1]
        .rsplit(" ", 1)[0]
        .strip()
    )

    return f"{clipped}…"


def parse_published(entry: Any) -> datetime:

    parsed = (
        entry.get("published_parsed")
        or entry.get("updated_parsed")
    )

    if parsed:
        return datetime(
            *parsed[:6],
            tzinfo=timezone.utc,
        )

    raw = (
        entry.get("published")
        or entry.get("updated")
    )

    if raw:
        try:
            dt = parsedate_to_datetime(raw)

            if dt.tzinfo is None:
                dt = dt.replace(
                    tzinfo=timezone.utc
                )

            return dt.astimezone(
                timezone.utc
            )

        except (
            TypeError,
            ValueError,
            OverflowError,
        ):
            pass

    return datetime.now(timezone.utc)


def classify_article(
    title: str,
    summary: str,
) -> tuple[str, str]:

    haystack = (
        f" {title} {summary} "
    ).lower()

    for category, icon, keywords in CATEGORY_RULES:

        if any(
            keyword in haystack
            for keyword in keywords
        ):
            return category, icon

    return "Tech & Industry", "🧠"


def generate_url_hash(url: str) -> str:
    """
    Generate SHA-256 hash for article URL.

    This hash is stored as a unique value in MySQL
    to prevent duplicate articles.
    """

    return hashlib.sha256(
        url.encode("utf-8")
    ).hexdigest()


def save_articles_to_db(
    articles: list[dict[str, Any]],
) -> int:
    """
    Save new RSS articles into MySQL.

    Articles already stored are skipped using url_hash.
    """

    if not articles:
        return 0

    db = SessionLocal()

    saved_count = 0

    try:

        # Generate hashes for all incoming articles
        article_hashes = [
            generate_url_hash(article["url"])
            for article in articles
        ]

        # Find hashes which already exist in DB
        statement = select(
            Article.url_hash
        ).where(
            Article.url_hash.in_(
                article_hashes
            )
        )

        existing_hashes = set(
            db.scalars(statement).all()
        )

        for article in articles:

            url_hash = generate_url_hash(
                article["url"]
            )

            # Skip duplicate
            if url_hash in existing_hashes:
                continue

            published_at = datetime.fromisoformat(
                article["published_at"]
            )

            # MySQL DATETIME does not need timezone info
            if published_at.tzinfo:
                published_at = (
                    published_at
                    .astimezone(timezone.utc)
                    .replace(tzinfo=None)
                )

            db_article = Article(
                title=article["title"],
                summary=article["summary"],
                url=article["url"],
                url_hash=url_hash,
                source=article["source"],
                category=article["category"],
                published_at=published_at,
            )

            db.add(db_article)

            existing_hashes.add(
                url_hash
            )

            saved_count += 1

        db.commit()

        return saved_count

    except Exception as exc:

        db.rollback()

        print(
            "Database save error:",
            exc,
        )

        return 0

    finally:
        db.close()


def fetch_feed(
    source: dict[str, str],
) -> tuple[
    list[dict[str, Any]],
    dict[str, Any],
]:

    try:

        request = Request(
            source["url"],
            headers={
                "User-Agent":
                    "TechBrief/0.3 (+local development RSS reader)",

                "Accept":
                    "application/rss+xml, "
                    "application/atom+xml, "
                    "application/xml, "
                    "text/xml, */*",
            },
        )

        with urlopen(
            request,
            timeout=12,
        ) as response:

            raw_feed = response.read()

        parsed = feedparser.parse(
            raw_feed
        )

        articles: list[
            dict[str, Any]
        ] = []

        for entry in parsed.entries[:20]:

            title = clean_html(
                entry.get("title")
            )

            link = (
                entry
                .get("link", "")
                .strip()
            )

            if not title or not link:
                continue

            summary_source = (
                entry.get("summary")
                or entry.get("description")
                or (
                    entry
                    .get(
                        "content",
                        [{}],
                    )[0]
                    .get("value", "")
                    if entry.get("content")
                    else ""
                )
            )

            summary = short_summary(
                summary_source
            )

            published = parse_published(
                entry
            )

            category, icon = classify_article(
                title,
                summary,
            )

            articles.append(
                {
                    "id": link,

                    "title": title,

                    "summary":
                        summary
                        or
                        "Open the source to read the full story.",

                    "source":
                        source["name"],

                    "source_url":
                        source["url"],

                    "url":
                        link,

                    "published_at":
                        published.isoformat(),

                    "category":
                        category,

                    "category_icon":
                        icon,
                }
            )

        status = {
            "name":
                source["name"],

            "url":
                source["url"],

            "ok":
                True,

            "article_count":
                len(articles),

            "error":
                None,
        }

        return articles, status

    except (
        HTTPError,
        URLError,
        TimeoutError,
        OSError,
    ) as exc:

        return [], {
            "name":
                source["name"],

            "url":
                source["url"],

            "ok":
                False,

            "article_count":
                0,

            "error":
                str(exc),
        }


def build_article_cache(
    force: bool = False,
) -> dict[str, Any]:

    now = time.time()

    cache_is_fresh = (
        now
        - _cache["created_at"]
        < CACHE_TTL_SECONDS
    )

    if (
        cache_is_fresh
        and not force
    ):
        return _cache

    collected: list[
        dict[str, Any]
    ] = []

    source_status: list[
        dict[str, Any]
    ] = []

    for source in RSS_SOURCES:

        articles, status = fetch_feed(
            source
        )

        collected.extend(
            articles
        )

        source_status.append(
            status
        )

    raw_count = len(
        collected
    )

    # Remove duplicate URLs from current RSS fetch
    unique_by_url: dict[
        str,
        dict[str, Any],
    ] = {}

    for article in collected:

        unique_by_url.setdefault(
            article["url"],
            article,
        )

    unique_articles = list(
        unique_by_url.values()
    )

    unique_articles.sort(
        key=lambda item:
            item["published_at"],
        reverse=True,
    )

    # ---------------------------------
    # SAVE NEW ARTICLES INTO MYSQL
    # ---------------------------------

    saved_to_db = save_articles_to_db(
        unique_articles
    )

    # ---------------------------------

    _cache.update(
        {
            "created_at":
                now,

            "articles":
                unique_articles,

            "source_status":
                source_status,

            "raw_count":
                raw_count,

            "duplicates_removed":
                raw_count
                - len(unique_articles),

            "saved_to_db":
                saved_to_db,
        }
    )

    return _cache


@app.get("/")
def root() -> dict[str, str]:

    return {
        "message":
            "Tech Brief API is running"
    }


@app.get("/api/health")
def health() -> dict[str, str]:

    return {
        "status":
            "ok",

        "service":
            "tech-brief-backend",

        "version":
            "0.3.0",
    }


@app.get("/api/sources")
def sources() -> dict[str, Any]:

    return {
        "count":
            len(RSS_SOURCES),

        "sources":
            RSS_SOURCES,
    }


@app.get("/api/articles")
def articles(
    limit: int = Query(
        default=30,
        ge=1,
        le=60,
    ),

    refresh: bool = Query(
        default=False
    ),

) -> dict[str, Any]:

    data = build_article_cache(
        force=refresh
    )

    selected = (
        data["articles"][:limit]
    )

    return {
        "articles":
            selected,

        "meta": {

            "returned":
                len(selected),

            "available":
                len(
                    data["articles"]
                ),

            "raw_articles":
                data["raw_count"],

            "duplicates_removed":
                data[
                    "duplicates_removed"
                ],

            "saved_to_db":
                data[
                    "saved_to_db"
                ],

            "sources_configured":
                len(
                    RSS_SOURCES
                ),

            "sources_ok":
                sum(
                    1
                    for source
                    in data[
                        "source_status"
                    ]
                    if source["ok"]
                ),

            "cache_ttl_seconds":
                CACHE_TTL_SECONDS,

            "source_status":
                data[
                    "source_status"
                ],
        },
    }

# Lightweight local conversation memory.
# Good for this single-user local project. It resets when FastAPI restarts.
CHAT_MEMORY = {
    "name": None,
}

CHAT_HISTORY: list[dict[str, str]] = []


class ChatRequest(BaseModel):
    message: str


@app.post("/api/chat")
def chat_with_techbrief(request: ChatRequest):

    question = request.message.strip()

    if not question:
        return {
            "reply": "Please send me a message.",
            "articles_used": 0,
        }

    normalized_question = re.sub(
        r"[^a-zA-Z ]+",
        "",
        question.lower(),
    ).strip()

    normalized_question = re.sub(
        r"\s+",
        " ",
        normalized_question,
    )

    # ---------------------------------------------------------
    # Remember the user's name.
    # ---------------------------------------------------------
    name_match = re.search(
        r"\b(?:my name is|i am|i'm)\s+([A-Za-z][A-Za-z '-]{1,30})\b",
        question,
        flags=re.I,
    )

    if name_match:
        possible_name = name_match.group(1).strip()

        blocked_values = {
            "fine",
            "good",
            "okay",
            "ok",
            "great",
            "happy",
            "sad",
            "tired",
            "bored",
            "here",
        }

        if possible_name.lower() not in blocked_values:
            CHAT_MEMORY["name"] = possible_name.title()

            reply = f"Nice to meet you, {CHAT_MEMORY['name']} 👋"

            CHAT_HISTORY.append({
                "role": "user",
                "content": question,
            })
            CHAT_HISTORY.append({
                "role": "assistant",
                "content": reply,
            })

            return {
                "reply": reply,
                "articles_used": 0,
            }

    # ---------------------------------------------------------
    # Simple greetings.
    # ---------------------------------------------------------
    greetings = {
        "hi",
        "hy",
        "hey",
        "hello",
        "hii",
        "hiii",
        "helo",
        "salam",
        "aoa",
        "assalamualaikum",
        "assalam o alaikum",
    }

    if normalized_question in greetings:
        if CHAT_MEMORY["name"]:
            reply = f"Hi {CHAT_MEMORY['name']} 👋 How can I help you today?"
        else:
            reply = "Hi 👋 I'm TechBrief AI. How can I help you today?"

        CHAT_HISTORY.append({
            "role": "user",
            "content": question,
        })
        CHAT_HISTORY.append({
            "role": "assistant",
            "content": reply,
        })

        return {
            "reply": reply,
            "articles_used": 0,
        }

    # ---------------------------------------------------------
    # Decide whether this is a TechBrief/news question.
    #
    # IMPORTANT:
    # General questions such as beauty, food, travel, casual chat,
    # etc. must NOT be forced through the news/RSS pipeline.
    # ---------------------------------------------------------
    news_keywords = {
        "tech",
        "technology",
        "news",
        "article",
        "articles",
        "story",
        "stories",
        "latest",
        "today",
        "techbrief",
        "techcrunch",
        "verge",
        "ars technica",
        "openai",
        "chatgpt",
        "anthropic",
        "claude",
        "gemini",
        "nvidia",
        "apple",
        "google",
        "microsoft",
        "meta",
        "ai",
        "artificial intelligence",
        "startup",
        "startups",
        "developer",
        "developers",
        "software",
        "security",
        "cybersecurity",
        "funding",
    }

    lowered_question = question.lower()

    is_news_question = any(
        keyword in lowered_question
        for keyword in news_keywords
    )

    # ---------------------------------------------------------
    # NORMAL CONVERSATION
    # No RSS articles, no TechBrief fallback.
    # ---------------------------------------------------------
    if not is_news_question:
        recent_history = CHAT_HISTORY[-8:]

        history_text = "\n".join(
            f"{item['role'].upper()}: {item['content']}"
            for item in recent_history
        )

        user_name = CHAT_MEMORY["name"] or "Unknown"

        general_prompt = f"""
You are TechBrief AI, but you are also a friendly general conversational assistant.

Talk naturally with the user.
Do NOT force technology news into the conversation.
Do NOT mention RSS articles unless the user actually asks about technology/news.
You may answer ordinary questions about everyday topics using your general knowledge.
Keep the answer helpful and conversational.

KNOWN USER NAME:
{user_name}

RECENT CONVERSATION:
{history_text or "No previous conversation yet."}

USER MESSAGE:
{question}

Reply naturally to the user's latest message.
"""

        try:
            answer = generate_with_gemini_fallback(
                general_prompt
            )

        except Exception as exc:
            print("General conversation Gemini error:", repr(exc))

            return {
                "reply": (
                    "I couldn't generate that response just now. "
                    "Please try again in a moment."
                ),
                "articles_used": 0,
            }

        CHAT_HISTORY.append({
            "role": "user",
            "content": question,
        })
        CHAT_HISTORY.append({
            "role": "assistant",
            "content": answer,
        })

        if len(CHAT_HISTORY) > 20:
            del CHAT_HISTORY[:-20]

        return {
            "reply": answer,
            "articles_used": 0,
        }

    # ---------------------------------------------------------
    # TECHBRIEF / NEWS QUESTIONS
    # Only this branch uses MySQL articles.
    # ---------------------------------------------------------
    db = SessionLocal()

    try:
        stop_words = {
            "what",
            "are",
            "the",
            "today",
            "most",
            "important",
            "about",
            "tell",
            "give",
            "show",
            "latest",
            "news",
            "stories",
            "story",
            "article",
            "articles",
            "please",
            "want",
            "know",
        }

        words = [
            word.strip(".,!?()[]{}:;\"'")
            for word in question.lower().split()
            if (
                len(word.strip(".,!?()[]{}:;\"'")) >= 3
                and word.strip(".,!?()[]{}:;\"'") not in stop_words
            )
        ]

        query = select(Article)

        if words:
            filters = []

            for word in words:
                search_word = f"%{word}%"

                filters.extend([
                    Article.title.ilike(search_word),
                    Article.summary.ilike(search_word),
                    Article.category.ilike(search_word),
                    Article.source.ilike(search_word),
                ])

            query = query.where(
                or_(*filters)
            )

        query = query.order_by(
            Article.published_at.desc()
        ).limit(8)

        articles = db.scalars(query).all()

        if not articles:
            return {
                "reply": (
                    "I couldn't find any stored TechBrief articles "
                    f"related to \"{question}\"."
                ),
                "articles_used": 0,
            }

        context_parts = []

        for index, article in enumerate(
            articles,
            start=1,
        ):
            context_parts.append(
                f"""
ARTICLE {index}
Title: {article.title}
Source: {article.source}
Category: {article.category}
Published: {article.published_at}
Summary: {article.summary}
URL: {article.url}
"""
            )

        context = "\n".join(context_parts)

        recent_history = CHAT_HISTORY[-8:]

        history_text = "\n".join(
            f"{item['role'].upper()}: {item['content']}"
            for item in recent_history
        )

        user_name = CHAT_MEMORY["name"] or "Unknown"

        news_prompt = f"""
You are TechBrief AI, a technology news assistant.

For this message, answer using ONLY the supplied TechBrief article context.

Rules:
- Do not invent current-news facts.
- Do not use outside knowledge for the current-news answer.
- If the answer is not supported by the supplied articles, clearly say so.
- Prefer newer and more relevant stories.
- Mention sources when helpful.
- Keep the response concise and conversational.
- Do not dump unrelated articles.

KNOWN USER NAME:
{user_name}

RECENT CONVERSATION:
{history_text or "No previous conversation yet."}

USER QUESTION:
{question}

TECHBRIEF ARTICLES:
{context}

Answer only what the user asked.
"""

        try:
            answer = generate_with_gemini_fallback(
                news_prompt
            )

        except Exception as gemini_exc:
            print("News Gemini error:", repr(gemini_exc))

            # This fallback is ONLY for genuine news/TechBrief questions.
            fallback_lines = [
                "Here are the latest relevant TechBrief stories I found:"
            ]

            for article in articles[:5]:
                summary = (article.summary or "").strip()

                if len(summary) > 180:
                    summary = (
                        summary[:177]
                        .rsplit(" ", 1)[0]
                        + "..."
                    )

                line = f"• {article.title} ({article.source})"

                if summary:
                    line += f" — {summary}"

                fallback_lines.append(line)

            answer = "\n\n".join(fallback_lines)

        CHAT_HISTORY.append({
            "role": "user",
            "content": question,
        })
        CHAT_HISTORY.append({
            "role": "assistant",
            "content": answer,
        })

        if len(CHAT_HISTORY) > 20:
            del CHAT_HISTORY[:-20]

        return {
            "reply": answer,
            "articles_used": len(articles),
        }

    except Exception as exc:
        print("Chatbot route error:", repr(exc))

        return {
            "reply": (
                "I hit a temporary backend problem. "
                "Please try your message once more."
            ),
            "articles_used": 0,
        }

    finally:
        db.close()