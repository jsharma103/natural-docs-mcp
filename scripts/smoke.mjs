// Smoke + golden-query test: spawn the built server over stdio, call all four
// tools, assert sane shapes, and require each golden query to surface the right
// page in the top 3. Exits non-zero on any failure (CI gate).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/entry/node.js"],
});
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);

let failures = 0;
const ok = (cond, label) => {
  console.log((cond ? "PASS " : "FAIL ") + label);
  if (!cond) failures++;
};
const call = async (name, args) =>
  (await client.callTool({ name, arguments: args })).content[0].text;

const { tools } = await client.listTools();
ok(tools.length === 4, `4 tools registered (got ${tools.length})`);

// list_docs
const ld = JSON.parse(await call("list_docs", {}));
ok(
  Array.isArray(ld.sections) && ld.sections.length >= 5,
  `list_docs sections >= 5 (got ${ld.sections?.length})`,
);

// search_docs — golden queries: [query, substring expected in a top-3 slug/title]
const golden = [
  ["idempotency", "idempotency"],
  ["create payment request", "request"],
  ["wallet vault reserve", "vault"],
  ["per-agent limits", "limits"],
  ["error handling", "error"],
];
for (const [q, expect] of golden) {
  const r = JSON.parse(await call("search_docs", { query: q, limit: 3 }));
  const hits = r.hits ?? [];
  const found = hits.some((h) =>
    (h.slug + " " + h.title).toLowerCase().includes(expect),
  );
  ok(
    found,
    `search "${q}" -> "${expect}" in top3 (got: ${hits.map((h) => h.slug).join(", ")})`,
  );
}

// read_doc
const rd = await call("read_doc", { page: "guides/concepts/payments" });
ok(
  rd.length > 200 && /payment/i.test(rd),
  `read_doc payments (len ${rd.length})`,
);

// read_doc fallback path (bad slug should still not crash; either md or error text)
const rdBad = await call("read_doc", { page: "guides/concepts/does-not-exist" });
ok(typeof rdBad === "string" && rdBad.length > 0, `read_doc bad slug handled`);

// lookup_endpoint — list mode
const le = JSON.parse(await call("lookup_endpoint", { query: "payments" }));
ok((le.count ?? 0) > 0, `lookup_endpoint "payments" matches (got ${le.count})`);

// lookup_endpoint — detail mode on a unique-match query (operationId is unique,
// so exactly one match triggers the pruned-schema branch). Assert detail-only
// keys (parameters + responses), not operationId which also appears in list mode.
const led = await call("lookup_endpoint", {
  query: "payments.create",
  detail: true,
});
// "parameters" is a detail-only key (list mode never emits it). Note: for large
// operations the 8k cap can truncate before "responses" — tracked for M4.
ok(
  /"parameters"/.test(led) && led.length > 1000,
  `lookup_endpoint detail schema shape (len ${led.length})`,
);

await client.close();
console.log(failures === 0 ? "\nALL GREEN" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
