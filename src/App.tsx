import { useCallback, useEffect, useMemo, useState } from 'react'

type Article = {
  id: string
  title: string
  summary: string
  source: string
  source_url: string
  url: string
  published_at: string
  category: string
  category_icon: string
}

type SourceStatus = {
  name: string
  url: string
  ok: boolean
  article_count: number
  error: string | null
}

type ArticlesResponse = {
  articles: Article[]
  meta: {
    returned: number
    available: number
    raw_articles: number
    duplicates_removed: number
    sources_configured: number
    sources_ok: number
    cache_ttl_seconds: number
    source_status: SourceStatus[]
  }
}

const API_BASE_URL = 'http://127.0.0.1:8000'

function formatRelativeTime(dateString: string) {
  const published = new Date(dateString)
  const diffMs = Date.now() - published.getTime()

  if (Number.isNaN(published.getTime())) return 'Recently'
  if (diffMs < 0) return published.toLocaleDateString()

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`

  return published.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function StoryCard({ article }: { article: Article }) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:p-6">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
        <span className="rounded-full bg-slate-100 px-2.5 py-1">{article.source}</span>
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
        Read original <span aria-hidden="true">↗</span>
      </a>
    </article>
  )
}

function App() {
  const [data, setData] = useState<ArticlesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadArticles = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setError(null)
      const response = await fetch(
        `${API_BASE_URL}/api/articles?limit=30&refresh=${forceRefresh}`,
      )

      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`)
      }

      const result: ArticlesResponse = await response.json()
      setData(result)
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Could not load articles from the backend.'
      setError(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadArticles()
  }, [loadArticles])

  const sections = useMemo(() => {
    if (!data) return []

    const grouped = new Map<
      string,
      { icon: string; title: string; stories: Article[] }
    >()

    for (const article of data.articles) {
      const current = grouped.get(article.category)
      if (current) {
        current.stories.push(article)
      } else {
        grouped.set(article.category, {
          icon: article.category_icon,
          title: article.category,
          stories: [article],
        })
      }
    }

    return Array.from(grouped.values()).sort(
      (a, b) => b.stories.length - a.stories.length,
    )
  }, [data])

  const sourceCount = data?.meta.sources_ok ?? 0
  const articleCount = data?.meta.returned ?? 0
  const readingMinutes = Math.max(1, Math.ceil(articleCount * 0.7))

  return (
    <main className="min-h-screen">
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
            {refreshing ? 'Refreshing…' : 'Refresh feeds'}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
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
              useful themes, and ready for the AI-curation layer we will add next.
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

        {loading && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="font-semibold text-slate-900">Fetching live RSS feeds…</p>
            <p className="mt-2 text-sm text-slate-500">
              The first request can take a few seconds because the backend contacts
              every configured source.
            </p>
          </section>
        )}

        {error && !loading && (
          <section className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-6">
            <p className="font-semibold text-rose-900">Could not load the briefing.</p>
            <p className="mt-2 text-sm text-rose-700">{error}</p>
            <p className="mt-2 text-sm text-rose-700">
              Make sure FastAPI is running on http://127.0.0.1:8000.
            </p>
          </section>
        )}

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
                        {source.name}: {source.error ?? 'Unknown error'}
                      </p>
                    ))}
                </div>
              </section>
            )}

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
                        {section.stories.length}{' '}
                        {section.stories.length === 1 ? 'story' : 'stories'}
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
          TechBrief • React + TypeScript + Tailwind CSS + FastAPI + RSS
        </footer>
      </div>
    </main>
  )
}

export default App
