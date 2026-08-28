// ---- Sample document (so the demo works instantly, no upload needed) ----
const SAMPLE_DOC = `Aurora Smart Thermostat — User Manual

1. Getting Started
The Aurora Smart Thermostat connects to your home Wi-Fi network during setup. Hold the front button for 3 seconds to enter pairing mode, then follow the instructions in the Aurora app to connect.

2. Temperature Modes
Aurora supports three modes: Comfort, Eco, and Away. Comfort mode maintains your set temperature at all times. Eco mode automatically adjusts temperature by up to 3 degrees to save energy when you're not home. Away mode drops heating/cooling to a minimal safe level and resumes 30 minutes before your scheduled return, based on your calendar settings in the app.

3. Battery and Power
Aurora is powered by your home's existing thermostat wiring and does not require batteries. If the display shows a battery icon, this indicates the backup battery (used during power outages) is low and should be replaced with two AAA batteries.

4. Scheduling
You can create up to 6 schedule periods per day directly from the Aurora app under Settings > Schedule. Each period can have its own target temperature. Schedules can be different for weekdays and weekends.

5. Troubleshooting
If the thermostat screen is blank, check that your home's circuit breaker for HVAC hasn't tripped. If the app shows "Offline," move your router closer or use the Aurora Wi-Fi extender kit (sold separately). A factory reset can be performed by holding both side buttons for 10 seconds — note this will erase all schedules.

6. Warranty
Aurora Smart Thermostat comes with a 2-year limited warranty covering manufacturing defects. It does not cover damage from incorrect installation or power surges. Contact support within 30 days of noticing a defect to file a claim.`;

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const docTextEl = document.getElementById('docText');
docTextEl.textContent = SAMPLE_DOC;

// ---- RAG state: the document, its chunks, and their embeddings ----
const state = {
  activeDocument: SAMPLE_DOC,
  chunks: [],
  embeddings: null,
  indexed: false,
  indexing: false,
  indexingPromise: null
};

const EMBED_BATCH_SIZE = 16;
const TOP_K = 4;

// ---- Chunking: split into overlapping word windows ----
function chunkText(text, chunkWords = 140, overlapWords = 30) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkWords, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
    start = end - overlapWords;
  }
  return chunks;
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

// ---- Talking to /api/embed (batched) ----
async function embedTexts(texts, taskType, onProgress) {
  const batches = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    batches.push(texts.slice(i, i + EMBED_BATCH_SIZE));
  }
  const all = [];
  for (let i = 0; i < batches.length; i++) {
    if (onProgress) onProgress(i + 1, batches.length);
    const res = await fetch('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: batches[i], taskType })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Embedding request failed');
    all.push(...data.embeddings);
  }
  return all;
}

// ---- Indexing: chunk the active document and embed every chunk ----
const indexStatusEl = document.getElementById('indexStatus');
function setIndexStatus(text, kind) {
  indexStatusEl.textContent = text;
  indexStatusEl.className = 'index-status' + (text ? ' visible' : '') + (kind ? ' ' + kind : '');
}

function invalidateIndex() {
  state.indexed = false;
  state.embeddings = null;
  state.chunks = [];
  state.indexing = false;
  state.indexingPromise = null;
  setIndexStatus('', 'idle');
}

function indexDocument() {
  if (state.indexingPromise) return state.indexingPromise;

  const chunks = chunkText(state.activeDocument);
  state.chunks = chunks;
  state.indexing = true;

  state.indexingPromise = (async () => {
    try {
      const embeddings = await embedTexts(chunks, 'RETRIEVAL_DOCUMENT', (batch, totalBatches) => {
        const label = totalBatches > 1 ? ` (batch ${batch}/${totalBatches})` : '';
        setIndexStatus(`Indexing document — embedding ${chunks.length} chunk${chunks.length === 1 ? '' : 's'}${label}…`, 'loading');
      });
      state.embeddings = embeddings;
      state.indexed = true;
      setIndexStatus(`✓ Indexed — ${chunks.length} chunk${chunks.length === 1 ? '' : 's'} ready`, 'done');
      return true;
    } catch (err) {
      setIndexStatus(`Indexing failed: ${err.message}`, 'error');
      state.indexingPromise = null;
      throw err;
    } finally {
      state.indexing = false;
    }
  })();

  return state.indexingPromise;
}

// ---- Document mode toggle (sample vs custom) ----
const toggleBtns = document.querySelectorAll('.toggle-btn');
const sampleView = document.getElementById('sampleView');
const customView = document.getElementById('customView');

toggleBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    toggleBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.dataset.mode;
    if (mode === 'sample') {
      sampleView.classList.remove('hidden');
      customView.classList.add('hidden');
      state.activeDocument = SAMPLE_DOC;
      invalidateIndex();
      resetChat();
    } else {
      sampleView.classList.add('hidden');
      customView.classList.remove('hidden');
    }
  });
});

const customText = document.getElementById('customText');
const useCustomBtn = document.getElementById('useCustomBtn');
const customHint = document.getElementById('customHint');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');

uploadBtn.addEventListener('click', () => fileInput.click());

async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(' ') + '\n\n';
  }
  return text.trim();
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const name = file.name.toLowerCase();

  if (name.endsWith('.txt')) {
    const reader = new FileReader();
    reader.onload = () => {
      customText.value = reader.result;
      customHint.textContent = `Loaded "${file.name}" — click "Use this document" to activate it.`;
    };
    reader.readAsText(file);
    return;
  }

  if (name.endsWith('.pdf')) {
    customHint.textContent = `Reading "${file.name}"…`;
    try {
      const text = await extractPdfText(file);
      if (!text) {
        customHint.textContent = 'Could not find any text in that PDF — it may be scanned or image-based.';
        return;
      }
      customText.value = text;
      customHint.textContent = `Extracted text from "${file.name}" — click "Use this document" to activate it.`;
    } catch (err) {
      customHint.textContent = 'Could not read that PDF. Try a different file.';
    }
    return;
  }

  customHint.textContent = 'Please upload a .txt or .pdf file.';
});

