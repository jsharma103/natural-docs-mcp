// Transport-agnostic tool registry. Each tool carries its zod shape (arg parsing +
// defaults), a JSON Schema (advertised via tools/list), and a handler. Both entries
// consume this: the Node/stdio entry registers each on an McpServer; the Worker
// entry serves them over stateless Streamable HTTP. Nothing here is platform-bound.

import { z } from "zod";
import { parseIndex } from "../core/llms.js";
import { searchDocs, getCorpusPage } from "../core/search.js";
import { fetchText, HttpError } from "../core/cache.js";
import { queryOps, getOperation } from "../core/openapi.js";

const DOCS_BASE = "https://docs.natural.com";
const READ_CAP = 40_000;
// Compact (unindented) endpoint detail runs ~7-12KB across Natural's operations;
// 14000 fits every one with headroom, so the cap only guards pathological cases.
const DETAIL_CAP = 14_000;

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  // MCP CallToolResult carries an open index signature; mirror it so handlers
  // satisfy the SDK's server.tool() callback type.
  [key: string]: unknown;
}

export interface ToolDef {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  jsonSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

function text(obj: unknown): ToolResult {
  const body = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text: body }] };
}

function errText(e: unknown): ToolResult {
  const msg =
    e instanceof HttpError
      ? `Natural docs unreachable (HTTP ${e.status}) for ${e.url}. Retry shortly.`
      : `Natural docs unreachable: ${(e as Error).message}. Retry shortly.`;
  return { content: [{ type: "text", text: msg }], isError: true };
}

export const TOOLS: ToolDef[] = [
  {
    name: "list_docs",
    description:
      "List Natural documentation sections and pages (title, slug, one-line description). No input. Use as a table of contents before read_doc.",
    shape: {},
    jsonSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => {
      try {
        return text({ sections: await parseIndex() });
      } catch (e) {
        return errText(e);
      }
    },
  },
  {
    name: "search_docs",
    description:
      "Full-text search across Natural docs; returns ranked pages with title, slug, and a snippet. Use to find which page covers a topic.",
    shape: {
      query: z.string().describe("Search terms."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Max results, default 5, max 10."),
    },
    jsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms." },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          default: 5,
          description: "Max results, default 5, max 10.",
        },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const query = args.query as string;
      const limit = (args.limit as number) ?? 5;
      try {
        return text({ query, hits: await searchDocs(query, limit) });
      } catch (e) {
        return errText(e);
      }
    },
  },
  {
    name: "read_doc",
    description:
      'Fetch one Natural documentation page as markdown by slug (e.g. "guides/concepts/payments") or full docs URL. Truncated at 40000 chars.',
    shape: {
      page: z.string().describe("Doc slug or full docs.natural.com URL."),
    },
    jsonSchema: {
      type: "object",
      properties: {
        page: {
          type: "string",
          description: "Doc slug or full docs.natural.com URL.",
        },
      },
      required: ["page"],
    },
    handler: async (args) => {
      const page = args.page as string;
      const slug = page
        .replace(/^https?:\/\/docs\.natural\.com\//, "")
        .replace(/\.md$/, "")
        .replace(/^\/+|\/+$/g, "");
      try {
        let md: string;
        try {
          md = await fetchText(`${DOCS_BASE}/${slug}.md`);
        } catch {
          const p = await getCorpusPage(slug);
          if (!p) throw new Error(`no page for slug "${slug}"`);
          md = `# ${p.title}\n\n${p.body}`;
        }
        const capped =
          md.length > READ_CAP ? md.slice(0, READ_CAP) + "\n\n[truncated]" : md;
        return text(capped);
      } catch (e) {
        return errText(e);
      }
    },
  },
  {
    name: "lookup_endpoint",
    description:
      'Look up Natural REST API endpoints from the OpenAPI spec. Query by path fragment, "METHOD /path", or keyword. detail=true on a single match returns the pruned operation: parameters, request body, and a representative subset of responses (primary 2xx plus one error; examples stripped, $refs resolved one level, other response codes listed under x-omitted-response-codes).',
    shape: {
      query: z
        .string()
        .describe('Path fragment, "POST /payments", or operation keyword.'),
      detail: z
        .boolean()
        .default(false)
        .describe("Return full pruned schema for a single match."),
    },
    jsonSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Path fragment, "POST /payments", or operation keyword.',
        },
        detail: {
          type: "boolean",
          default: false,
          description: "Return full pruned schema for a single match.",
        },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const query = args.query as string;
      const detail = (args.detail as boolean) ?? false;
      try {
        const matches = await queryOps(query);
        if (matches.length === 0) return text({ query, matches: [] });

        if (detail && matches.length === 1) {
          const m = matches[0];
          const op = await getOperation(m.method, m.path);
          let s = JSON.stringify(op);
          if (s.length > DETAIL_CAP)
            s = s.slice(0, DETAIL_CAP) + "… [truncated]";
          return text(s);
        }

        return text({
          query,
          count: matches.length,
          matches: matches.map((m) => ({
            method: m.method,
            path: m.path,
            operationId: m.operationId,
            summary: m.summary,
          })),
        });
      } catch (e) {
        return errText(e);
      }
    },
  },
];
