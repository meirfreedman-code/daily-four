import type { FeedItem } from "./feeds.js";

/** מנרמל כתובת: בלי פרמטרי מעקב, בלי # ובלי / בסוף */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|ref_|source$|cmpid|at_|xtor)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.replace(/^(www\.|m\.)/, "");
    u.protocol = "https:";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** מילים משמעותיות בכותרת: בלי ניקוד, פיסוק ומילים קצרות מאוד */
export function titleTokens(title: string): Set<string> {
  const t = title
    .normalize("NFKC")
    .replace(/[֑-ׇ]/g, "") // ניקוד וטעמים
    .replace(/["'״׳`]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return new Set(t.split(" ").filter((w) => w.length > 1));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * מסיר כפילויות "טכניות": אותה כתובת, או כותרת כמעט זהה (מעל הסף).
 * כותרת דומה ממקורות שונים לא נמחקת כאן: היא תקובץ לאותו אירוע בשלב הבא, וכך נספרים כמה מקורות.
 * מחזיר פריטים עם מזהים קצרים i1, i2, ...
 */
export function dedupItems(items: Omit<FeedItem, "id">[], titleThreshold = 0.8): FeedItem[] {
  const seenUrls = new Set<string>();
  const kept: { item: Omit<FeedItem, "id">; tokens: Set<string> }[] = [];
  for (const item of items) {
    const nu = normalizeUrl(item.url);
    if (seenUrls.has(nu)) continue;
    const tokens = titleTokens(item.title);
    const dupe = kept.find((k) => k.item.sourceId === item.sourceId && jaccard(k.tokens, tokens) >= titleThreshold);
    if (dupe) {
      // שומרים את הגרסה עם התקציר הארוך יותר
      if (item.description.length > dupe.item.description.length) {
        dupe.item = item;
        dupe.tokens = tokens;
      }
      seenUrls.add(nu);
      continue;
    }
    seenUrls.add(nu);
    kept.push({ item, tokens });
  }
  return kept.map((k, i) => ({ ...k.item, id: `i${i + 1}` }));
}
