// Vercel Edge Function — orchestrates three Gemini calls per question:
//
//   1. Doc Agent    — answers strictly from the document chunks the frontend
//                      already retrieved (see js/main.js + api/embed.js).
//   2. Web Agent     — answers using Gemini's built-in Google Search grounding,
//                      running at the same time as the Doc Agent.
//   3. Arbitrator    — once both finish, synthesizes them into one final
//                      answer and streams it back as it's generated.
//
// Progress events for all three stages are sent over the same SSE stream so
// the frontend can render the pipeline running live, not just the final text.

export const config = { runtime: 'edge' };

const MODEL = 'gemini-3.5-flash';

function sseLine(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

async function callGemini(apiKey, { systemInstruction, contents, tools, generationConfig }) {
  const body = { contents };
  if (systemInstruction) body.system_instruction = { parts: [{ text: systemInstruction }] };
  if (tools) body.tools = tools;
  if (generationConfig) body.generationConfig = generationConfig;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data && data.error && data.error.message) || 'Gemini request failed');
  }
  return data;
}

function extractText(data) {
  const candidate = data && data.candidates && data.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  return (parts || []).map((p) => p.text || '').join('');
}

// --- Doc Agent: answers only from the retrieved document excerpts ---
async function runDocAgent(apiKey, chunks, question) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { hasDocuments: false, answer: '' };
  }

  const context = chunks
    .map((c, i) => `[Excerpt ${i + 1} — from "${(c && c.docName) || 'document'}"]\n${String((c && c.text) || c).slice(0, 2000)}`)
    .join('\n\n');

  const systemInstruction =
    'You answer ONLY using the excerpts below, retrieved from the user\'s own uploaded documents. ' +
    "If the excerpts don't contain the answer, say plainly that the documents don't cover it — never guess " +
    'or use outside knowledge. Keep it concise.\n\n' + context;

  const data = await callGemini(apiKey, {
    systemInstruction,
    contents: [{ role: 'user', parts: [{ text: question }] }]
  });

  return { hasDocuments: true, answer: extractText(data) };
}

// --- Web Agent: answers using live Google Search grounding ---
async function runWebAgent(apiKey, question) {
  const data = await callGemini(apiKey, {
    contents: [{ role: 'user', parts: [{ text: question }] }],
    tools: [{ google_search: {} }]
  });

  const candidate = data.candidates && data.candidates[0];
  const groundingChunks = (candidate && candidate.groundingMetadata && candidate.groundingMetadata.groundingChunks) || [];
  const sources = groundingChunks
    .map((g) => ({ title: (g.web && g.web.title) || (g.web && g.web.uri) || 'Source', url: (g.web && g.web.uri) || '' }))
    .filter((s) => s.url);
  const searchWidget =
    (candidate && candidate.groundingMetadata && candidate.groundingMetadata.searchEntryPoint && candidate.groundingMetadata.searchEntryPoint.renderedContent) || '';

  return { answer: extractText(data), sources, searchWidget };
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

  const { chunks, question, history, temperature } = body || {};
  if (!question) {
    return new Response(JSON.stringify({ error: 'Missing question' }), { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Server is missing GEMINI_API_KEY. Add it in Vercel → Project → Settings → Environment Variables.' }),
      { status: 500 }
    );
  }

  const clampedTemperature = Math.min(1, Math.max(0, typeof temperature === 'number' ? temperature : 0.3));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(sseLine(obj)));

      send({ stage: 'doc', status: 'running' });
      send({ stage: 'web', status: 'running' });

      const docPromise = runDocAgent(apiKey, chunks, question)
        .then((result) => {
          send({
            stage: 'doc',
            status: 'done',
            hasDocuments: result.hasDocuments,
            preview: result.answer ? result.answer.slice(0, 160) : ''
          });
          return result;
        })
        .catch((err) => {
          send({ stage: 'doc', status: 'error', error: String(err.message || err) });
          return { hasDocuments: false, answer: '' };
        });

      const webPromise = runWebAgent(apiKey, question)
        .then((result) => {
          send({
            stage: 'web',
            status: 'done',
            sources: result.sources,
            preview: result.answer ? result.answer.slice(0, 160) : ''
          });
          return result;
        })
        .catch((err) => {
          send({ stage: 'web', status: 'error', error: String(err.message || err) });
          return { answer: '', sources: [], searchWidget: '' };
        });

      const [docResult, webResult] = await Promise.all([docPromise, webPromise]);

      send({ stage: 'arbitrator', status: 'running' });

      const arbitratorSystem =
        'You are the final-answer synthesizer in a two-agent research assistant. Combine the two candidate findings ' +
        "below into one clear, well-organized answer to the user's question.\n\n" +
        `DOC AGENT (from the user's own documents) found:\n${docResult.hasDocuments ? (docResult.answer || '(no relevant content found)') : '(no documents were provided by the user)'}\n\n` +
        `WEB AGENT (from a live Google Search) found:\n${webResult.answer || '(no web results available)'}\n\n` +
        'Where relevant, briefly note whether a piece of information came from the documents or from the web ' +
        '(e.g. "According to your document..." / "Based on current web results..."). If the two sources agree, ' +
        "you don't need to belabor it. If they conflict, flag the conflict clearly instead of silently picking one. " +
        'If neither source has relevant information, say so honestly rather than guessing. Skip preamble — answer directly.';

      const contents = [];
      if (Array.isArray(history)) {
        history.slice(-6).forEach((turn) => {
          if (turn && turn.text) {
            contents.push({ role: turn.role === 'user' ? 'user' : 'model', parts: [{ text: turn.text }] });
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
              system_instruction: { parts: [{ text: arbitratorSystem }] },
              contents,
              generationConfig: { temperature: clampedTemperature }
            })
          }
        );
      } catch (err) {
        send({ error: 'Request to Gemini failed: ' + String(err) });
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
        return;
      }

      if (!upstream.ok || !upstream.body) {
        let message = 'Arbitrator request failed';
        try {
          const errData = await upstream.json();
          message = (errData && errData.error && errData.error.message) || message;
        } catch {
          // ignore parse failure
        }
        send({ error: message });
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
        return;
      }

      // Also forward the web agent's search sources + required attribution widget
      // alongside the final answer, so the UI can render them together.
      send({ stage: 'sources', webSources: webResult.sources, searchWidget: webResult.searchWidget });

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
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
              const text = extractText(parsed);
              if (text) send({ text });
            } catch {
              // skip malformed SSE line
            }
          }
        }
      } catch (err) {
        send({ error: 'Stream interrupted: ' + String(err) });
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
