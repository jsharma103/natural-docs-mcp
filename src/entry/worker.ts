// Cloudflare Worker entry — stateless Streamable HTTP MCP endpoint at POST /mcp.
// No Durable Objects, no session state: each POST carries one (or a batch of)
// JSON-RPC message(s), handled and answered inline. Tiny bundle (zod + minisearch
// + core), free-tier friendly, mirrors Natural's own hosted-URL topology.

import { z } from "zod";
import { TOOLS } from "../tools/registry.js";

const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const SERVER_INFO = { name: "natural-docs-mcp", version: "0.1.0" };
const byName = new Map(TOOLS.map((t) => [t.name, t]));

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, accept",
};

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function reply(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleRpc(msg: RpcMessage): Promise<object | null> {
  const { id, method, params } = msg;

  // JSON-RPC: a message without an id is a notification — never answered.
  if (id === undefined || method?.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize": {
      // Echo the client's version if supported, else offer our latest.
      const requested = params?.protocolVersion as string | undefined;
      return reply(id, {
        protocolVersion:
          requested && SUPPORTED_VERSIONS.has(requested)
            ? requested
            : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.jsonSchema,
        })),
      });

    case "tools/call": {
      const name = params?.name as string;
      const tool = byName.get(name);
      if (!tool) return rpcError(id, -32602, `unknown tool: ${name}`);
      let args: Record<string, unknown>;
      try {
        args = z.object(tool.shape).parse(params?.arguments ?? {});
      } catch (e) {
        return rpcError(id, -32602, `invalid arguments: ${(e as Error).message}`);
      }
      const result = await tool.handler(args);
      return reply(id, result);
    }

    default:
      return rpcError(id, -32601, `method not found: ${method}`);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/mcp")) {
      // Streamable HTTP: a GET asking for an SSE stream must get SSE or 405.
      if ((request.headers.get("accept") ?? "").includes("text/event-stream")) {
        return new Response("SSE not supported; POST JSON-RPC to /mcp", {
          status: 405,
          headers: CORS,
        });
      }
      return new Response(
        "natural-docs-mcp (unofficial). MCP endpoint: POST /mcp. " +
          "Not affiliated with Natural AI, Inc.",
        { status: 200, headers: { "content-type": "text/plain", ...CORS } },
      );
    }

    if (url.pathname !== "/mcp" && url.pathname !== "/") {
      return new Response("not found", { status: 404, headers: CORS });
    }

    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405, headers: CORS });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(rpcError(null, -32700, "parse error"), 400);
    }

    const batch = Array.isArray(body);
    const messages = (batch ? body : [body]) as RpcMessage[];
    const responses: object[] = [];
    for (const m of messages) {
      const r = await handleRpc(m);
      if (r) responses.push(r);
    }

    // All-notifications batch → 202 with no body.
    if (responses.length === 0) {
      return new Response(null, { status: 202, headers: CORS });
    }
    return jsonResponse(batch ? responses : responses[0]);
  },
};
