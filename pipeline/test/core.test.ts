import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DayFile, LensesFile, SourcesFile, analysisCacheKey } from "@daily-four/shared";
import { dedupItems, normalizeUrl, titleTokens, jaccard } from "../src/dedup.js";
import { parseFeed, cleanText } from "../src/feeds.js";
import { sanitizeEvents } from "../src/triage.js";
import { onePerOutlet, mergeSuggestions } from "../src/write.js";
import { scoreEvents, selectStories, type SelectionRules, type ScoredEvent } from "../src/select.js";

const item = (sourceId: string, title: string, url: string, description = "") => ({ sourceId, title, url, description });

describe("הסרת כפילויות", () => {
  it("מנרמל כתובות עם פרמטרי מעקב, www ו-/ בסוף", () => {
    expect(normalizeUrl("https://www.ynet.co.il/news/a/1/?utm_source=x&id=5#top")).toBe(normalizeUrl("http://ynet.co.il/news/a/1?id=5"));
    expect(normalizeUrl("https://x.com/a?id=5")).not.toBe(normalizeUrl("https://x.com/a?id=6"));
  });

  it("מתעלם מניקוד ופיסוק בכותרות", () => {
    const a = titleTokens('הַכְּנֶסֶת אישרה: "חוק הגיוס" עבר');
    const b = titleTokens("הכנסת אישרה חוק הגיוס עבר");
    expect(jaccard(a, b)).toBe(1);
  });

  it("מסיר אותה כתובת גם בין מקורות (ynet ו-ynet עולם)", () => {
    const out = dedupItems([
      item("ynet", "כותרת א", "https://www.ynet.co.il/a/1"),
      item("ynet-world", "כותרת א", "https://ynet.co.il/a/1?utm_medium=rss"),
    ]);
    expect(out).toHaveLength(1);
  });

  it("מסיר כותרת כמעט זהה מאותו מקור ושומר את התקציר הארוך", () => {
    const out = dedupItems([
      item("maariv", "ראש הממשלה נפגש עם נשיא ארצות הברית בבית הלבן", "https://m.co/1", "קצר"),
      item("maariv", "ראש הממשלה נפגש עם נשיא ארצות הברית בבית הלבן היום", "https://m.co/2", "תקציר ארוך בהרבה עם פרטים"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].description).toContain("ארוך");
  });

  it("לא מוחק כותרת דומה ממקור אחר (היא נספרת כמקור נוסף)", () => {
    const out = dedupItems([
      item("ynet", "הכנסת אישרה את התקציב בקריאה שלישית", "https://ynet.co.il/1"),
      item("maariv", "הכנסת אישרה את התקציב בקריאה שלישית", "https://maariv.co.il/1"),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.id)).toEqual(["i1", "i2"]);
  });
});

describe("פירוק פידים", () => {
  it("RSS עם CDATA ו-HTML", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
      <item><title><![CDATA[כותרת &quot;ראשונה&quot;]]></title><link>https://a.co/1</link>
      <description><![CDATA[<p>תקציר <b>מודגש</b></p><img src="x"/>]]></description><pubDate>Tue, 24 Nov 2026 10:00:00 +0200</pubDate></item>
      <item><title>שנייה</title><link>https://a.co/2</link></item></channel></rss>`;
    const items = parseFeed(xml, "s");
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('כותרת "ראשונה"');
    expect(items[0].description).toBe("תקציר מודגש");
    expect(items[0].publishedAt).toBe("2026-11-24T08:00:00.000Z");
  });

  it("Atom עם link href", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Hello</title>
      <link rel="alternate" href="https://b.co/x"/><updated>2026-11-24T10:00:00Z</updated><summary>Sum</summary></entry></feed>`;
    const items = parseFeed(xml, "s");
    expect(items[0]).toMatchObject({ title: "Hello", url: "https://b.co/x", description: "Sum" });
  });

  it("מקצר טקסט ארוך בגבול מילה", () => {
    expect(cleanText("מילה ".repeat(200), 20).length).toBeLessThanOrEqual(21);
  });
});

describe("ניקוי פלט המיון", () => {
  it("מסיר מזהים לא קיימים ומונע פריט בשני אירועים", () => {
    const raw = {
      events: [
        { label: "א", itemIds: ["i1", "i2", "i99"], topic: "security", region: "israel", importance: 8, analyzable: true },
        { label: "ב", itemIds: ["i2"], topic: "law", region: "israel", importance: 6, analyzable: true },
        { label: "ג", itemIds: ["i3"], topic: "law", region: "mars", importance: 6, analyzable: true },
      ],
    };
    const out = sanitizeEvents(raw, new Set(["i1", "i2", "i3"]));
    expect(out).toHaveLength(1);
    expect(out[0].itemIds).toEqual(["i1", "i2"]);
  });
});

describe("בחירת 4 ידיעות", () => {
  const rules: SelectionRules = {
    count: 4, maxPerTopic: 2, maxPerRegion: 2, minInternational: 2,
    excludeTopics: ["sport", "gossip"], multiSourceBonus: 1, minImportance: 4,
  };
  const ev = (label: string, topic: string, region: any, score: number, analyzable = true): ScoredEvent => ({
    label, topic, region, importance: score, analyzable, itemIds: [label], score, outletCount: 1,
  });

  it("לפחות 2 בינלאומיות גם כשהישראליות חשובות יותר", () => {
    const out = selectStories(
      [ev("il1", "security", "israel", 10), ev("il2", "law", "israel", 9), ev("rg1", "security", "regional", 9), ev("rg2", "diplomacy", "regional", 8.5), ev("int1", "economy", "international", 6), ev("int2", "diplomacy", "international", 5)],
      rules,
    );
    expect(out.filter((e) => e.region === "international")).toHaveLength(2);
    expect(out).toHaveLength(4);
  });

  it("לא יותר משתיים מאותו נושא ומאותו אזור", () => {
    const out = selectStories(
      [ev("a", "security", "israel", 10), ev("b", "security", "israel", 9.9), ev("c", "security", "regional", 9.8), ev("d", "law", "israel", 9.7), ev("e", "economy", "international", 5), ev("f", "science-tech", "international", 4)],
      rules,
    );
    expect(out.filter((e) => e.topic === "security").length).toBeLessThanOrEqual(2);
    expect(out.filter((e) => e.region === "israel").length).toBeLessThanOrEqual(2);
  });

  it("לא יותר מאירוע אחד מאותו קו עלילה", () => {
    const withThread = (e: ScoredEvent, thread: string) => ({ ...e, thread });
    const out = selectStories(
      [withThread(ev("a", "security", "regional", 10), "iran"), withThread(ev("b", "diplomacy", "regional", 9.9), "iran"),
       withThread(ev("c", "law", "israel", 7), "x"), withThread(ev("d", "economy", "international", 6), "y"), withThread(ev("e", "health", "international", 5), "z")],
      rules,
    );
    expect(out.map((e) => e.label)).toEqual(["a", "c", "d", "e"]);
  });

  it("ממלא 4 גם כשאין מספיק מגוון", () => {
    const out = selectStories([ev("a", "security", "israel", 9), ev("b", "security", "israel", 8), ev("c", "security", "israel", 7), ev("d", "security", "israel", 6)], rules);
    expect(out).toHaveLength(4);
  });

  it("מסנן ספורט, רכילות ואירועים לא חשובים, ונותן בונוס לריבוי מקורות", () => {
    const items = new Map([
      ["x1", { id: "x1", sourceId: "ynet", title: "", description: "", url: "https://a" }],
      ["x2", { id: "x2", sourceId: "maariv", title: "", description: "", url: "https://b" }],
      ["x3", { id: "x3", sourceId: "ynet-world", title: "", description: "", url: "https://c" }],
    ]);
    const scored = scoreEvents(
      [
        { label: "sport", itemIds: ["x1"], topic: "sport", region: "israel", importance: 9, analyzable: true },
        { label: "low", itemIds: ["x1"], topic: "law", region: "israel", importance: 2, analyzable: true },
        { label: "single", itemIds: ["x1"], topic: "law", region: "israel", importance: 6, analyzable: true },
        { label: "multi", itemIds: ["x1", "x2", "x3"], topic: "law", region: "israel", importance: 6, analyzable: true },
      ],
      items, new Map(), rules,
    );
    expect(scored.map((s) => s.label)).toEqual(["multi", "single"]);
    expect(scored[0].outletCount).toBe(2); // ynet ו-ynet-world = כלי אחד
  });
});

describe("קבצי הגדרות ו-schema", () => {
  it("sources.json ו-lenses.json תקינים", () => {
    const s = SourcesFile.parse(JSON.parse(readFileSync(new URL("../../config/sources.json", import.meta.url), "utf8")));
    const l = LensesFile.parse(JSON.parse(readFileSync(new URL("../../config/lenses.json", import.meta.url), "utf8")));
    expect(s.sources.length).toBeGreaterThan(10);
    expect(l.lenses.map((x) => x.id)).toContain("media-framing");
  });

  it("קובץ יום תקין עובר, ושגוי נדחה", () => {
    const good = {
      schemaVersion: 1, date: "2026-11-24", generatedAt: "2026-11-24T04:00:00Z",
      stats: { feedsOk: 1, feedsFailed: 0, itemsCollected: 5, eventsFound: 3 },
      stories: [{
        id: "2026-11-24-1", rank: 1, headline: "כותרת לדוגמה", summary: "תקציר של שניים או שלושה משפטים.", whyItMatters: "כי זה חשוב מאוד.",
        tag: "משפט", topic: "law", region: "israel", singleSource: true,
        sources: [{ sourceId: "ynet", name: "ynet", lean: "מרכזי", lang: "he", title: "t", url: "https://ynet.co.il/1" }],
        lensSuggestions: [{ lensId: "legal", question: "מה הסמכות?" }, { lensId: "historical", question: "מה התקדים?" }],
      }],
    };
    expect(DayFile.safeParse(good).success).toBe(true);
    expect(DayFile.safeParse({ ...good, schemaVersion: 2 }).success).toBe(false);
    expect(DayFile.safeParse({ ...good, stories: [{ ...good.stories[0], lensSuggestions: [good.stories[0].lensSuggestions[0]] }] }).success).toBe(false);
  });

  it("מפתח cache לא תלוי בסדר המישורים", () => {
    expect(analysisCacheKey("2026-11-24-1", ["legal", "historical"], "normal")).toBe(analysisCacheKey("2026-11-24-1", ["historical", "legal", "legal"], "normal"));
    expect(analysisCacheKey("2026-11-24-1", ["legal"], "normal")).not.toBe(analysisCacheKey("2026-11-24-1", ["legal"], "deep"));
  });
});

describe("רשימת מקורות לידיעה", () => {
  it("רשומה אחת לכל כלי תקשורת", () => {
    const mk = (id: string, sourceId: string) => ({ id, sourceId, title: id, description: "", url: `https://x/${id}` });
    const out = onePerOutlet([mk("1", "ynet"), mk("2", "ynet-world"), mk("3", "maariv"), mk("4", "maariv"), mk("5", "kikar")]);
    expect(out.map((i) => i.id)).toEqual(["1", "3", "5"]);
  });
});

