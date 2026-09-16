import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Article = {
  id: string;
  title: string;
  summary: string;
  source: string;
  source_url: string;
  url: string;
  published_at: string;
  category: string;
  category_icon: string;
};

type SourceStatus = {
  name: string;
  url: string;
  ok: boolean;
  article_count: number;
  error: string | null;
};

type ArticlesResponse = {
  articles: Article[];
  meta: {
    returned: number;
    available: number;
    raw_articles: number;
    duplicates_removed: number;
    sources_configured: number;
    sources_ok: number;
    cache_ttl_seconds: number;
    source_status: SourceStatus[];
  };
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

type ChatResponse = {
  reply: string;
  articles_used?: number;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

function formatRelativeTime(dateString: string) {
  const published = new Date(dateString);
  const diffMs = Date.now() - published.getTime();

  if (Number.isNaN(published.getTime())) {
    return "Recently";
  }

  if (diffMs < 0) {
    return published.toLocaleDateString();
  }

  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  return published.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function StoryCard({ article }: { article: Article }) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:p-6">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
        <span className="rounded-full bg-slate-100 px-2.5 py-1">
          {article.source}
        </span>

        <span>•</span>

        <span>{formatRelativeTime(article.published_at)}</span>
      </div>

      <h3 className="mt-4 text-lg font-semibold leading-snug text-slate-950 sm:text-xl">
        {article.title}
      </h3>

      <p className="mt-3 flex-1 text-sm leading-6 text-slate-600 sm:text-[15px]">
        {article.summary}
      </p>

      <a
        href={article.url}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex w-fit items-center gap-2 text-sm font-semibold text-indigo-600 transition hover:text-indigo-800"
      >
        Read original
        <span aria-hidden="true">↗</span>
      </a>
    </article>
  );
}

function App() {
  /*
   |--------------------------------------------------------------------------
   | RSS STATE
   |--------------------------------------------------------------------------
   */

  const [data, setData] = useState<ArticlesResponse | null>(null);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState<string | null>(null);

  /*
   |--------------------------------------------------------------------------
   | CHATBOT STATE
   |--------------------------------------------------------------------------
   */

  const [chatOpen, setChatOpen] = useState(false);

  const [chatInput, setChatInput] = useState("");

  const [chatLoading, setChatLoading] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      content:
        "Hi 👋 I'm TechBrief AI. Ask me about the latest technology news stored in TechBrief.",
    },
  ]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  /*
   |--------------------------------------------------------------------------
   | RSS API
   |--------------------------------------------------------------------------
   */

  const loadArticles = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      const response = await fetch(
        `${API_BASE_URL}/api/articles?limit=30&refresh=${forceRefresh}`,
      );

      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }

      const result: ArticlesResponse = await response.json();

      setData(result);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Could not load articles from the backend.";

      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadArticles();
  }, [loadArticles]);

  /*
   |--------------------------------------------------------------------------
   | CHAT AUTO SCROLL
   |--------------------------------------------------------------------------
   */

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [chatMessages, chatLoading]);

  /*
   |--------------------------------------------------------------------------
   | SEND CHAT MESSAGE
   |--------------------------------------------------------------------------
   */

  const sendChatMessage = async () => {
    const message = chatInput.trim();

    if (!message || chatLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: message,
    };

    setChatMessages((previous) => [...previous, userMessage]);

    setChatInput("");
    setChatLoading(true);

    try {
      console.log("Calling:", `${API_BASE_URL}/api/chat`);

      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: message,
        }),
      });

      console.log("Chat status:", response.status);

      const result = await response.json();

      console.log("Chat response:", result);

      if (!response.ok) {
        throw new Error(result?.detail || `HTTP ${response.status}`);
      }

      setChatMessages((previous) => [
        ...previous,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: result.reply || "No response received from TechBrief AI.",
        },
      ]);
    } catch (error) {
      console.error("Frontend chatbot error:", error);

      setChatMessages((previous) => [
        ...previous,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: "Sorry, I could not reach TechBrief AI right now.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };
  /*
   |--------------------------------------------------------------------------
   | GROUP ARTICLES
   |--------------------------------------------------------------------------
   */

  const sections = useMemo(() => {
    if (!data) {
      return [];
    }

    const grouped = new Map<
      string,
      {
        icon: string;
        title: string;
        stories: Article[];
      }
    >();

    for (const article of data.articles) {
      const current = grouped.get(article.category);

      if (current) {
        current.stories.push(article);
      } else {
        grouped.set(article.category, {
          icon: article.category_icon,
          title: article.category,
          stories: [article],
        });
      }
    }

    return Array.from(grouped.values()).sort(
      (a, b) => b.stories.length - a.stories.length,
    );
  }, [data]);

  const sourceCount = data?.meta.sources_ok ?? 0;

  const articleCount = data?.meta.returned ?? 0;

  const readingMinutes = Math.max(1, Math.ceil(articleCount * 0.7));

  return (
    <main className="min-h-screen">
      {/* HEADER */}

      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-lg text-white shadow-sm">
              ⚡
            </div>

            <div>
              <p className="font-bold tracking-tight text-slate-950">TechBrief</p>

              <p className="text-xs text-slate-500">Live RSS tech intelligence</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadArticles(true)}
            disabled={refreshing}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? "Refreshing…" : "Refresh feeds"}
          </button>
        </div>
      </header>

      {/* MAIN CONTENT */}

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        {/* HERO */}

        <section className="overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-xl sm:px-8 sm:py-10 lg:px-10">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium text-slate-200">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Live briefing
            </div>

            <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Your tech news,
              <span className="text-indigo-300"> minus the noise.</span>
            </h1>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              Fresh technology stories pulled from trusted RSS feeds, grouped into
              useful themes, and ready for AI-powered analysis.
            </p>

            <div className="mt-7 flex flex-wrap gap-3 text-sm">
              <span className="rounded-full bg-white/10 px-3 py-2">
                {articleCount} stories loaded
              </span>

              <span className="rounded-full bg-white/10 px-3 py-2">
                {sourceCount} sources online
              </span>

              <span className="rounded-full bg-white/10 px-3 py-2">
                ~{readingMinutes} min raw read
              </span>
            </div>
          </div>
        </section>

        {/* LOADING */}

        {loading && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="font-semibold text-slate-900">Fetching live RSS feeds…</p>

            <p className="mt-2 text-sm text-slate-500">
              The first request can take a few seconds because the backend contacts
              every configured source.
            </p>
          </section>
        )}

        {/* ERROR */}

        {error && !loading && (
          <section className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-6">
            <p className="font-semibold text-rose-900">
              Could not load the briefing.
            </p>

            <p className="mt-2 text-sm text-rose-700">{error}</p>

            <p className="mt-2 text-sm text-rose-700">
              Make sure FastAPI is running on {API_BASE_URL}.
            </p>
          </section>
        )}

        {/* DASHBOARD */}

        {data && !loading && (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">RSS articles fetched</p>

                <p className="mt-2 text-2xl font-bold text-slate-950">
                  {data.meta.raw_articles}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">Duplicates removed</p>

                <p className="mt-2 text-2xl font-bold text-slate-950">
                  {data.meta.duplicates_removed}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">Healthy RSS sources</p>

                <p className="mt-2 text-2xl font-bold text-slate-950">
                  {data.meta.sources_ok}/{data.meta.sources_configured}
                </p>
              </div>
            </section>

            {/* SOURCE ERRORS */}

            {data.meta.source_status.some((source) => !source.ok) && (
              <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="font-semibold text-amber-900">
                  Some RSS sources could not be reached.
                </p>

                <div className="mt-2 space-y-1 text-sm text-amber-800">
                  {data.meta.source_status
                    .filter((source) => !source.ok)
                    .map((source) => (
                      <p key={source.name}>
                        {source.name}: {source.error ?? "Unknown error"}
                      </p>
                    ))}
                </div>
              </section>
            )}

            {/* ARTICLE SECTIONS */}

            <div className="mt-10 space-y-10">
              {sections.map((section) => (
                <section key={section.title}>
                  <div className="mb-4 flex items-center gap-3">
                    <span className="text-2xl" aria-hidden="true">
                      {section.icon}
                    </span>

                    <div>
                      <h2 className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
                        {section.title}
                      </h2>

                      <p className="text-sm text-slate-500">
                        {section.stories.length}{" "}
                        {section.stories.length === 1 ? "story" : "stories"}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    {section.stories.map((article) => (
                      <StoryCard key={article.id} article={article} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}

        <footer className="mt-12 border-t border-slate-200 py-6 text-center text-xs text-slate-500">
          TechBrief • React + TypeScript + Tailwind CSS + FastAPI + RSS + AI
        </footer>
      </div>

      {/* =========================================================
          CHATBOT WINDOW
      ========================================================= */}

      {chatOpen && (
        <section className="fixed bottom-24 right-4 z-50 flex h-[520px] w-[calc(100vw-2rem)] max-w-[390px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl sm:right-6">
          {/* CHAT HEADER */}

          <div className="flex items-center justify-between bg-slate-950 px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500 text-lg">
                ✨
              </div>

              <div>
                <p className="text-sm font-bold">TechBrief AI</p>

                <p className="text-xs text-slate-300">Ask about latest tech news</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setChatOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 transition hover:bg-white/10 hover:text-white"
              aria-label="Close chatbot"
            >
              ✕
            </button>
          </div>

          {/* CHAT MESSAGES */}

          <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4">
            {chatMessages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"
                  }`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${message.role === "user"
                      ? "rounded-br-md bg-indigo-600 text-white"
                      : "rounded-bl-md border border-slate-200 bg-white text-slate-700"
                    }`}
                >
                  {message.role === "assistant" ? (
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => (
                          <p className="mb-2 last:mb-0">{children}</p>
                        ),
                        ul: ({ children }) => (
                          <ul className="my-2 list-disc space-y-1 pl-5">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="my-2 list-decimal space-y-1 pl-5">
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => <li>{children}</li>,
                        strong: ({ children }) => (
                          <strong className="font-semibold text-slate-900">
                            {children}
                          </strong>
                        ),
                        h1: ({ children }) => (
                          <h1 className="mb-2 mt-3 text-base font-bold text-slate-950">
                            {children}
                          </h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="mb-2 mt-3 text-sm font-bold text-slate-950">
                            {children}
                          </h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="mb-2 mt-2 text-sm font-semibold text-slate-950">
                            {children}
                          </h3>
                        ),
                        code: ({ children }) => (
                          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-800">
                            {children}
                          </code>
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            ))}

            {/* TYPING INDICATOR */}

            {chatLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />

                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-slate-400"
                      style={{
                        animationDelay: "150ms",
                      }}
                    />

                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-slate-400"
                      style={{
                        animationDelay: "300ms",
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* CHAT INPUT */}

          <div className="border-t border-slate-200 bg-white p-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendChatMessage();
              }}
              className="flex items-end gap-2"
            >
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();

                    void sendChatMessage();
                  }
                }}
                rows={1}
                placeholder="Ask TechBrief AI..."
                className="max-h-28 min-h-[44px] flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              />

              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-lg text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Send message"
              >
                ➤
              </button>
            </form>

            <p className="mt-2 text-center text-[10px] text-slate-400">
              Answers are based on TechBrief stored news articles.
            </p>
          </div>
        </section>
      )}

      {/* =========================================================
          FLOATING CHAT BUTTON
      ========================================================= */}

      <button
        type="button"
        onClick={() => setChatOpen((previous) => !previous)}
        className="fixed bottom-5 right-4 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-slate-950 text-2xl text-white shadow-2xl transition hover:-translate-y-1 hover:bg-indigo-600 sm:right-6"
        aria-label="Open TechBrief AI chatbot"
      >
        {chatOpen ? "✕" : "💬"}
      </button>
    </main>
  );
}

export default App;
