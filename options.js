// Meetle — Options Page Logic

const keyInput  = document.getElementById('api-key');
const statusEl  = document.getElementById('status');

// Load saved key on open
chrome.storage.sync.get('mapsApiKey', (data) => {
  if (data.mapsApiKey) keyInput.value = data.mapsApiKey;
});

function saveKey() {
  const key = keyInput.value.trim();
  if (!key) {
    showStatus('Please paste your API key first.', 'err');
    return;
  }
  if (!key.startsWith('AIza')) {
    showStatus('That doesn\'t look like a valid Google Maps API key (should start with "AIza").', 'err');
    return;
  }
  chrome.storage.sync.set({ mapsApiKey: key }, () => {
    showStatus('✅ Key saved! Open Meetle to start searching.', 'ok');
  });
}

function clearKey() {
  chrome.storage.sync.remove('mapsApiKey', () => {
    keyInput.value = '';
    showStatus('Key removed.', 'ok');
  });
}

function toggleVisibility() {
  keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
}

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = type;
  setTimeout(() => { statusEl.className = ''; statusEl.textContent = ''; }, 4000);
}

// Save on Enter
keyInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveKey(); });
