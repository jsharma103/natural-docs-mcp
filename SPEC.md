# natural-docs-mcp — Spec (remote-first)

Unofficial, hosted MCP server that gives AI agents in-band access to Natural's
(natural.com) documentation: browse, search, read pages, and look up API endpoints.
Agents add one URL — nothing runs on the user's machine.

**Status**: spec, approved for build. Not affiliated with Natural AI, Inc.

---

## 1. Problem

Natural's official hosted MCP (`mcp.natural.com`) exposes 24 operational tools (payments,
wallets, agents, transfers) but **no documentation tools**. An agent integrating Natural
must fetch `docs.natural.com/llms.txt` over raw HTTP — fails on hosts without web access,
burns context on full-page fetches, gives no ranked search. Agents end up guessing API
shapes or dumping the 341KB corpus into context.

## 2. Goal

A hosted, remote MCP server (single public URL, streamable-HTTP — mirrors Natural's own
topology) with four read-only tools answering the questions an agent asks mid-integration:

1. "What docs exist?" — `list_docs`
2. "Which page covers X?" — `search_docs`
3. "Give me that page." — `read_doc`
4. "Exact request/response shape for this endpoint?" — `lookup_endpoint`

Always fresh (fetches Natural's published artifacts live, cached), tiny context footprint
(ranked snippets, pruned schemas, hard caps). **No install, no auth, no local process.**

## 3. Non-goals

- No write operations, no auth, no API keys, no OAuth — documentation is public.
- No scraping beyond Natural's published machine-readable endpoints.
- No bundled docs snapshot in the deploy (staleness risk; fetched live + cached).
- Not a replacement for the official operational MCP — a companion.

## 4. Data sources (all public, fetched at runtime) — VERIFIED 2026-07-21

| Source | URL | Size | Use |
|---|---|---|---|
| Docs index | `docs.natural.com/llms.txt` | ~8.7KB | `list_docs` (parse **tail index sections only**, see note) |
| Full corpus | `docs.natural.com/llms-full.txt` | ~341KB (341,131 B) | search index; `read_doc` fallback |
| OpenAPI spec | `docs.natural.com/api-reference/openapi.json` | ~6.8MB (6,785,185 B) | `lookup_endpoint` |
| Raw page markdown | `docs.natural.com/<path>.md` (Mintlify) | per page | `read_doc` primary |

**Corpus structure (verified):** `llms-full.txt` = **164 pages**, each delimited by a
`Source: https://docs.natural.com/<path>` line under a `# <Title>` heading. Chunk on
`Source:` lines, not `#` (headings also appear inside pages).

**llms.txt caveat (verified):** the file is mostly an *agent-onboarding playbook* written
as imperatives to the reading agent ("install the MCP server yourself...", "tell the user
to approve..."). Only the tail (`## Surfaces`, `## Common use cases`, `## Products`,
`## Guides`, `## API reference`, `## Concepts`) is a real link index. `list_docs` parses
those tail sections and **ignores the playbook prose**. (Security note on the playbook
tracked separately in `../natural-trust-audit/BACKLOG.md`; out of scope here.)

## 5. Tools (all 4 ship in v0.1)

### 5.1 `list_docs`
- **Input**: none.
- **Behavior**: parse `llms.txt` tail sections → section → pages (title, slug, one-line
  description). Fall back to deriving the list from `llms-full.txt` `Source:` lines if the
  index shape drifts.
- **Output**: compact tree, ~2KB. Agent's table of contents.

### 5.2 `search_docs`
- **Input**: `query` (string, required), `limit` (int, default 5, max 10).
- **Behavior**: BM25 (minisearch, pure JS, Workers-compatible) over the 164 page chunks of
  `llms-full.txt`; title matches boosted; prefix + light fuzzy on.
- **Output**: per hit — title, slug, section, snippet (±200 chars around best match),
  score. No full pages.

### 5.3 `read_doc`
- **Input**: `page` (slug like `guides/concepts/payments`, or a full docs URL).
- **Behavior**: fetch `docs.natural.com/<slug>.md`. On non-200, fall back to the stored
  chunk from `llms-full.txt`.
- **Output**: page markdown. Truncate at 40k chars with an explicit `[truncated]` marker.

### 5.4 `lookup_endpoint`
- **Input**: `query` (path fragment, method+path, or operation keyword), `detail` (bool,
  default false).
- **Behavior**: lazy-load + parse OpenAPI once per isolate; build an operations index
  (method, path, operationId, summary, tags). Match query against path + operationId/
  summary.
  - Multiple matches or `detail=false` → operation list only.
  - Single match + `detail=true` → pruned operation: parameters, request body schema,
    response schemas; `example`/`examples` nodes dropped; `$ref`s resolved one level;
    output capped at 8k chars.
- **Output**: JSON, pruned as above.

## 6. Architecture — remote-first, adoptable-as-PR

Layered so Natural's team could lift `core/` + `tools/` into `mcp.natural.com` as a PR and
delete only the hosting glue.

```
src/
  core/            pure, platform-free (web-standard fetch only)
    llms.ts          parse llms.txt tail index
    corpus.ts        fetch + chunk llms-full.txt into 164 pages
    search.ts        build/query minisearch BM25 index
    openapi.ts       lazy-load spec, build ops index, prune operation
    cache.ts         per-URL in-memory cache, 15-min TTL
  tools/           MCP tool defs (zod schema + handler) — THE PR SURFACE
    listDocs.ts  searchDocs.ts  readDoc.ts  lookupEndpoint.ts
    index.ts       registers all 4 on an McpServer
  entry/
    worker.ts        Cloudflare Worker: streamable-HTTP MCP  (PRIMARY, v0.1)
    node.ts          stdio + official SDK   (fallback: offline/air-gapped)
```

- **Runtime**: Cloudflare Workers (free tier, edge-cached — mirrors their CloudFront).
- **Transport**: streamable-HTTP (same shape Natural serves). Public URL, no auth.
- **MCP**: official `@modelcontextprotocol/sdk`; tools carry Natural's house conventions
  (snake_case names, optional `traceId`, terse descriptions stating defaults+caps, JSON
  envelopes, no emojis).
- **Caching**: per-URL in-memory (isolate-global) 15-min TTL. Search + OpenAPI indexes
  built lazily on first use, rebuilt only when the underlying fetch refreshes.
- **OpenAPI 6.8MB in a Worker**: fetch + parse on first `lookup_endpoint`, hold the ops
  index (not the raw spec) in isolate memory; well under the 128MB isolate limit.
- **No persistence, no DB, no vector store, no embeddings.** In-memory BM25 over their own
  published artifacts — zero new infra for anyone who adopts it.
- **Errors**: network failure → tool returns a clear "docs unreachable, retry" message,
  never crashes the isolate; non-200 → surfaced with status code.

## 7. Packaging & distribution (v0.1: GitHub + Cloudflare only)

Mirror `naturalpay/agent-plugins` layout so install UX matches the official plugin.

```
natural-docs-mcp/
  src/                (as above)
  scripts/smoke.mjs   spawn/curl the server, call all 4 tools, assert shapes
  wrangler.toml       Cloudflare Worker config
  .claude-plugin/
    plugin.json         name: natural-docs, mcpServers → ./.mcp.json (remote URL)
    marketplace.json    single-plugin marketplace, source "./"
  .mcp.json           { type: http, url: https://<sub>.workers.dev }
  package.json        build + smoke scripts
  README.md           UNOFFICIAL disclaimer up top; add-one-URL install (all hosts)
  SPEC.md  LICENSE(MIT)
```

Install (v0.1): add one URL — `https://<sub>.workers.dev` — as a custom MCP connector in
Claude / Cursor / Codex, same two-field flow as Natural's own. `/plugin marketplace add
jsharma103/natural-docs-mcp` as the Claude-Code path.

**Deferred (post-proof):** npm publish; custom domain; PR adding the plugin to
`naturalpay/agent-plugins`; Codex/Cursor marketplace listings.

## 8. Quality bar

- **Smoke test** (`scripts/smoke.mjs`): hit the deployed Worker over MCP, call all four
  tools, assert non-empty sane shapes. CI on push (GitHub Actions).
- **Golden queries**: 10 real integration questions (idempotency keys, create-payment-
  request shape, wallet vs vault, per-agent limits, claim links, ...) — `search_docs` must
  surface the right page in top 3; asserted by the smoke script.
- **README demo**: 30-sec GIF — agent answers an integration question via the tools.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Docs URLs/structure change | All parsing isolated in `core/`; smoke test catches drift fast; `list_docs` falls back to `Source:`-line derivation |
| 6.8MB OpenAPI fetch latency | Lazy on first `lookup_endpoint`; ops index cached for isolate life |
| Trademark/branding | "Unofficial" in name + description, README disclaimer, no logo use |
| Rate-limiting docs host | 15-min TTL cache; ≤3 fetches/15min/source |
| Worker cold-start re-fetch | Acceptable at v0.1; KV-cache the parsed indexes later if needed |

## 10. Milestones

- **M1 — server**: 4 tools working locally (node entry), smoke green. (~half day)
- **M2 — deploy**: Worker entry, `wrangler deploy`, live `*.workers.dev` URL, smoke
  against the deployed URL.
- **M3 — packaging**: plugin manifests, README (disclaimer + install), MIT, GitHub repo.
- **M4 — polish**: golden queries, CI, demo GIF.
- **M5 — optional/deferred**: npm publish; PR to their marketplace; founders follow-up.

## 11. Resolved decisions

- Host: **Cloudflare Workers**, free tier. ✔
- URL: **`*.workers.dev`** for v0.1; custom domain deferred. ✔
- Tools: **all 4 in v0.1**. ✔
- Distribution: **GitHub + Cloudflare only** v0.1; npm + marketplace PR deferred. ✔
- Search: minisearch (pure-JS BM25). ✔  Cache: 15-min TTL. ✔  OpenAPI: lazy. ✔
- 5th `get_skill_md` tool: **skipped** — keep surface minimal; `read_doc` covers ad-hoc.

## 12. Open prerequisite (not code)

- **Cloudflare account** needed at M2 (`wrangler login`, run by the human — I can't).
  If none: alternatives are Deno Deploy or Val Town (both free, same remote shape).
  M1 needs no account — builds + tests locally via the node entry.
