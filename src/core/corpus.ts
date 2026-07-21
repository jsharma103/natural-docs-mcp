// Fetch docs.natural.com/llms-full.txt and split it into pages. Each page starts
// with a level-1 heading `# Title` immediately followed by `Source: <url>`; the
// body runs until the next such pair. (Level-2 `## ` headings inside a page do not
// match, so in-page sections don't cause false splits.)

import { fetchText } from "./cache.js";

const CORPUS_URL = "https://docs.natural.com/llms-full.txt";
const TITLE_RE = /^#\s+(.*)$/;
const SOURCE_RE = /^Source:\s+(https:\/\/docs\.natural\.com\/(\S+))/;
const SOURCE_PREFIX_RE = /^Source:\s+https:\/\/docs\.natural\.com\//;

export interface CorpusPage {
  title: string;
  slug: string;
  url: string;
  body: string;
}

function isPageStart(lines: string[], i: number): boolean {
  return (
    TITLE_RE.test(lines[i]) &&
    i + 1 < lines.length &&
    SOURCE_PREFIX_RE.test(lines[i + 1])
  );
}

export async function fetchCorpus(): Promise<CorpusPage[]> {
  const text = await fetchText(CORPUS_URL);
  const lines = text.split("\n");
  const pages: CorpusPage[] = [];

  let i = 0;
  while (i < lines.length) {
    if (!isPageStart(lines, i)) {
      i++;
      continue;
    }
    const title = lines[i].match(TITLE_RE)![1].trim();
    const source = lines[i + 1].match(SOURCE_RE)!;
    const url = source[1];
    const slug = source[2].replace(/\/$/, "");

    let j = i + 2;
    const body: string[] = [];
    while (j < lines.length && !isPageStart(lines, j)) {
      body.push(lines[j]);
      j++;
    }
    pages.push({ title, slug, url, body: body.join("\n").trim() });
    i = j;
  }

  return pages;
}
