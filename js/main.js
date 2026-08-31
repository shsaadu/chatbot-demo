// ---- Sample document (so the demo works instantly, no upload needed) ----
const SAMPLE_NAME = 'Aurora Smart Thermostat — User Manual';
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

document.getElementById('docText').textContent = SAMPLE_DOC;

// ---- Global state: documents (each with its own chunks/embeddings) + tunable settings ----
const state = {
  documents: [], // { id, name, text, chunks, embeddings, indexed, indexing, indexingPromise }
  settings: { chunkWords: 140, overlapWords: 30, topK: 4, temperature: 0.3 }
};

const EMBED_BATCH_SIZE = 16;
let docIdCounter = 0;

// ---- Chunking: split into overlapping word windows ----
function chunkText(text, chunkWords, overlapWords) {
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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

// ---- Document management ----
const docListEl = document.getElementById('docList');
const docCountBadge = document.getElementById('docCountBadge');

function renderDocList() {
  docListEl.innerHTML = '';
  state.documents.forEach((doc) => {
    const chip = document.createElement('div');
    chip.className = 'doc-chip';
    const status = doc.indexing
      ? 'indexing…'
      : doc.indexed
      ? `${doc.chunks.length} chunk${doc.chunks.length === 1 ? '' : 's'}`
      : 'not indexed yet';
    chip.innerHTML =
      `<span class="doc-chip-name">${escapeHtml(doc.name)}</span>` +
      `<span class="doc-chip-meta">${status}</span>` +
      `<button class="doc-chip-remove" type="button" aria-label="Remove document">×</button>`;
    chip.querySelector('.doc-chip-remove').addEventListener('click', () => removeDocument(doc.id));
    docListEl.appendChild(chip);
  });
  docCountBadge.textContent = `${state.documents.length} active`;
}

function addDocument(name, text) {
  const doc = {
    id: ++docIdCounter,
    name,
    text,
    chunks: [],
    embeddings: null,
    indexed: false,
    indexing: false,
    indexingPromise: null
  };
  state.documents.push(doc);
  renderDocList();
  return doc;
}

function removeDocument(id) {
  state.documents = state.documents.filter((d) => d.id !== id);
  renderDocList();
}

function invalidateAllIndexes() {
  state.documents.forEach((d) => {
    d.indexed = false;
    d.embeddings = null;
    d.chunks = [];
    d.indexing = false;
    d.indexingPromise = null;
  });
  renderDocList();
}

// ---- Indexing a single document (chunk + embed) ----
const indexStatusEl = document.getElementById('indexStatus');
function setIndexStatus(text, kind) {
  indexStatusEl.textContent = text;
  indexStatusEl.className = 'index-status' + (text ? ' visible' : '') + (kind ? ' ' + kind : '');
}

function indexDocument(doc) {
  if (doc.indexingPromise) return doc.indexingPromise;

  const chunks = chunkText(doc.text, state.settings.chunkWords, state.settings.overlapWords);
  doc.chunks = chunks;
  doc.indexing = true;
  renderDocList();

  doc.indexingPromise = (async () => {
    try {
      const embeddings = await embedTexts(chunks, 'RETRIEVAL_DOCUMENT', (batch, total) => {
        const label = total > 1 ? ` (batch ${batch}/${total})` : '';
        setIndexStatus(`Indexing "${doc.name}"${label}…`, 'loading');
      });
      doc.embeddings = embeddings;
      doc.indexed = true;
      return true;
    } catch (err) {
      doc.indexingPromise = null;
      throw err;
    } finally {
      doc.indexing = false;
      renderDocList();
    }
  })();

  return doc.indexingPromise;
}

// Auto-load the sample document so the demo works instantly.
addDocument(SAMPLE_NAME, SAMPLE_DOC);

// ---- RAG settings sliders ----
const chunkSizeSlider = document.getElementById('chunkSizeSlider');
const chunkSizeValue = document.getElementById('chunkSizeValue');
const topKSlider = document.getElementById('topKSlider');
const topKValue = document.getElementById('topKValue');
const temperatureSlider = document.getElementById('temperatureSlider');
const temperatureValue = document.getElementById('temperatureValue');
const settingsToggle = document.getElementById('settingsToggle');
const settingsBody = document.getElementById('settingsBody');

chunkSizeSlider.addEventListener('input', () => {
  chunkSizeValue.textContent = chunkSizeSlider.value;
});
chunkSizeSlider.addEventListener('change', () => {
  state.settings.chunkWords = parseInt(chunkSizeSlider.value, 10);
  state.settings.overlapWords = Math.max(10, Math.round(state.settings.chunkWords * 0.2));
  invalidateAllIndexes();
  setIndexStatus('Chunk size changed — documents will re-index on your next question.', 'idle');
});

topKSlider.addEventListener('input', () => {
  topKValue.textContent = topKSlider.value;
  state.settings.topK = parseInt(topKSlider.value, 10);
});

temperatureSlider.addEventListener('input', () => {
  temperatureValue.textContent = parseFloat(temperatureSlider.value).toFixed(2);
  state.settings.temperature = parseFloat(temperatureSlider.value);
});

settingsToggle.addEventListener('click', () => {
  const hidden = settingsBody.classList.toggle('hidden');
  settingsToggle.textContent = hidden ? 'Show' : 'Hide';
});

// ---- Document add UI (sample / paste / upload) ----
const toggleBtns = document.querySelectorAll('.toggle-btn');
const sampleView = document.getElementById('sampleView');
const customView = document.getElementById('customView');
const addSampleBtn = document.getElementById('addSampleBtn');
const sampleHint = document.getElementById('sampleHint');
const customText = document.getElementById('customText');
const useCustomBtn = document.getElementById('useCustomBtn');
const customHint = document.getElementById('customHint');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');

toggleBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    toggleBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.mode === 'sample') {
      sampleView.classList.remove('hidden');
      customView.classList.add('hidden');
    } else {
      sampleView.classList.add('hidden');
      customView.classList.remove('hidden');
    }
  });
});

