// Parse docs.natural.com/llms.txt into an index of sections -> pages.
//
// The file is mostly an agent-onboarding playbook written as prose; only the tail
// sections are a real link index (## Surfaces, ## Products, ## Guides, ...). Each
// index bullet looks like:  - [Title](https://docs.natural.com/<slug>): description
// Sections with no such bullets (the playbook prose) are dropped automatically.

import { fetchText } from "./cache.js";
import { fetchCorpus } from "./corpus.js";

const INDEX_URL = "https://docs.natural.com/llms.txt";
const HEADING_RE = /^##\s+(.*)$/;
const LINK_RE =
  /^- \[([^\]]+)\]\((https:\/\/docs\.natural\.com\/([^)]+))\)(?::\s*(.*))?$/;

export interface DocPage {
  title: string;
  slug: string;
  url: string;
  description: string;
}

export interface DocSection {
  section: string;
  pages: DocPage[];
}

// Fallback when llms.txt is unreachable or its shape has drifted: derive a flat
// index from the corpus (llms-full.txt Source: lines).
async function corpusFallback(): Promise<DocSection[]> {
  const pages = await fetchCorpus();
  return [
    {
      section: "All pages",
      pages: pages.map((p) => ({
        title: p.title,
        slug: p.slug,
        url: p.url,
        description: "",
      })),
    },
  ];
}

export async function parseIndex(): Promise<DocSection[]> {
  let text: string;
  try {
    text = await fetchText(INDEX_URL);
  } catch {
    return corpusFallback();
  }
  const sections: DocSection[] = [];
  let current: DocSection | null = null;

  for (const line of text.split("\n")) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      current = { section: heading[1].trim(), pages: [] };
      sections.push(current);
      continue;
    }
    const link = line.match(LINK_RE);
    if (link && current) {
      current.pages.push({
        title: link[1].trim(),
        url: link[2],
        slug: link[3].replace(/\/$/, ""),
        description: (link[4] ?? "").trim(),
      });
    }
  }

  const indexed = sections.filter((s) => s.pages.length > 0);
  return indexed.length > 0 ? indexed : corpusFallback();
}
