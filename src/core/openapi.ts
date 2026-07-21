// Lazy-load the Natural OpenAPI spec (~6.8MB) on first use, build a lightweight
// operations index, and prune a single operation on demand: examples stripped,
// $refs resolved one level so the schema is self-contained but not infinitely deep.

import { evict, fetchJson, TTL_MS } from "./cache.js";

const SPEC_URL = "https://docs.natural.com/api-reference/openapi.json";
const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

interface Spec {
  paths: Record<string, Record<string, unknown>>;
  components?: unknown;
}

export interface OpSummary {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  tags?: string[];
}

let spec: Spec | null = null;
let ops: OpSummary[] | null = null;
let builtAt = 0;

async function ensure(): Promise<void> {
  if (spec && ops && Date.now() - builtAt < TTL_MS) return;
  spec = await fetchJson<Spec>(SPEC_URL);
  // The parsed spec is retained (getOperation and resolveRef need paths +
  // components); evict the ~6.8MB raw string so it isn't held twice.
  evict(SPEC_URL);
  builtAt = Date.now();
  ops = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = (item as Record<string, any>)[method];
      if (op && typeof op === "object") {
        ops.push({
          method: method.toUpperCase(),
          path,
          operationId: op.operationId,
          summary: op.summary,
          tags: op.tags,
        });
      }
    }
  }
}

export async function queryOps(q: string): Promise<OpSummary[]> {
  await ensure();
  const s = q.toLowerCase();
  // Exact matches win: substring matching alone makes prefixes like
  // "customers.list" ambiguous with "customers.listInvitations", so an exact
  // operationId / "METHOD /path" / path query would otherwise never reach
  // detail mode.
  const exact = ops!.filter(
    (o) =>
      (o.operationId ?? "").toLowerCase() === s ||
      `${o.method} ${o.path}`.toLowerCase() === s ||
      o.path.toLowerCase() === s,
  );
  if (exact.length > 0) return exact;
  return ops!.filter(
    (o) =>
      o.path.toLowerCase().includes(s) ||
      (o.operationId ?? "").toLowerCase().includes(s) ||
      (o.summary ?? "").toLowerCase().includes(s) ||
      `${o.method} ${o.path}`.toLowerCase().includes(s),
  );
}

export async function getOperation(
  method: string,
  path: string,
): Promise<Record<string, unknown> | null> {
  await ensure();
  const op = (spec!.paths[path]?.[method.toLowerCase()] ?? null) as Record<
    string,
    unknown
  > | null;
  if (!op) return null;

  const picked = {
    operationId: op.operationId,
    summary: op.summary,
    tags: op.tags,
    parameters: op.parameters,
    requestBody: op.requestBody,
    responses: trimResponses(op.responses),
  };
  const pruned = prune(picked, 0) as Record<string, unknown>;
  return { method: method.toUpperCase(), path, ...pruned };
}

// Natural operations enumerate ~13 response codes; serializing them all blows the
// output cap and buries the useful parts. Keep the primary success (first 2xx) and
// one representative error (prefer a 4xx, else any non-2xx), and record the rest as
// an explicit note so nothing is silently dropped.
function trimResponses(responses: unknown): unknown {
  if (!responses || typeof responses !== "object") return responses;
  const all = responses as Record<string, unknown>;
  const codes = Object.keys(all);

  const success = codes.find((c) => /^2\d\d$/.test(c));
  const clientErr = codes.find((c) => /^4\d\d$/.test(c));
  const anyErr = codes.find((c) => !/^2\d\d$/.test(c));
  const keep = [success, clientErr ?? anyErr].filter(
    (c): c is string => Boolean(c),
  );

  const out: Record<string, unknown> = {};
  for (const c of keep) out[c] = all[c];

  const omitted = codes.filter((c) => !keep.includes(c));
  if (omitted.length > 0) {
    out["x-omitted-response-codes"] = omitted.join(", ");
  }
  return out;
}

function resolveRef(ref: string): unknown {
  const parts = ref.replace(/^#\//, "").split("/");
  let cur: any = spec;
  for (const p of parts) {
    cur = cur?.[p];
    if (cur === undefined) return { $ref: ref };
  }
  return cur;
}

// Depth increments only when a $ref is resolved, so a ref resolves exactly one
// level; refs nested inside the resolved node are left as `{ $ref }`.
function prune(node: unknown, depth: number): unknown {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((n) => prune(n, depth));

  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === "string" && depth < 1) {
    return prune(resolveRef(obj.$ref), depth + 1);
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "example" || k === "examples") continue;
    out[k] = prune(v, depth);
  }
  return out;
}
