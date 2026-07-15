#!/usr/bin/env node
/**
 * Minimal stdio MCP server for Coding Agent smoke tests.
 *
 * Tools:
 *   - echo: { text: string } → "echo:<text>"
 *   - ping: {} → "pong"
 *
 * Usage (stdio MCP client):
 *   node scripts/mcp-echo-fixture.mjs
 *
 * Connection JSON example:
 *   {
 *     "type": "mcp",
 *     "description": "Demo echo MCP",
 *     "command": "node",
 *     "args": ["/abs/path/to/mcp-echo-fixture.mjs"],
 *     "transport": "stdio",
 *     "enabled": true
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer(
  { name: "maou-echo-fixture", version: "1.0.0" },
  { capabilities: {} },
);

server.registerTool(
  "echo",
  {
    description: "Echo back the given text (MCP smoke fixture)",
    inputSchema: {
      text: z.string().describe("Text to echo"),
    },
  },
  async ({ text }) => ({
    content: [{ type: "text", text: `echo:${text}` }],
  }),
);

server.registerTool(
  "ping",
  {
    description: "Health check — returns pong",
  },
  async () => ({
    content: [{ type: "text", text: "pong" }],
  }),
);

server.registerResource(
  "smoke-note",
  "fixture://smoke-note",
  {
    description: "Fixture resource for smoke tests",
    mimeType: "text/plain",
  },
  async (uri) => ({
    contents: [
      {
        uri: String(uri.href ?? uri),
        mimeType: "text/plain",
        text: "smoke-resource-ok",
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
