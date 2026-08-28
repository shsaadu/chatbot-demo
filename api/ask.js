// Vercel Edge Function — runs on the server, never in the browser.
// This is what keeps your Gemini API key private: the browser calls THIS
// endpoint, and only this endpoint calls Google.
//
// Unlike a "stuff the whole document in the prompt" demo, this endpoint
// receives only the small set of document chunks that retrieval (see
// api/embed.js + js/main.js) already decided are relevant to the question.
// It streams the answer back token-by-token instead of waiting for the
// full response.

export const config = { runtime: 'edge' };

const MODEL = 'gemini-3.5-flash';

function sse(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { chunks, question, history } = body || {};

  if (!Array.isArray(chunks) || chunks.length === 0 || !question) {
    return new Response(JSON.stringify({ error: 'Missing chunks or question' }), { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'Server is missing GEMINI_API_KEY. Add it in Vercel → Project → Settings → Environment Variables.'
      }),
      { status: 500 }
    );
  }

  // Only the retrieved excerpts go in the prompt — not the whole document.
  const context = chunks
    .map((c, i) => `[Excerpt ${i + 1}]\n${String(c).slice(0, 2000)}`)
    .join('\n\n');

  const systemInstruction =
    'You are a helpful assistant that answers questions using ONLY the excerpts below, ' +
    'which were retrieved from a larger document because they are the most relevant to the question. ' +
    "If the excerpts don't contain the answer, say clearly that the document doesn't cover it, rather " +
    'than guessing or using outside knowledge. Keep answers concise.\n\n' +
    context;

  const contents = [];
  if (Array.isArray(history)) {
    history.slice(-6).forEach((turn) => {
      if (turn && turn.text) {
        contents.push({
          role: turn.role === 'user' ? 'user' : 'model',
          parts: [{ text: turn.text }]
        });
      }
    });
  }
  contents.push({ role: 'user', parts: [{ text: question }] });

  let upstream;
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents
        })
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Request to Gemini failed', details: String(err) }), {
      status: 500
    });
  }

  if (!upstream.ok || !upstream.body) {
    let message = 'Gemini API error';
    try {
      const errData = await upstream.json();
      message = (errData && errData.error && errData.error.message) || message;
    } catch {
      // ignore parse failure, use default message
    }
    return new Response(JSON.stringify({ error: message }), { status: upstream.status || 500 });
  }

  // Re-package Gemini's SSE stream into a simpler `{ text }` / `{ error }` stream
  // so the frontend doesn't need to know Gemini's response shape.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(jsonStr);
              const text =
                (parsed.candidates &&
                  parsed.candidates[0] &&
                  parsed.candidates[0].content &&
                  parsed.candidates[0].content.parts &&
                  parsed.candidates[0].content.parts.map((p) => p.text || '').join('')) ||
                '';
              if (text) controller.enqueue(encoder.encode(sse({ text })));
            } catch {
              // skip malformed SSE line
            }
          }
        }
      } catch (err) {
        controller.enqueue(encoder.encode(sse({ error: 'Stream interrupted: ' + String(err) })));
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  });
}
