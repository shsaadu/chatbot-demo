# AI Research Assistant — Multi-Agent RAG + Live Web (v3)

A hybrid AI assistant that answers every question two ways at once, then synthesizes the result:

- **Doc Agent** — searches only documents you've added, using a real RAG pipeline (chunking → embeddings → retrieval).
- **Web Agent** — searches the live web using Gemini's built-in Google Search grounding, running at the same time as the Doc Agent.
- **Arbitrator** — once both finish, combines their findings into one final answer, clearly labeling what came from your documents vs. the web, and flags it if the two disagree.

The pipeline itself is visible in the UI as three status cards that light up in real time (idle → running → done), not just the final answer.

## What's new in v3

- **Multi-agent architecture** — three coordinated Gemini calls per question (two in parallel, one synthesizing), all orchestrated server-side in a single Edge Function.
- **Live web search** — via `google_search` grounding, with real source links and Google's required search-suggestions attribution widget rendered under each answer.
- **Multi-document support** — add as many documents as you like (sample doc, pasted text, `.txt`/`.pdf` uploads); retrieval pools chunks across all of them and tags each source with which document it came from.
- **Tunable RAG settings** — sliders for chunk size, how many chunks get retrieved (top-K), and generation temperature, all live-adjustable from the UI.
- **Visible agent pipeline** — a dedicated panel shows each agent's status and a one-line summary of what it found, as it happens.

## File structure

```
chatbot-demo/
├── index.html         → page structure (settings panel, pipeline panel, doc manager, chat)
├── css/style.css       → styling
├── js/main.js          → multi-doc RAG, settings, pipeline UI, streaming, PDF parsing
├── api/ask.js          → Edge Function — orchestrates Doc Agent + Web Agent + Arbitrator
├── api/embed.js        → Serverless Function — embeds document chunks & questions
├── package.json
├── favicon.svg
└── README.md
```

## How it works

1. **Chunking & indexing**: each document you add is split into overlapping word-window chunks and embedded with `gemini-embedding-001`. This happens once per document (cached client-side for the session) and re-runs automatically if you change the chunk size setting.
2. **Retrieval**: your question is embedded the same way and compared via cosine similarity against every chunk from every active document. The top-K matches (pooled across documents) are selected.
3. **Doc Agent**: receives only those top-K excerpts and answers strictly from them — or says plainly if nothing relevant was found.
4. **Web Agent**: runs at the same time, using Google Search grounding to answer from current web results, with citations.
5. **Arbitrator**: once both finish, synthesizes them into one final answer, streamed back token by token, noting the source of each part and flagging any conflict between the document and web findings.
6. **Sources**: the final answer shows a "Sources" toggle with two groups — the document excerpts used, and the web results the Web Agent found (plus Google's required attribution widget).

## 1. Get a free Gemini API key

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with a Google account
3. Click **Get API key → Create API key**

The free tier has rate limits, but it's fine for a portfolio demo a handful of visitors click through. Note that v3 makes noticeably more API calls per question than earlier versions (embedding calls, plus three Gemini generation calls: Doc Agent, Web Agent, Arbitrator) — worth keeping in mind if you expect heavier traffic.

## 2. Deploy to Vercel

1. Push this folder to your GitHub repo
2. In Vercel: **Add New → Project → Import** that repo
3. Add your API key as an environment variable (**Project → Settings → Environment Variables**):
   - Name: `GEMINI_API_KEY`
   - Value: your key from step 1
4. Deploy (or redeploy if already connected — **Deployments → ⋯ → Redeploy**)

Vercel auto-detects `api/ask.js` as an Edge Function (`config = { runtime: 'edge' }`) and `api/embed.js` as a regular Node serverless function — no extra config needed.

**Important:** never commit your API key to GitHub. It should only exist as a Vercel environment variable.

## 3. Testing locally (optional)

```bash
npm install -g vercel
vercel dev
```
Create a `.env.local` file (not committed to Git):
```
GEMINI_API_KEY=your_key_here
```

## Notes / what to extend later

- Chunk size, overlap ratio, top-K, and temperature are all tunable from the UI; their underlying defaults live near the top of `js/main.js`.
- The Web Agent and Doc Agent run in parallel via `Promise.all` in `api/ask.js` — the Arbitrator only starts once both resolve.
- Google's grounding terms require displaying the search-suggestions widget when showing grounded results publicly; this is already wired up via `groundingMetadata.searchEntryPoint.renderedContent`.
- PDF text extraction won't work on scanned/image-only PDFs (no text layer) — OCR would be a further extension.
- Documents and their embeddings live in memory for the browser session only — a production version with persistent multi-session documents would need a real backend + vector store.