addSampleBtn.addEventListener('click', () => {
  if (state.documents.some((d) => d.name === SAMPLE_NAME)) {
    sampleHint.textContent = 'Already added — check the documents list above.';
    return;
  }
  addDocument(SAMPLE_NAME, SAMPLE_DOC);
  sampleHint.textContent = 'Added — ask a question in the chat panel.';
});

let uploadedFileName = null;

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
      uploadedFileName = file.name;
      customHint.textContent = `Loaded "${file.name}" — click "+ Add document" to add it.`;
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
      uploadedFileName = file.name;
      customHint.textContent = `Extracted text from "${file.name}" — click "+ Add document" to add it.`;
    } catch (err) {
      customHint.textContent = 'Could not read that PDF. Try a different file.';
    }
    return;
  }

  customHint.textContent = 'Please upload a .txt or .pdf file.';
});

let pastedDocCounter = 0;

useCustomBtn.addEventListener('click', () => {
  const text = customText.value.trim();
  if (!text) {
    customHint.textContent = 'Paste some text or upload a file first.';
    return;
  }
  const name = uploadedFileName || `Pasted document ${++pastedDocCounter}`;
  addDocument(name, text);
  customHint.textContent = `Added "${name}" — ask a question in the chat panel.`;
  customText.value = '';
  uploadedFileName = null;
});

// ---- Agent pipeline UI ----
function updateStage(stage, status, detail) {
  const capitalized = stage.charAt(0).toUpperCase() + stage.slice(1);
  const stageEl = document.getElementById('stage' + capitalized);
  const detailEl = document.getElementById('stage' + capitalized + 'Detail');
  if (stageEl) {
    stageEl.classList.remove('idle', 'running', 'done', 'error');
    stageEl.classList.add(status);
  }
  if (detailEl && detail !== undefined) detailEl.textContent = detail;
}

function resetPipeline() {
  updateStage('doc', 'idle', 'Idle — searches only your documents');
  updateStage('web', 'idle', 'Idle — live Google Search grounding');
  updateStage('arbitrator', 'idle', "Idle — synthesizes both agents' answers");
}

