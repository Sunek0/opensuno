/**
 * Popup UI logic — shows connection status, configures bridge URL,
 * and displays recent request log.
 */

const statusEl = document.getElementById('status')!;
const bridgeUrlInput = document.getElementById('bridgeUrl') as HTMLInputElement;
const saveBtn = document.getElementById('saveBtn')!;
const tabStatusEl = document.getElementById('tabStatus')!;
const requestLogEl = document.getElementById('requestLog')!;

// Load current settings
chrome.storage.local.get(['bridgeUrl', 'requestLog'], (result) => {
  bridgeUrlInput.value = result.bridgeUrl || 'ws://localhost:3001/ws';
  renderLog(result.requestLog || []);
});

// Save URL
saveBtn.addEventListener('click', () => {
  const url = bridgeUrlInput.value.trim();
  if (url) {
    chrome.storage.local.set({ bridgeUrl: url });
  }
});

// Check if a suno.com tab exists
chrome.tabs.query({ url: ['https://suno.com/*', 'https://*.suno.com/*'] }, (tabs) => {
  if (tabs.length > 0) {
    tabStatusEl.textContent = `Active (${tabs.length} tab${tabs.length > 1 ? 's' : ''})`;
    tabStatusEl.style.color = '#166534';
  } else {
    tabStatusEl.textContent = 'No suno.com tab found';
    tabStatusEl.style.color = '#991b1b';
  }
});

// Check connection status via badge
chrome.action.getBadgeText({}, (text) => {
  const connected = text === 'ON';
  statusEl.textContent = connected ? 'Connected' : 'Disconnected';
  statusEl.className = `badge ${connected ? 'connected' : 'disconnected'}`;
});

function renderLog(entries: string[]) {
  if (entries.length === 0) {
    requestLogEl.innerHTML = '<div class="empty">No requests yet</div>';
    return;
  }
  requestLogEl.innerHTML = entries
    .slice(-5)
    .reverse()
    .map((e) => `<div class="entry">${e}</div>`)
    .join('');
}

// Listen for storage changes to update log in real-time
chrome.storage.onChanged.addListener((changes) => {
  if (changes.requestLog) {
    renderLog(changes.requestLog.newValue || []);
  }
});
