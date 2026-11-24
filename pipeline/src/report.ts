import type { FeedResult } from "./feeds.js";

export function formatFeedReport(results: FeedResult[], now: Date): string {
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const row = (r: FeedResult) =>
    `| ${r.ok ? "✅" : "❌"} | ${r.name} | ${r.httpStatus ?? "-"} | ${r.itemCount} | ${r.recentCount} | ${r.newestAt?.slice(0, 16).replace("T", " ") ?? "-"} | ${r.error ?? ""} |`;
  return [
    `# דוח מצב פידים`,
    ``,
    `נבדק: ${now.toISOString()} · עובדים: ${ok.length}/${results.length}`,
    ``,
    `| | מקור | HTTP | פריטים | עדכניים | אחרון (UTC) | שגיאה |`,
    `|---|---|---|---|---|---|---|`,
    ...[...ok, ...bad].map(row),
    ``,
  ].join("\n");
}
