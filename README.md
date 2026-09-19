# TechBrief

A learning project that combines a modern React frontend with a Python FastAPI backend. The current milestone fetches live technology RSS feeds, removes exact URL duplicates, groups stories by theme, and displays them in the dashboard.

## Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- Python
- FastAPI
- feedparser

## 1. Start the backend

```powershell
cd backend
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload
```

Backend: http://127.0.0.1:8000

FastAPI docs: http://127.0.0.1:8000/docs

## 2. Start the frontend

Open a second terminal from the project root:

```powershell
npm install
npm run dev
```

Frontend: http://localhost:5173

## API endpoints

- `GET /api/health` — backend health check
- `GET /api/sources` — configured RSS sources
- `GET /api/articles?limit=30` — latest aggregated RSS stories
- `GET /api/articles?limit=30&refresh=true` — bypass the five-minute in-memory cache and fetch feeds again

## Current RSS sources

- TechCrunch
- The Verge
- Ars Technica

## Current milestone

Implemented:

- React ↔ FastAPI connection
- CORS configuration
- Live RSS retrieval
- HTML cleanup
- Article summaries from RSS descriptions
- Exact URL duplicate removal
- Lightweight keyword-based categories
- Five-minute backend cache
- Source health reporting
- Responsive dashboard
- Refresh button
- Loading/error states

Not implemented yet:

- Database persistence
- AI summarization / "why it matters"
- Semantic duplicate detection
- User-managed RSS sources
- Saved/bookmarked stories
- Scheduled morning/evening briefs

## Preview
<img width="1366" height="5870" alt="image" src="https://github.com/user-attachments/assets/9a6f19c8-5f54-4650-8c48-77bdc7d812eb" />
<img width="1364" height="647" alt="image" src="https://github.com/user-attachments/assets/1821dcc2-e96a-4444-a7b2-6b189178abb4" />

