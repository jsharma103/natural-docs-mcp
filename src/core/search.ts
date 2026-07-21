// BM25 search over the docs corpus using minisearch (pure JS, Workers-compatible).
// The index and a slug->page map are built lazily on first use and reused for the
// isolate/process lifetime.

import MiniSearch from "minisearch";
import { fetchCorpus, type CorpusPage } from "./corpus.js";

let index: MiniSearch | null = null;
let bySlug: Map<string, CorpusPage> | null = null;

async function ensure(): Promise<void> {
  if (index && bySlug) return;
  const pages = await fetchCorpus();
  bySlug = new Map();

  const docs = pages.map((p, id) => {
    bySlug!.set(p.slug, p);
    return { id, title: p.title, body: p.body, slug: p.slug, url: p.url };
  });

  const ms = new MiniSearch({
    fields: ["title", "body"],
    storeFields: ["title", "slug", "url"],
    searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.2 },
  });
  ms.addAll(docs);
  index = ms;
}

export interface Hit {
  title: string;
  slug: string;
  url: string;
  score: number;
  snippet: string;
}

export async function searchDocs(query: string, limit: number): Promise<Hit[]> {
  await ensure();
  return index!
    .search(query)
    .slice(0, limit)
    .map((r) => {
      const page = bySlug!.get(r.slug as string);
      return {
        title: r.title as string,
        slug: r.slug as string,
        url: r.url as string,
        score: Math.round((r.score as number) * 1000) / 1000,
        snippet: page ? snippet(page.body, query) : "",
      };
    });
}

export async function getCorpusPage(
  slug: string,
): Promise<CorpusPage | undefined> {
  await ensure();
  return bySlug!.get(slug);
}

function snippet(body: string, query: string): string {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const lower = body.toLowerCase();

  let pos = -1;
  for (const t of terms) {
    const p = lower.indexOf(t);
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  if (pos < 0) pos = 0;

  const start = Math.max(0, pos - 200);
  const end = Math.min(body.length, pos + 200);
  const core = body.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + core + (end < body.length ? "…" : "");
}
