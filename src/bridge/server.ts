/**
 * Bridge Server — single Bun server hosting:
 *   - WebSocket on /ws (extension connects here)
 *   - REST API on /api/* (compatible with existing suno-api endpoints)
 *   - MCP on /mcp (Streamable HTTP transport for AI agents)
 *
 * Usage:
 *   bun run src/bridge/server.ts
 */

import { randomUUID } from 'node:crypto';
import { WebSocketManager } from './ws-manager';
import { handleApiRequest } from './api-handler';
import { createBridgeMcpServer } from './mcp-bridge';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

const PORT = parseInt(process.env.BRIDGE_PORT || '3001', 10);
const wsManager = new WebSocketManager();

// MCP session management — one transport per session
const mcpTransports = new Map<string, WebStandardStreamableHTTPServerTransport>();

function isInitializeRequest(body: any): boolean {
  if (Array.isArray(body)) return body.some((msg: any) => msg.method === 'initialize');
  return body?.method === 'initialize';
}

async function handleMcpRequest(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id',
        'Access-Control-Expose-Headers': 'mcp-session-id',
      },
    });
  }

  const sessionId = req.headers.get('mcp-session-id') || undefined;

  // Route to existing session
  if (sessionId && mcpTransports.has(sessionId)) {
    const transport = mcpTransports.get(sessionId)!;
    const resp = await transport.handleRequest(req);
    return addCorsHeaders(resp);
  }

  // New session — only for initialization POST requests
  if (req.method === 'POST') {
    // Clone the request so we can peek at the body without consuming it
    const cloned = req.clone();
    let body: any;
    try {
      body = await cloned.json();
    } catch {
      return Response.json(
        { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
        { status: 400 }
      );
    }

    if (!isInitializeRequest(body)) {
      return Response.json(
        { jsonrpc: '2.0', error: { code: -32000, message: 'Bad request: no valid session. Send initialize first.' }, id: null },
        { status: 400 }
      );
    }

    // Create new transport + MCP server
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = createBridgeMcpServer(wsManager);
    await server.connect(transport);

    // Track the session once initialized
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        mcpTransports.delete(sid);
        console.log(`[MCP] Session closed: ${sid}`);
      }
    };

    // Handle the request (this will set transport.sessionId)
    const resp = await transport.handleRequest(req, { parsedBody: body });

    if (transport.sessionId) {
      mcpTransports.set(transport.sessionId, transport);
      console.log(`[MCP] New session: ${transport.sessionId}`);
    }

    return addCorsHeaders(resp);
  }

  // GET without session (SSE stream) or DELETE without session
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message: 'Bad request: no valid session' }, id: null },
    { status: 400 }
  );
}

/** Add CORS headers to MCP responses */
function addCorsHeaders(resp: Response): Response {
  const headers = new Headers(resp.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'mcp-session-id');
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

// --- Start the server ---
const server = Bun.serve({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      return undefined as any;
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id',
          'Access-Control-Expose-Headers': 'mcp-session-id',
        },
      });
    }

    // MCP endpoint
    if (url.pathname === '/mcp') {
      return handleMcpRequest(req);
    }

    // REST API endpoints
    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(req, wsManager);
    }

    // Health check
    if (url.pathname === '/') {
      return Response.json({
        name: 'suno-api-bridge',
        version: '1.0.0',
        extension: wsManager.isConnected ? 'connected' : 'disconnected',
        endpoints: {
          ws: '/ws',
          api: '/api/*',
          mcp: '/mcp',
          status: '/api/status',
        },
      });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },

  websocket: {
    open(ws) {
      wsManager.addSocket(ws);
    },
    message(ws, message) {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
      wsManager.handleMessage(ws, data);
    },
    close(ws) {
      wsManager.removeSocket(ws);
    },
  },
});

console.log(`
╔══════════════════════════════════════════════╗
║         Suno API Bridge Server               ║
╠══════════════════════════════════════════════╣
║  REST API:  http://localhost:${PORT}/api/*       ║
║  WebSocket: ws://localhost:${PORT}/ws            ║
║  MCP:       http://localhost:${PORT}/mcp         ║
║  Status:    http://localhost:${PORT}/api/status   ║
╚══════════════════════════════════════════════╝

Waiting for Chrome extension to connect...
`);
