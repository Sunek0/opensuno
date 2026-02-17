/**
 * Background service worker — makes API calls to studio-api.prod.suno.com.
 *
 * Background scripts with host_permissions can make cross-origin requests
 * without CORS restrictions. Content scripts cannot.
 */

const SUNO_API_BASE = 'https://studio-api.prod.suno.com';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('bridgeUrl', (result) => {
    if (!result.bridgeUrl) {
      chrome.storage.local.set({ bridgeUrl: 'ws://localhost:3001/ws' });
    }
  });
  setBadge(false);
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'setStatus') {
    setBadge(msg.connected);
    return false;
  }

  if (msg.action === 'apiCall') {
    handleApiCall(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: { code: -1, message: err.message } }));
    return true; // keep channel open for async response
  }

  return false;
});

async function handleApiCall(msg: {
  token: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: any;
}): Promise<{ result?: { status: number; data: any }; error?: { code: number; message: string } }> {
  const fullUrl = msg.url.startsWith('http') ? msg.url : `${SUNO_API_BASE}${msg.url}`;

  const fetchHeaders: Record<string, string> = {
    'Authorization': `Bearer ${msg.token}`,
    'Affiliate-Id': 'undefined',
    'x-suno-client': 'Android prerelease-4nt180t 1.0.42',
    'X-Requested-With': 'com.suno.android',
    ...msg.headers,
  };
  if (msg.body) {
    fetchHeaders['Content-Type'] = 'application/json';
  }

  console.log(`[Suno Bridge BG] ${msg.method} ${fullUrl}`);

  const resp = await fetch(fullUrl, {
    method: msg.method,
    headers: fetchHeaders,
    body: msg.body ? JSON.stringify(msg.body) : undefined,
  });

  let data: any;
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await resp.json();
  } else {
    data = await resp.text();
  }

  console.log(`[Suno Bridge BG] Response: ${resp.status}`);
  return { result: { status: resp.status, data } };
}

function setBadge(connected: boolean) {
  chrome.action.setBadgeText({ text: connected ? 'ON' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({
    color: connected ? '#22c55e' : '#ef4444',
  });
}
