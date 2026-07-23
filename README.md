# AI Document Q&A Chatbot — Demo

A live chatbot that answers questions grounded only in a provided document — try the pre-loaded sample, or paste/upload your own. Built with the Gemini API, running as a Vercel Serverless Function so your API key stays private (never exposed in the browser).

## File structure

```
chatbot-demo/
├── index.html        → page structure
├── css/style.css      → styling (matches the portfolio's design system)
├── js/main.js         → client-side chat logic, sample doc, upload handling
├── api/ask.js         → serverless function — calls Gemini, keeps API key server-side
├── package.json       → tells Vercel this is a Node project
├── favicon.svg
└── README.md
```

## 1. Get a free Gemini API key

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with a Google account
3. Click **Get API key → Create API key**
4. Copy the key — you won't need a credit card for the free tier

The free tier has rate limits (requests per minute/day depending on the model), but it's more than enough for a portfolio demo a few visitors click through.

## 2. Deploy to Vercel

Same flow as the portfolio:

1. Push this folder to a new GitHub repo (e.g. `chatbot-demo`)
2. In Vercel: **Add New → Project → Import** that repo
3. **Before clicking Deploy**, add your API key as an environment variable:
   - In the import screen, expand **Environment Variables**
   - Name: `GEMINI_API_KEY`
   - Value: (paste the key from Step 1)
   - Or if you've already deployed: go to **Project → Settings → Environment Variables**, add it there, then redeploy (Deployments tab → ⋯ → Redeploy)
4. Click **Deploy**

**Important:** never put your API key directly in the code or commit it to GitHub. It should only ever exist as a Vercel environment variable — that's exactly what `api/ask.js` is written to expect (`process.env.GEMINI_API_KEY`).

## 3. Testing locally (optional)

If you want to test before deploying:
```bash
npm install -g vercel
vercel dev
```
Create a `.env.local` file (not committed to Git) with:
```
GEMINI_API_KEY=your_key_here
```

## Notes / what to extend later

- Currently accepts pasted text or `.txt` uploads. PDF support could be added later using a library like `pdf.js` for client-side text extraction.
- The document is truncated to ~12,000 characters in `api/ask.js` to keep prompts a reasonable size — fine for short documents like manuals, FAQs, or policies.
- Rate limits are handled by Gemini's free tier itself; if you hit them during heavy testing, wait a minute or check your quota at [aistudio.google.com](https://aistudio.google.com).
