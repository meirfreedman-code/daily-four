import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DayFile, DayIndex, type LlmCall } from "@daily-four/shared";
import { runPipeline } from "../src/run.js";

/** פיד מזויף: לכל מקור 3 פריטים; כל המקורות מדווחים על "אירוע משותף" */
function fakeFetch(url: string | URL | Request): Promise<Response> {
  const u = String(url);
  if (u.includes("kan.org.il")) return Promise.resolve(new Response("<html>blocked</html>", { status: 403 }));
  const host = new URL(u).hostname;
  const items = [
    `<item><title>אירוע משותף: הסכם בין המדינות נחתם</title><link>https://${host}/shared</link><pubDate>Tue, 24 Nov 2026 05:00:00 GMT</pubDate></item>`,
    ...[1, 2].map((n) => `<item><title>ידיעה ${n} של ${host}</title><link>https://${host}/${n}</link><description>תקציר ${n}</description><pubDate>Tue, 24 Nov 2026 05:00:00 GMT</pubDate></item>`),
  ];
  return Promise.resolve(new Response(`<?xml version="1.0"?><rss version="2.0"><channel>${items.join("")}</channel></rss>`, { status: 200 }));
}

/** מודל מזויף שמחזיר JSON לפי סוג הבקשה */
function fakeLlm(call: LlmCall) {
  const ids = [...call.prompt.matchAll(/^(i\d+) /gm)].map((m) => m[1]);
  let out: unknown;
  if (call.prompt.includes("קבץ אותם לאירועים")) {
    const shared = [...call.prompt.matchAll(/^(i\d+) .*אירוע משותף/gm)].map((m) => m[1]);
    const rest = ids.filter((i) => !shared.includes(i));
    out = {
      events: [
        { label: "הסכם", itemIds: shared, topic: "diplomacy", region: "regional", importance: 8, analyzable: true },
        { label: "בינ1", itemIds: [rest[0]], topic: "economy", region: "international", importance: 6, analyzable: true },
        { label: "בינ2", itemIds: [rest[1]], topic: "science-tech", region: "international", importance: 5, analyzable: true },
        { label: "ספורט", itemIds: [rest[2]], topic: "sport", region: "israel", importance: 9, analyzable: false },
        { label: "פנים", itemIds: [rest[3]], topic: "law", region: "israel", importance: 7, analyzable: true },
      ],
    };
  } else {
    const n = [...call.prompt.matchAll(/^ידיעה (\d+) /gm)].length;
    out = {
      stories: Array.from({ length: n }, (_, index) => ({
        index, headline: `כותרת עניינית ${index}`, summary: "משפט ראשון של תקציר. משפט שני של תקציר.", whyItMatters: "זה משנה את התמונה לטווח ארוך.",
        tag: "דיפלומטיה",
        lensSuggestions: [
          { lensId: "geopolitical", question: "מי מרוויח מההסכם?" },
          { lensId: "media-framing", question: "איך כל צד מציג זאת?" },
          { lensId: "nonexistent", question: "לא קיים" },
          { lensId: "historical", question: "מה התקדים?" },
        ],
      })),
    };
  }
  return Promise.resolve({ text: JSON.stringify(out), model: call.model, inputTokens: 100, outputTokens: 50 });
}

describe("צינור מלא (עם פידים ומודל מזויפים)", () => {
  it("מפיק קובץ יום תקין, אינדקס ודוח פידים", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "df-"));
    const r = await runPipeline({ llm: fakeLlm, fetchImpl: fakeFetch as typeof fetch, now: new Date("2026-11-24T05:30:00Z"), outDir, log: () => {} });

    const day = DayFile.parse(JSON.parse(readFileSync(path.join(outDir, "data/2026-11-24.json"), "utf8")));
    expect(day.stories).toHaveLength(4);
    expect(day.stories.filter((s) => s.region === "international").length).toBeGreaterThanOrEqual(2);
    expect(day.stories.some((s) => s.headline.includes("ספורט"))).toBe(false);

    const shared = day.stories.find((s) => s.sources.length > 1)!;
    expect(shared.singleSource).toBe(false);
    expect(shared.lensSuggestions.map((l) => l.lensId)).toContain("media-framing");

    const single = day.stories.find((s) => s.sources.length === 1)!;
    expect(single.singleSource).toBe(true);
    expect(single.lensSuggestions.map((l) => l.lensId)).not.toContain("media-framing");
    expect(day.stories.every((s) => s.lensSuggestions.every((l) => l.lensId !== "nonexistent"))).toBe(true);

    const index = DayIndex.parse(JSON.parse(readFileSync(path.join(outDir, "index.json"), "utf8")));
    expect(index.latest).toBe("2026-11-24");
    expect(r.results.find((x) => x.sourceId === "kan")?.ok).toBe(false);
    expect(readFileSync(path.join(outDir, "feeds-report.md"), "utf8")).toContain("כאן חדשות");
  });
});