describe("הצעות מישורי ניתוח", () => {
  const lenses = [
    { id: "historical", name: "h", description: "", prompt: "xxxxxxxxxxxx", group: "core" as const },
    { id: "legal", name: "l", description: "", prompt: "xxxxxxxxxxxx", group: "core" as const },
    { id: "media-framing", name: "m", description: "", prompt: "xxxxxxxxxxxx", group: "core" as const },
    { id: "sociological", name: "s", description: "", prompt: "xxxxxxxxxxxx", group: "core" as const },
    { id: "political-philosophy", name: "p", description: "", prompt: "xxxxxxxxxxxx", group: "deep" as const },
  ];
  const q = (lensId: string) => ({ lensId, question: "שאלה?" });

  it("עד 3 מרכזיות + עמוקה אחת בסוף", () => {
    const out = mergeSuggestions([q("historical"), q("legal"), q("sociological"), q("media-framing")], q("political-philosophy"), lenses, 3);
    expect(out.map((l) => l.lensId)).toEqual(["historical", "legal", "sociological", "political-philosophy"]);
    expect(out.at(-1)?.kind).toBe("deep");
  });

  it("מתעלם מעמוקה שאינה מקבוצת deep, ממזהים לא קיימים וממסגור תקשורתי במקור יחיד", () => {
    const out = mergeSuggestions([q("nope"), q("media-framing"), q("legal"), q("legal")], q("historical"), lenses, 1);
    expect(out.map((l) => l.lensId)).toEqual(["legal"]);
  });
});
