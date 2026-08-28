// Vercel Serverless Function — turns text into vectors using Gemini's
// embedding model. The frontend calls this twice per "session":
//   1. Once per document, to embed each chunk (task type: RETRIEVAL_DOCUMENT)
//   2. Once per question, to embed the question (task type: RETRIEVAL_QUERY)
// Cosine similarity between (2) and each vector from (1) is what picks the
// handful of chunks that actually get sent to api/ask.js — this is the
// "retrieval" half of retrieval-augmented generation.

const MODEL = 'gemini-embedding-001';
const OUTPUT_DIMENSIONALITY = 768; // smaller than the 3072 default — plenty for cosine similarity on a demo-sized doc
const MAX_TEXTS_PER_REQUEST = 20;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { texts, taskType } = req.body || {};

  if (!Array.isArray(texts) || texts.length === 0) {
    res.status(400).json({ error: 'Missing texts array' });
    return;
  }
  if (texts.length > MAX_TEXTS_PER_REQUEST) {
    res.status(400).json({ error: `Too many texts in one request (max ${MAX_TEXTS_PER_REQUEST}). Batch on the client.` });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'Server is missing GEMINI_API_KEY. Add it in Vercel → Project → Settings → Environment Variables.'
    });
    return;
  }

  const resolvedTaskType = taskType === 'RETRIEVAL_QUERY' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';

  const requests = texts.map((text) => ({
    model: `models/${MODEL}`,
    content: { parts: [{ text: String(text).slice(0, 6000) }] },
    taskType: resolvedTaskType,
    outputDimensionality: OUTPUT_DIMENSIONALITY
  }));

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ requests })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: (data && data.error && data.error.message) || 'Embedding API error'
      });
      return;
    }

    const embeddings = (data.embeddings || []).map((e) => e.values || []);
    res.status(200).json({ embeddings });
  } catch (err) {
    res.status(500).json({ error: 'Request to embedding API failed', details: String(err) });
  }
};
