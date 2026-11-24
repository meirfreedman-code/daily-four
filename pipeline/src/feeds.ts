import { XMLParser } from "fast-xml-parser";
import type { SourceConfig } from "@daily-four/shared";

export interface FeedItem {
  /** מזהה קצר ויציב בתוך הריצה, משמש את המודל */
  id: string;
  sourceId: string;
  title: string;
  description: string;
  url: string;
  publishedAt?: string;
}

export interface FeedResult {
  sourceId: string;
  name: string;
  url: string;
  ok: boolean;
  httpStatus?: number;
  itemCount: number;
  recentCount: number;
  newestAt?: string;
  error?: string;
  ms: number;
}

const USER_AGENT = "DailyFourPersonalReader/1.0 (personal RSS reader; one request per day)";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: "#cdata",
  trimValues: true,
});

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return text(o["#cdata"] ?? o["#text"] ?? "");
  }
  return "";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function cleanText(s: string, max = 400): string {
  let t = s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e: string) => {
      if (ENTITIES[e]) return ENTITIES[e];
      if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
      return m;
    })
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > max) t = t.slice(0, max).replace(/\s\S*$/, "") + "…";
  return t;
}

function linkOf(entry: Record<string, unknown>): string {
  const l = entry.link;
  if (typeof l === "string") return l.trim();
  if (Array.isArray(l)) {
    const alt = l.find((x) => typeof x === "object" && (x as any)["@_rel"] !== "self") ?? l[0];
    return typeof alt === "string" ? alt : String((alt as any)?.["@_href"] ?? text(alt));
  }
  if (l && typeof l === "object") return String((l as any)["@_href"] ?? text(l));
  const guid = text(entry.guid);
  return guid.startsWith("http") ? guid : "";
}

function toIso(d: string): string | undefined {
  if (!d) return undefined;
  const t = Date.parse(d);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** מפרק RSS 2.0 / Atom / RDF לרשימת פריטים */
export function parseFeed(xml: string, sourceId: string): Omit<FeedItem, "id">[] {
  const doc = parser.parse(xml);
  const entries: Record<string, unknown>[] = [];
  const push = (x: unknown) => {
    if (!x) return;
    if (Array.isArray(x)) entries.push(...(x as Record<string, unknown>[]));
    else entries.push(x as Record<string, unknown>);
  };
  push(doc?.rss?.channel?.item);
  push(doc?.feed?.entry);
  push(doc?.["rdf:RDF"]?.item);
  return entries
    .map((e) => ({
      sourceId,
      title: cleanText(text(e.title), 300),
      description: cleanText(text(e.description ?? e.summary ?? e.content ?? e["content:encoded"])),
      url: linkOf(e),
      publishedAt: toIso(text(e.pubDate ?? e.published ?? e.updated ?? e["dc:date"])),
    }))
    .filter((i) => i.title && i.url.startsWith("http"));
}

export async function fetchSource(
  source: SourceConfig,
  opts: { lookbackHours: number; maxItems: number; now?: Date; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<{ result: FeedResult; items: Omit<FeedItem, "id">[] }> {
  const start = Date.now();
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();
  const base: FeedResult = { sourceId: source.id, name: source.name, url: source.url, ok: false, itemCount: 0, recentCount: 0, ms: 0 };
  try {
    const res = await f(source.url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
    });
    base.httpStatus = res.status;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 3000))) throw new Error("התשובה אינה פיד RSS/Atom (כנראה דף HTML או חסימה)");
    const all = parseFeed(body, source.id);
    const cutoff = now.getTime() - opts.lookbackHours * 3600_000;
    // פריט בלי תאריך נחשב עדכני (חלק מהפידים לא מציינים תאריך)
    const recent = all.filter((i) => !i.publishedAt || Date.parse(i.publishedAt) >= cutoff).slice(0, opts.maxItems);
    const newest = all.map((i) => i.publishedAt).filter(Boolean).sort().at(-1);
    return {
      result: { ...base, ok: all.length > 0, itemCount: all.length, recentCount: recent.length, newestAt: newest, error: all.length ? undefined : "הפיד ריק", ms: Date.now() - start },
      items: recent,
    };
  } catch (e) {
    const err = e as Error;
    return { result: { ...base, error: err.name === "TimeoutError" ? "פג הזמן (timeout)" : err.message, ms: Date.now() - start }, items: [] };
  }
}

export async function fetchAll(
  sources: SourceConfig[],
  opts: { lookbackHours: number; maxItems: number; now?: Date; fetchImpl?: typeof fetch; concurrency?: number },
) {
  const active = sources.filter((s) => s.active);
  const results: FeedResult[] = [];
  const items: Omit<FeedItem, "id">[] = [];
  const queue = [...active];
  const workers = Array.from({ length: opts.concurrency ?? 6 }, async () => {
    while (queue.length) {
      const s = queue.shift()!;
      const r = await fetchSource(s, opts);
      results.push(r.result);
      items.push(...r.items);
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => active.findIndex((s) => s.id === a.sourceId) - active.findIndex((s) => s.id === b.sourceId));
  return { results, items };
}