useCustomBtn.addEventListener('click', () => {
  const text = customText.value.trim();
  if (!text) {
    customHint.textContent = 'Paste some text or upload a file first.';
    return;
  }
  state.activeDocument = text;
  customHint.textContent = 'Document activated — ask a question in the chat panel.';
  invalidateIndex();
  resetChat();
});

// ---- Chat logic ----
const chatWindow = document.getElementById('chatWindow');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const sendBtn = chatForm.querySelector('button[type="submit"]');
const resetBtn = document.getElementById('resetBtn');

let chatHistory = []; // [{role: 'user'|'model', text: string}]

function renderEmptyState() {
  chatWindow.innerHTML = '<p class="empty-state">Ask a question below — try "What happens in Away mode?" or "Is water damage covered by warranty?"</p>';
}
renderEmptyState();

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function addBubble(role, text) {
  const emptyState = chatWindow.querySelector('.empty-state');
  if (emptyState) emptyState.remove();
  const bubble = document.createElement('div');
  bubble.className = 'bubble ' + role;
  bubble.textContent = text;
  chatWindow.appendChild(bubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return bubble;
}

function addStreamingBubble() {
  const emptyState = chatWindow.querySelector('.empty-state');
  if (emptyState) emptyState.remove();
  const bubble = document.createElement('div');
  bubble.className = 'bubble bot streaming';
  const cursor = document.createElement('span');
  cursor.className = 'stream-cursor';
  bubble.appendChild(cursor);
  chatWindow.appendChild(bubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return { bubble, cursor };
}

function addTyping() {
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  chatWindow.appendChild(typing);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return typing;
}

function addSources(afterEl, scoredChunks) {
  const wrap = document.createElement('div');
  wrap.className = 'sources';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sources-toggle';
  toggle.textContent = `Sources (${scoredChunks.length})`;

  const list = document.createElement('div');
  list.className = 'sources-list hidden';
  scoredChunks.forEach((c) => {
    const chip = document.createElement('div');
    chip.className = 'source-chip';
    const pct = Math.max(0, Math.round(c.score * 100));
    const preview = c.text.length > 220 ? c.text.slice(0, 220) + '…' : c.text;
    chip.innerHTML = `<span class="source-score">${pct}% match</span><p>${escapeHtml(preview)}</p>`;
    list.appendChild(chip);
  });

  toggle.addEventListener('click', () => list.classList.toggle('hidden'));
  wrap.appendChild(toggle);
  wrap.appendChild(list);
  afterEl.insertAdjacentElement('afterend', wrap);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function resetChat() {
  chatHistory = [];
  renderEmptyState();
}

resetBtn.addEventListener('click', resetChat);

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = chatInput.value.trim();
  if (!question) return;

  addBubble('user', question);
  chatHistory.push({ role: 'user', text: question });
  chatInput.value = '';
  chatInput.disabled = true;
  sendBtn.disabled = true;

  let typing = addTyping();

  // Step 1: make sure the document is indexed (chunked + embedded) before we can retrieve anything.
  if (!state.indexed) {
    try {
      await indexDocument();
    } catch (err) {
      typing.remove();
      addBubble('error', 'Could not index the document for search. ' + err.message);
      chatInput.disabled = false;
      sendBtn.disabled = false;
      chatInput.focus();
      return;
    }
  }

  try {
    // Step 2: embed the question and retrieve the most relevant chunks — this is the "R" in RAG.
    const [questionEmbedding] = await embedTexts([question], 'RETRIEVAL_QUERY');
    const scored = state.chunks
      .map((text, i) => ({ text, score: cosineSim(questionEmbedding, state.embeddings[i]) }))
      .sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, Math.min(TOP_K, scored.length));

    typing.remove();
    typing = null;

    // Step 3: stream the answer, grounded only in the retrieved chunks.
    const { bubble, cursor } = addStreamingBubble();
    let fullText = '';
    let streamError = null;

    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chunks: topK.map((c) => c.text),
        question,
        history: chatHistory
      })
    });

    if (!response.ok || !response.body) {
      let errMsg = 'Something went wrong. Please try again.';
      try {
        const data = await response.json();
        errMsg = data.error || errMsg;
      } catch {
        // ignore parse failure, use default message
      }
      bubble.remove();
      addBubble('error', errMsg);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
          if (parsed.error) {
            streamError = parsed.error;
            continue;
          }
          if (parsed.text) {
            fullText += parsed.text;
            bubble.textContent = fullText;
            bubble.appendChild(cursor);
            chatWindow.scrollTop = chatWindow.scrollHeight;
          }
        } catch {
          // skip malformed SSE line
        }
      }
    }

    cursor.remove();
    bubble.classList.remove('streaming');

    if (streamError && !fullText) {
      bubble.remove();
      addBubble('error', streamError);
      return;
    }

    if (window.marked && window.DOMPurify) {
      bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullText || '(no response)'));
    } else {
      bubble.textContent = fullText || '(no response)';
    }

    addSources(bubble, topK);
    chatHistory.push({ role: 'model', text: fullText });
  } catch (err) {
    if (typing) typing.remove();
    addBubble('error', 'Could not reach the server. Please try again.');
  } finally {
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
});
