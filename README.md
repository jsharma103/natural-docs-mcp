# natural-docs-mcp

**Search, read, and look up [Natural](https://natural.com) API documentation from your AI agent.**

> **Unofficial.** Not affiliated with, endorsed by, or operated by Natural AI, Inc.
> A community companion to Natural's official [operational MCP](https://mcp.natural.com).
> It reads Natural's own published docs — it moves no money and needs no credentials.

Live endpoint: `https://natural-docs-mcp.jsharma103.workers.dev/mcp`

---

## Why

Natural's official MCP server exposes 24 operational tools (payments, wallets, agents,
transfers) but no way to **read the docs**. An agent mid-integration ends up fetching raw
`llms.txt` over HTTP — which fails on hosts without web access, burns context on full-page
dumps, and offers no ranked search.

This server adds the missing documentation surface: four read-only tools, one hosted URL,
nothing to install. Docs are fetched live from `docs.natural.com` (cached 15 min), so
answers are never stale and no snapshot is redistributed.

## Tools

| Tool | Answers | Notes |
|---|---|---|
| `list_docs` | "What docs exist?" | Sections → pages, a table of contents (~2KB) |
| `search_docs` | "Which page covers X?" | BM25 ranking, returns snippets not full pages |
| `read_doc` | "Give me that page." | Fetches a page as markdown by slug or URL |
| `lookup_endpoint` | "Exact shape of this endpoint?" | OpenAPI lookup; `detail=true` returns pruned parameter/request/response schemas |

## Install

No install, no auth — add one URL as a custom MCP server.

### Claude Code

```bash
claude mcp add --transport http natural-docs https://natural-docs-mcp.jsharma103.workers.dev/mcp --scope user
```

Then `/mcp` to confirm `natural-docs` is connected. Try: *"Search the Natural docs for idempotency."*

### Claude (claude.ai / Desktop)

Sidebar → **Customize** → **Connectors** → **Add custom connector**. Name `Natural Docs`,
URL `https://natural-docs-mcp.jsharma103.workers.dev/mcp`.

### Cursor

**Settings → Tools & MCPs → New MCP Server**, then merge:

```json
{
  "mcpServers": {
    "natural-docs": { "url": "https://natural-docs-mcp.jsharma103.workers.dev/mcp" }
  }
}
```

## How it works

Three published, machine-readable sources are fetched at runtime and cached in-isolate:

- `docs.natural.com/llms.txt` — the section/page index (`list_docs`)
- `docs.natural.com/llms-full.txt` — the full corpus, 164 pages, chunked per page and
  indexed with [minisearch](https://github.com/lucaong/minisearch) BM25 (`search_docs`)
- `docs.natural.com/api-reference/openapi.json` — lazily parsed into an operations index;
  a single operation is pruned on demand — examples stripped, `$ref`s resolved one level
  (`lookup_endpoint`)

No database, no vector store, no embeddings, no persistence. Just their own artifacts,
indexed in memory.

## Architecture

Layered so the documentation logic is portable, not welded to the host:

```
src/
  core/    parsing + search + OpenAPI pruning — platform-free (web-standard fetch only)
  tools/   the four tools as a transport-agnostic registry (zod shape + JSON Schema + handler)
  entry/
    worker.ts   Cloudflare Worker — stateless Streamable HTTP MCP (the live deployment)
    node.ts     stdio + official MCP SDK — offline/local fallback and test target
```

`core/` and `tools/` carry no platform dependency; the entry files are thin adapters. The
Worker is stateless (no Durable Objects, no sessions) — each POST carries one JSON-RPC
message, handled inline.

## Develop

```bash
npm install
npm run build     # tsc -> dist/ (noEmitOnError gate)
npm run smoke     # spawn the stdio server, exercise all 4 tools + golden queries
npm start         # run the stdio server locally

npx wrangler dev      # run the Worker locally
npx wrangler deploy   # deploy the Worker
```

`npm run smoke` is the CI gate: it calls every tool and requires each golden integration
query (idempotency, payment requests, vault, limits, errors) to surface the right page in
the top 3.

See [docs/EXAMPLES.md](./docs/EXAMPLES.md) for real request/response transcripts.

## Limitations

- `lookup_endpoint` detail returns a representative subset of responses (primary 2xx +
  one error); other codes are listed under `x-omitted-response-codes`. Output is compact
  JSON capped at 14000 chars — enough for every current Natural operation.
- First request after a cold start or cache expiry re-fetches the corpus/spec.

## License

[MIT](./LICENSE) © 2026 Jay Sharma. "Natural" and related marks belong to Natural AI, Inc.
