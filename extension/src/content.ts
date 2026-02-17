/**
 * Content script — runs on suno.com pages.
 *
 * - Gets JWT tokens from the page script (which has access to window.Clerk)
 * - Routes API calls through the background service worker (bypasses CORS)
 * - Communicates with the bridge server over WebSocket
 */

import type { BridgeRequest, BridgeResponse, BridgeEvent } from './protocol';
import { PAGE_TO_CONTENT, CONTENT_TO_PAGE } from './protocol';

const DEFAULT_WS_URL = 'ws://localhost:3001/ws';
const HEARTBEAT_INTERVAL = 15_000;
const MAX_RECONNECT_DELAY = 30_000;
const TOKEN_TIMEOUT = 10_000;

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let wsUrl = DEFAULT_WS_URL;

// Pending token requests to the page script
const pendingTokenRequests = new Map<string, {
  resolve: (token: string) => void;
  reject: (err: Error) => void;
}>();

// Load configured WS URL
chrome.storage.local.get('bridgeUrl', (result) => {
  if (result.bridgeUrl) wsUrl = result.bridgeUrl;
  injectPageScript();
  connectWebSocket();
});

// Listen for URL config changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.bridgeUrl?.newValue) {
    wsUrl = changes.bridgeUrl.newValue;
    if (ws) ws.close();
    connectWebSocket();
  }
});

/** Inject the page script into the MAIN world */
function injectPageScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page-script.js');
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => script.remove();
}

/** Get a JWT token from the page script (via Clerk) */
function getToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingTokenRequests.delete(id);
      reject(new Error('Token request timed out'));
    }, TOKEN_TIMEOUT);

    pendingTokenRequests.set(id, {
      resolve: (token: string) => {
        clearTimeout(timer);
        pendingTokenRequests.delete(id);
        resolve(token);
      },
      reject: (err: Error) => {
        clearTimeout(timer);
        pendingTokenRequests.delete(id);
        reject(err);
      },
    });

    window.postMessage({
      source: CONTENT_TO_PAGE,
      payload: { id, method: 'get_token', params: {} },
    }, '*');
  });
}

/** Execute an API call via the background service worker */
async function executeApiCall(req: BridgeRequest): Promise<BridgeResponse> {
  try {
    const token = await getToken();
    const { url, method, headers, body } = req.params;

    console.log(`[Suno Bridge] ${method} ${url}`);

    const bgResponse: any = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'apiCall', token, url, method, headers, body },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        }
      );
    });

    if (!bgResponse) {
      return { id: req.id, error: { code: -1, message: 'No response from background worker' } };
    }

    if (bgResponse.error) {
      return { id: req.id, error: bgResponse.error };
    }

    console.log(`[Suno Bridge] Response: ${bgResponse.result.status}`);
    return { id: req.id, result: bgResponse.result };
  } catch (err: any) {
    console.error('[Suno Bridge] API call failed:', err);
    return { id: req.id, error: { code: -1, message: err.message || String(err) } };
  }
}

// Listen for responses from the page script (token responses)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== PAGE_TO_CONTENT) return;

  const payload = event.data.payload;

  // Handle token responses
  if (payload.id && pendingTokenRequests.has(payload.id)) {
    const pending = pendingTokenRequests.get(payload.id)!;
    if (payload.error) {
      pending.reject(new Error(payload.error.message));
    } else if (payload.result?.data?.token) {
      pending.resolve(payload.result.data.token);
    } else {
      pending.reject(new Error('Invalid token response'));
    }
    return;
  }

  // Forward any other messages (events, bridge responses) to WS
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
});

/** Connect to the bridge server via WebSocket */
function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  try {
    ws = new WebSocket(wsUrl);
  } catch (err) {
    console.error('[Suno Bridge] WS connection error:', err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[Suno Bridge] Connected to bridge server');
    reconnectDelay = 1000;
    sendEvent({ type: 'connected', data: { url: window.location.href } });

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      sendEvent({ type: 'heartbeat' });
    }, HEARTBEAT_INTERVAL);

    chrome.runtime.sendMessage({ action: 'setStatus', connected: true });
  };

  ws.onmessage = async (event) => {
    try {
      const request: BridgeRequest = JSON.parse(event.data);

      // get_token / get_status / get_captcha → page script
      if (request.method === 'get_token' || request.method === 'get_status' || request.method === 'get_captcha') {
        window.postMessage({ source: CONTENT_TO_PAGE, payload: request }, '*');
        return;
      }

      // api_call → background service worker
      if (request.method === 'api_call') {
        const response = await executeApiCall(request);
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response));
        }
        return;
      }
    } catch (err) {
      console.error('[Suno Bridge] Failed to handle WS message:', err);
    }
  };

  ws.onclose = () => {
    console.log('[Suno Bridge] Disconnected from bridge server');
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    chrome.runtime.sendMessage({ action: 'setStatus', connected: false });
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.error('[Suno Bridge] WebSocket error:', err);
  };
}

function scheduleReconnect() {
  setTimeout(() => connectWebSocket(), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function sendEvent(event: BridgeEvent) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

console.log('[Suno Bridge] Content script loaded');
