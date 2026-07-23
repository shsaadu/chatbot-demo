// Vercel Serverless Function — runs on the server, never in the browser.
// This is what keeps your Gemini API key private: the browser calls THIS
// endpoint, and only this endpoint (running on Vercel's servers) calls Google.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { document, question, history } = req.body || {};

  if (!document || !question) {
    res.status(400).json({ error: 'Missing document or question' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'Server is missing GEMINI_API_KEY. Add it in Vercel → Project → Settings → Environment Variables.'
    });
    return;
  }

  // Keep the document within a safe prompt size for a demo project.
  const truncatedDoc = String(document).slice(0, 12000);

  const systemInstruction =
    "You are a helpful assistant that answers questions using ONLY the information " +
    "in the document provided below. If the answer isn't in the document, say clearly " +
    "that the document doesn't cover it, rather than guessing. Keep answers concise.\n\n" +
    "DOCUMENT:\n" + truncatedDoc;

  // Include a little chat history for context, most recent turns only.
  const contents = [];
  if (Array.isArray(history)) {
    history.slice(-6).forEach((turn) => {
      contents.push({
        role: turn.role === 'user' ? 'user' : 'model',
        parts: [{ text: turn.text }]
      });
    });
  }
  contents.push({ role: 'user', parts: [{ text: question }] });

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: (data && data.error && data.error.message) || 'Gemini API error'
      });
      return;
    }

    const answer =
      (data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts.map((p) => p.text).join('')) ||
      "Sorry, I couldn't generate a response for that.";

    res.status(200).json({ answer });
  } catch (err) {
    res.status(500).json({ error: 'Request to Gemini failed', details: String(err) });
  }
};
