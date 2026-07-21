// Register the shared tool registry on an McpServer (used by the Node/stdio entry).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOLS } from "./registry.js";

export function registerTools(server: McpServer): void {
  for (const t of TOOLS) {
    server.tool(t.name, t.description, t.shape, (args: Record<string, unknown>) =>
      t.handler(args),
    );
  }
}
