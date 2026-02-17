#!/usr/bin/env node

/**
 * Suno MCP Server — stdio transport
 *
 * For local use with Claude Desktop, Cursor, or other MCP clients.
 *
 * Usage:
 *   node dist/mcp/stdio.js
 *   # or via bun:
 *   bun run mcp:stdio
 */

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSunoMcpServer } from "./server.js";

async function main() {
  if (!process.env.SUNO_COOKIE) {
    console.error(
      "Error: SUNO_COOKIE environment variable is not set.\n" +
        "Set it in your .env file or pass it via the MCP client config.\n" +
        "See README.md for instructions on how to obtain the cookie."
    );
    process.exit(1);
  }

  const server = createSunoMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Suno MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
