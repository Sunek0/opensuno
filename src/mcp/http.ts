#!/usr/bin/env node

/**
 * Suno MCP Server — Streamable HTTP transport
 *
 * For cloud or remote deployment, accessible over HTTP.
 *
 * Usage:
 *   node dist/mcp/http.js
 *   # or via bun:
 *   bun run mcp:http
 *
 * Environment variables:
 *   MCP_PORT  - Port to listen on (default: 3001)
 */

import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSunoMcpServer } from "./server.js";

const PORT = parseInt(process.env.MCP_PORT || "3001", 10);

async function main() {
  if (!process.env.SUNO_COOKIE) {
    console.error(
      "Error: SUNO_COOKIE environment variable is not set.\n" +
        "Set it in your .env file before starting the server."
    );
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  // Map of active transports by session ID
  const transports = new Map<string, StreamableHTTPServerTransport>();

  // Handle MCP requests (POST /mcp)
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New session
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      const server = createSunoMcpServer();
      await server.connect(transport);
      // Store transport by session ID after connection
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) transports.delete(sid);
      };
      if (transport.sessionId) {
        transports.set(transport.sessionId, transport);
      }
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad request: no valid session" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  // Handle SSE streams (GET /mcp)
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad request: no valid session" },
        id: null,
      });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  // Handle session termination (DELETE /mcp)
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.close();
      transports.delete(sessionId);
      res.status(200).json({ ok: true });
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  });

  app.listen(PORT, () => {
    console.log(`Suno MCP server (Streamable HTTP) listening on http://localhost:${PORT}/mcp`);
    console.log("Clients can connect using the Streamable HTTP transport.");
  });
}

function isInitializeRequest(body: any): boolean {
  if (Array.isArray(body)) {
    return body.some((msg) => msg.method === "initialize");
  }
  return body?.method === "initialize";
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
