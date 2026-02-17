/** Shared protocol types for bridge ↔ extension communication */

// Bridge → Extension (Request)
export interface BridgeRequest {
  id: string;
  method: 'api_call' | 'get_status' | 'get_token' | 'get_captcha';
  params: {
    url: string;        // Full Suno API URL
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: any;
  };
}

// Extension → Bridge (Response)
export interface BridgeResponse {
  id: string;
  result?: { status: number; data: any };
  error?: { code: number; message: string };
}

// Extension → Bridge (Events)
export interface BridgeEvent {
  type: 'connected' | 'heartbeat' | 'token_refreshed';
  data?: any;
}

// Union of all messages the extension can send
export type ExtensionMessage = BridgeResponse | BridgeEvent;

// Type guard helpers
export function isBridgeResponse(msg: any): msg is BridgeResponse {
  return 'id' in msg && ('result' in msg || 'error' in msg);
}

export function isBridgeEvent(msg: any): msg is BridgeEvent {
  return 'type' in msg && !('id' in msg);
}

// Page ↔ Content script messaging (via window.postMessage)
export const PAGE_TO_CONTENT = 'suno-bridge-response';
export const CONTENT_TO_PAGE = 'suno-bridge-request';

export interface PageMessage {
  source: typeof PAGE_TO_CONTENT | typeof CONTENT_TO_PAGE;
  payload: BridgeRequest | BridgeResponse;
}
