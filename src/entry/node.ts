#!/usr/bin/env node
// Node stdio entry — the offline/air-gapped fallback and the local test target.
// The primary deployment is the Cloudflare Worker (entry/worker.ts, added at M2).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "../tools/index.js";

const server = new McpServer({
  name: "natural-docs-mcp",
  version: "0.1.0",
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
