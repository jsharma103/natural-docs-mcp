// Per-URL in-memory fetch cache with a fixed TTL. Shared by all core modules so
// each source (llms.txt, llms-full.txt, openapi.json, per-page .md) is fetched at
// most once per TTL window per isolate/process.

const TTL_MS = 15 * 60 * 1000;

interface Entry {
  at: number;
  value: string;
}

const store = new Map<string, Entry>();

export class HttpError extends Error {
  constructor(
    public url: string,
    public status: number,
  ) {
    super(`fetch ${url} returned ${status}`);
    this.name = "HttpError";
  }
}

export async function fetchText(url: string): Promise<string> {
  const now = Date.now();
  const hit = store.get(url);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  const res = await fetch(url, {
    headers: {
      "user-agent":
        "natural-docs-mcp/0.1 (+https://github.com/jsharma103/natural-docs-mcp)",
    },
  });
  if (!res.ok) throw new HttpError(url, res.status);
  const text = await res.text();
  store.set(url, { at: now, value: text });
  return text;
}

export async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url)) as T;
}
