# AI Document Q&A Chatbot — Demo (v2: real RAG)

A live chatbot that answers questions grounded only in a provided document — try the pre-loaded sample, paste your own text, or upload a `.txt`/`.pdf` file. Unlike a "stuff the whole document into the prompt" demo, this version does actual retrieval-augmented generation: the document is chunked, each chunk is embedded, and only the chunks most relevant to your question are sent to the model — which then streams its answer back token by token.

## What's new in v2

- **Real RAG pipeline** — the document is split into overlapping chunks, each chunk is embedded with `gemini-embedding-001`, and cosine similarity picks the top 4 most relevant chunks per question (instead of truncating the doc to 12,000 characters and hoping the answer's in there).
- **Streaming answers** — `api/ask.js` runs as a Vercel **Edge Function** and streams Gemini's response as Server-Sent Events, so the answer appears token by token instead of after one long wait.
- **PDF support** — `.pdf` uploads are parsed client-side with `pdf.js`, no server-side file handling needed.
- **Source citations** — every answer shows a "Sources" toggle listing the exact excerpts (with match %) the model was given, so you can see *why* it answered the way it did.
- **Markdown rendering** — answers render with `marked` + `DOMPurify` (lists, code blocks, bold, links).

## File structure

```
chatbot-demo/
├── index.html         → page structure
├── css/style.css       → styling (matches the portfolio's design system)
├── js/main.js          → chunking, embeddings, retrieval, streaming, PDF parsing, chat UI
├── api/ask.js          → Edge Function — streams the grounded answer from Gemini
├── api/embed.js        → Serverless Function — embeds document chunks & questions
├── package.json
├── favicon.svg
└── README.md
```

## How it works

1. **Chunking** (`js/main.js`): the active document is split into ~140-word overlapping windows.
2. **Indexing**: the first time you ask a question, every chunk is sent to `api/embed.js`, which calls Gemini's `gemini-embedding-001` model and returns a vector per chunk. This only happens once per document (cached in memory for the session).
3. **Retrieval**: your question is embedded the same way, then compared to every chunk vector with cosine similarity. The top 4 matches are selected.
4. **Generation**: only those top 4 excerpts (not the whole document) are sent to `api/ask.js`, which streams Gemini's answer back over SSE.
5. **Citations**: the same top-4 excerpts are shown under the answer so you can verify the grounding yourself.

## 1. Get a free Gemini API key

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with a Google account
3. Click **Get API key → Create API key**
4. Copy the key — you won't need a credit card for the free tier

The free tier has rate limits, but it's more than enough for a portfolio demo a few visitors click through. Note that v2 makes slightly more API calls than v1 (one embedding call per chunk batch, plus one per question, in addition to the answer generation call) — still well within free-tier limits for demo-scale traffic.

## 2. Deploy to Vercel

1. Push this folder to a GitHub repo (e.g. `chatbot-demo`)
2. In Vercel: **Add New → Project → Import** that repo
3. **Before clicking Deploy**, add your API key as an environment variable:
   - In the import screen, expand **Environment Variables**
   - Name: `GEMINI_API_KEY`
   - Value: (paste the key from Step 1)
   - Or if you've already deployed: go to **Project → Settings → Environment Variables**, add it there, then redeploy (Deployments tab → ⋯ → Redeploy)
4. Click **Deploy**

Vercel auto-detects `api/ask.js` as an Edge Function (it exports `config = { runtime: 'edge' }`) and `api/embed.js` as a regular Node serverless function — no extra config needed.

**Important:** never put your API key directly in the code or commit it to GitHub. It should only ever exist as a Vercel environment variable.

## 3. Testing locally (optional)

```bash
npm install -g vercel
vercel dev
```
Create a `.env.local` file (not committed to Git) with:
```
GEMINI_API_KEY=your_key_here
```

## Notes / what to extend later

- Chunk size/overlap, `TOP_K`, and the embedding output dimensionality are all tunable constants near the top of `js/main.js` and `api/embed.js`.
- PDF text extraction won't work on scanned/image-only PDFs (no text layer) — OCR would be a further extension.
- Embeddings are recomputed per browser session (not persisted), which is fine for a demo but would need a vector store (e.g. Pinecone, pgvector) for a production app with many documents.
