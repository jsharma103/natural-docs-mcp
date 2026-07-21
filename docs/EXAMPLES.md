# Examples

Real requests and responses from the live server
(`https://natural-docs-mcp.jsharma103.workers.dev/mcp`). Each block is a JSON-RPC
`tools/call`; responses are trimmed for length but otherwise verbatim.

## list_docs — table of contents

```jsonc
// → tools/call { "name": "list_docs", "arguments": {} }
{
  "sections": [
    {
      "section": "The one page to read",
      "pages": [
        {
          "title": "Start here",
          "slug": "guides/overview/start-here",
          "url": "https://docs.natural.com/guides/overview/start-here",
          "description": "canonical integration decision rule"
        }
      ]
    }
    // ... 12 more sections (Surfaces, Products, Agents, Wallets, ...)
  ]
}
```

## search_docs — find the right page

```jsonc
// → tools/call { "name": "search_docs",
//                "arguments": { "query": "how do idempotency keys work", "limit": 2 } }
{
  "query": "how do idempotency keys work",
  "hits": [
    {
      "title": "Idempotency",
      "slug": "api-reference/idempotency",
      "url": "https://docs.natural.com/api-reference/idempotency",
      "score": 217.174,
      "snippet": "Ensuring safety when retrying a mutation Idempotency ensures retries are safe for mutating requests. Retrying the same request with the same `Idempotency-Key` never executes side effects twice. ## How it works Include an `Idempotency-Key`…"
    },
    {
      "title": "Manage your agents",
      "slug": "guides/agents/manage-agents",
      "score": 100.979,
      "snippet": "List…"
    }
  ]
}
```

## read_doc — fetch a page as markdown

```jsonc
// → tools/call { "name": "read_doc", "arguments": { "page": "guides/concepts/payments" } }
// Returns the page markdown (truncated at 40000 chars). Accepts a slug or a full
// docs.natural.com URL; falls back to the corpus copy if the .md fetch 404s.
```

## lookup_endpoint — list mode

```jsonc
// → tools/call { "name": "lookup_endpoint", "arguments": { "query": "payment request" } }
{
  "query": "payment request",
  "count": 7,
  "matches": [
    { "method": "GET",  "path": "/payment-requests", "operationId": "paymentRequests.list",   "summary": "List payment requests" },
    { "method": "POST", "path": "/payment-requests", "operationId": "paymentRequests.create", "summary": "Create payment request" },
    { "method": "GET",  "path": "/payment-requests/incoming", "operationId": "paymentRequests.listIncoming", "summary": "List incoming payment requests" }
    // ... 4 more
  ]
}
```

## lookup_endpoint — detail mode

A unique-match query (e.g. an `operationId`) with `detail: true` returns the pruned
operation: parameters, request body, and a representative subset of responses (primary
2xx + one error), with `example` nodes stripped and `$ref`s resolved one level. Other
response codes are listed under `x-omitted-response-codes` so nothing is silently hidden.

```jsonc
// → tools/call { "name": "lookup_endpoint",
//                "arguments": { "query": "payments.create", "detail": true } }
{
  "method": "POST",
  "path": "/payments",
  "operationId": "payments.create",
  "summary": "Create payment",
  "tags": ["Payments"],
  "parameters": [
    {
      "name": "Idempotency-Key",
      "in": "header",
      "required": true,
      "schema": { "type": "string", "maxLength": 255 },
      "description": "Unique key for safely retrying a request without creating duplicates."
    }
    // X-Agent-ID, X-Instance-ID ...
  ],
  "requestBody": { /* amount, currency, recipient (anyOf), description, ... */ },
  "responses": {
    "201": { /* Payment */ },
    "400": { /* error */ },
    "x-omitted-response-codes": "401, 403, 404, 409, 422, 428, 429, 500, 501, 502, 503"
  }
}
```

## Raw curl

```bash
curl -s -X POST https://natural-docs-mcp.jsharma103.workers.dev/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"search_docs","arguments":{"query":"vault","limit":3}}}'
```