// ---- Chat logic ----
const chatWindow = document.getElementById('chatWindow');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const sendBtn = chatForm.querySelector('button[type="submit"]');
const resetBtn = document.getElementById('resetBtn');

let chatHistory = []; // [{role: 'user'|'model', text: string}]

function renderEmptyState() {
  chatWindow.innerHTML =
    '<p class="empty-state">Ask anything — try "What happens in Away mode?" (your document), "What\'s today\'s date?" (the web), or something that needs both.</p>';
}
renderEmptyState();

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

function addSources(afterEl, docChunks, webSources, searchWidget) {
  const hasDocSources = docChunks && docChunks.length > 0;
  const hasWebSources = webSources && webSources.length > 0;
  if (!hasDocSources && !hasWebSources && !searchWidget) return;

  const wrap = document.createElement('div');
  wrap.className = 'sources';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sources-toggle';
  const total = (hasDocSources ? docChunks.length : 0) + (hasWebSources ? webSources.length : 0);
  toggle.textContent = `Sources (${total})`;

  const list = document.createElement('div');
  list.className = 'sources-list hidden';

  if (hasDocSources) {
    const heading = document.createElement('div');
    heading.className = 'sources-group-label';
    heading.textContent = 'From your documents';
    list.appendChild(heading);
    docChunks.forEach((c) => {
      const chip = document.createElement('div');
      chip.className = 'source-chip';
      const pct = Math.max(0, Math.round(c.score * 100));
      const preview = c.text.length > 220 ? c.text.slice(0, 220) + '…' : c.text;
      chip.innerHTML =
        `<span class="source-score">${pct}% match</span> <span class="source-doc-name">${escapeHtml(c.docName)}</span>` +
        `<p>${escapeHtml(preview)}</p>`;
      list.appendChild(chip);
    });
  }

  if (hasWebSources) {
    const heading = document.createElement('div');
    heading.className = 'sources-group-label';
    heading.textContent = 'From the web';
    list.appendChild(heading);
    webSources.forEach((s) => {
      const chip = document.createElement('a');
      chip.className = 'source-chip source-chip-link';
      chip.href = s.url;
      chip.target = '_blank';
      chip.rel = 'noopener';
      chip.innerHTML =
        `<span class="source-web-title">${escapeHtml(s.title)}</span>` +
        `<span class="source-web-url">${escapeHtml(s.url)}</span>`;
      list.appendChild(chip);
    });
  }

  if (searchWidget) {
    const widgetWrap = document.createElement('div');
    widgetWrap.className = 'search-widget';
    // Rendered directly from Gemini's groundingMetadata — required attribution for Google Search grounding.
    widgetWrap.innerHTML = searchWidget;
    list.appendChild(widgetWrap);
  }

  toggle.addEventListener('click', () => list.classList.toggle('hidden'));
  wrap.appendChild(toggle);
  wrap.appendChild(list);
  afterEl.insertAdjacentElement('afterend', wrap);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function resetChat() {
  chatHistory = [];
  renderEmptyState();
  resetPipeline();
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

  updateStage('doc', 'running', 'Searching your documents…');
  updateStage('web', 'running', 'Searching the live web…');
  updateStage('arbitrator', 'idle', 'Waiting on both agents…');

  let topK = [];
  let lastWebSources = [];
  let lastSearchWidget = '';

  try {
    // Best-effort indexing of any not-yet-indexed documents. If this fails,
    // we still continue — the Web Agent can answer independently.
    const needsIndex = state.documents.filter((d) => !d.indexed);
    if (needsIndex.length > 0) {
      setIndexStatus(`Indexing ${needsIndex.length} document${needsIndex.length === 1 ? '' : 's'}…`, 'loading');
      const results = await Promise.allSettled(needsIndex.map((d) => indexDocument(d)));
      const failures = results.filter((r) => r.status === 'rejected').length;
      const indexedCount = state.documents.filter((d) => d.indexed).length;
      const totalChunks = state.documents.reduce((sum, d) => sum + (d.indexed ? d.chunks.length : 0), 0);
      if (failures > 0) {
        setIndexStatus(`Indexed ${indexedCount}/${state.documents.length} documents (${failures} failed) — continuing anyway`, 'error');
      } else if (state.documents.length > 0) {
        setIndexStatus(`✓ Indexed — ${state.documents.length} document${state.documents.length === 1 ? '' : 's'}, ${totalChunks} chunks ready`, 'done');
      }
    }

    const indexedDocs = state.documents.filter((d) => d.indexed && d.chunks.length > 0);
    if (indexedDocs.length > 0) {
      const [questionEmbedding] = await embedTexts([question], 'RETRIEVAL_QUERY');
      const pooled = [];
      indexedDocs.forEach((d) => {
        d.chunks.forEach((text, i) => {
          pooled.push({ text, docName: d.name, score: cosineSim(questionEmbedding, d.embeddings[i]) });
        });
      });
      pooled.sort((a, b) => b.score - a.score);
      topK = pooled.slice(0, Math.min(state.settings.topK, pooled.length));
    }

    const { bubble, cursor } = addStreamingBubble();
    let fullText = '';

    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chunks: topK.map((c) => ({ text: c.text, docName: c.docName })),
        question,
        history: chatHistory,
        temperature: state.settings.temperature
      })
    });

    if (!response.ok || !response.body) {
      let errMsg = 'Something went wrong. Please try again.';
      try {
        const data = await response.json();
        errMsg = data.error || errMsg;
      } catch {
        // ignore parse failure
      }
      bubble.remove();
      updateStage('doc', 'error', 'Request failed');
      updateStage('web', 'error', 'Request failed');
      updateStage('arbitrator', 'error', 'Request failed');
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

        let parsed;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        if (parsed.stage === 'doc') {
          if (parsed.status === 'done') {
            updateStage(
              'doc',
              'done',
              parsed.hasDocuments ? (parsed.preview ? 'Found relevant content' : 'Nothing relevant found') : 'No documents to search'
            );
          } else if (parsed.status === 'error') {
            updateStage('doc', 'error', 'Failed: ' + parsed.error);
          }
        } else if (parsed.stage === 'web') {
          if (parsed.status === 'done') {
            const n = (parsed.sources || []).length;
            updateStage('web', 'done', n > 0 ? `Found ${n} web source${n === 1 ? '' : 's'}` : 'No strong web results');
          } else if (parsed.status === 'error') {
            updateStage('web', 'error', 'Failed: ' + parsed.error);
          }
        } else if (parsed.stage === 'arbitrator' && parsed.status === 'running') {
          updateStage('arbitrator', 'running', 'Synthesizing final answer…');
        } else if (parsed.stage === 'sources') {
          lastWebSources = parsed.webSources || [];
          lastSearchWidget = parsed.searchWidget || '';
        } else if (parsed.error) {
          updateStage('arbitrator', 'error', parsed.error);
        } else if (parsed.text) {
          fullText += parsed.text;
          bubble.textContent = fullText;
          bubble.appendChild(cursor);
          chatWindow.scrollTop = chatWindow.scrollHeight;
        }
      }
    }

    cursor.remove();
    bubble.classList.remove('streaming');

    if (!fullText) {
      updateStage('arbitrator', 'error', 'No answer generated');
      bubble.remove();
      addBubble('error', 'No answer was generated. Please try again.');
      return;
    }

    updateStage('arbitrator', 'done', 'Final answer ready');

    if (window.marked && window.DOMPurify) {
      bubble.innerHTML = DOMPurify.sanitize(marked.parse(fullText));
    } else {
      bubble.textContent = fullText;
    }

    addSources(bubble, topK, lastWebSources, lastSearchWidget);
    chatHistory.push({ role: 'model', text: fullText });
  } catch (err) {
    updateStage('doc', 'error', 'Something went wrong');
    updateStage('web', 'error', 'Something went wrong');
    addBubble('error', 'Could not reach the server. Please try again.');
  } finally {
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
});
