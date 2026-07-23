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

const docTextEl = document.getElementById('docText');
docTextEl.textContent = SAMPLE_DOC;

// ---- Document mode toggle (sample vs custom) ----
let activeDocument = SAMPLE_DOC;

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
      activeDocument = SAMPLE_DOC;
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

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.txt')) {
    customHint.textContent = 'Please upload a .txt file.';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    customText.value = reader.result;
    customHint.textContent = `Loaded "${file.name}" — click "Use this document" to activate it.`;
  };
  reader.readAsText(file);
});

useCustomBtn.addEventListener('click', () => {
  const text = customText.value.trim();
  if (!text) {
    customHint.textContent = 'Paste some text or upload a file first.';
    return;
  }
  activeDocument = text;
  customHint.textContent = 'Document activated — ask a question in the chat panel.';
  resetChat();
});

// ---- Chat logic ----
const chatWindow = document.getElementById('chatWindow');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const resetBtn = document.getElementById('resetBtn');

let chatHistory = []; // [{role: 'user'|'model', text: string}]

function renderEmptyState() {
  chatWindow.innerHTML = '<p class="empty-state">Ask a question below — try "What happens in Away mode?" or "Is water damage covered by warranty?"</p>';
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

function addTyping() {
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  chatWindow.appendChild(typing);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return typing;
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

  const typing = addTyping();

  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: activeDocument,
        question,
        history: chatHistory
      })
    });

    const data = await response.json();
    typing.remove();

    if (!response.ok) {
      addBubble('error', data.error || 'Something went wrong. Please try again.');
      return;
    }

    addBubble('bot', data.answer);
    chatHistory.push({ role: 'model', text: data.answer });
  } catch (err) {
    typing.remove();
    addBubble('error', 'Could not reach the server. Please try again.');
  } finally {
    chatInput.disabled = false;
    chatInput.focus();
  }
});
