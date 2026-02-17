/**
 * WebSocket connection manager — maintains connected extension sockets,
 * routes requests, and tracks pending responses.
 */

import { randomUUID } from 'node:crypto';
import type { ServerWebSocket } from 'bun';
import type { BridgeRequest, BridgeResponse, BridgeEvent, ExtensionMessage } from '../../extension/src/protocol';
import { isBridgeResponse, isBridgeEvent } from '../../extension/src/protocol';

export interface PendingRequest {
  resolve: (response: BridgeResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SocketInfo {
  lastHeartbeat: number;
  url?: string;
}

const REQUEST_TIMEOUT = 30_000;
const STALE_THRESHOLD = 45_000;

export class WebSocketManager {
  private sockets = new Map<ServerWebSocket<unknown>, SocketInfo>();
  private pending = new Map<string, PendingRequest>();
  private requestLog: string[] = [];

  /** Register a new extension socket */
  addSocket(ws: ServerWebSocket<unknown>) {
    this.sockets.set(ws, { lastHeartbeat: Date.now() });
    console.log(`[WS] Extension connected (${this.sockets.size} total)`);
  }

  /** Remove a disconnected socket */
  removeSocket(ws: ServerWebSocket<unknown>) {
    this.sockets.delete(ws);
    console.log(`[WS] Extension disconnected (${this.sockets.size} remaining)`);
  }

  /** Handle a message from an extension socket */
  handleMessage(ws: ServerWebSocket<unknown>, raw: string) {
    let msg: ExtensionMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.error('[WS] Invalid JSON from extension');
      return;
    }

    if (isBridgeEvent(msg)) {
      this.handleEvent(ws, msg as BridgeEvent);
    } else if (isBridgeResponse(msg)) {
      this.handleResponse(msg as BridgeResponse);
    }
  }

  private handleEvent(ws: ServerWebSocket<unknown>, event: BridgeEvent) {
    const info = this.sockets.get(ws);
    if (!info) return;

    info.lastHeartbeat = Date.now();

    if (event.type === 'connected') {
      info.url = event.data?.url;
      console.log(`[WS] Extension ready on ${info.url || 'unknown page'}`);
    }
  }

  private handleResponse(response: BridgeResponse) {
    const pending = this.pending.get(response.id);
    if (!pending) {
      console.warn(`[WS] Response for unknown request ${response.id}`);
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  /** Send a request to the extension and wait for a response */
  sendRequest(
    method: BridgeRequest['method'],
    params: BridgeRequest['params'],
    timeout = REQUEST_TIMEOUT
  ): Promise<BridgeResponse> {
    return new Promise((resolve, reject) => {
      const ws = this.getActiveSocket();
      if (!ws) {
        reject(new Error('No extension connected. Open suno.com with the extension installed.'));
        return;
      }

      const id = randomUUID();
      const request: BridgeRequest = { id, method, params };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });

      // Log the request
      const logEntry = `${new Date().toLocaleTimeString()} ${params.method} ${params.url}`;
      this.requestLog.push(logEntry);
      if (this.requestLog.length > 50) this.requestLog.shift();

      ws.send(JSON.stringify(request));
    });
  }

  /** Get the first active (non-stale) socket */
  private getActiveSocket(): ServerWebSocket<unknown> | null {
    const now = Date.now();
    for (const [ws, info] of this.sockets) {
      if (now - info.lastHeartbeat < STALE_THRESHOLD) {
        return ws;
      }
    }
    // Fall back to any socket
    const first = this.sockets.keys().next();
    return first.done ? null : first.value;
  }

  /** Check if any extension is connected */
  get isConnected(): boolean {
    return this.sockets.size > 0;
  }

  /** Get connection status info */
  getStatus() {
    return {
      connected: this.sockets.size > 0,
      sockets: this.sockets.size,
      pendingRequests: this.pending.size,
      recentRequests: this.requestLog.slice(-5),
    };
  }
}
