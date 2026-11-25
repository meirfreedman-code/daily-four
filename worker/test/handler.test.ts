import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { LlmError, type LlmCall, type DayFile } from "@daily-four/shared";
import { handle, safeEqual, type Env, type KV } from "../src/handler.js";
import { autoLenses, buildAnalysisPrompt } from "../src/prompt.js";

const lensesFile = JSON.parse(readFileSync(new URL("../../config/lenses.json", import.meta.url), "utf8"));
const day: DayFile = {
  schemaVersion: 1, date: "2026-11-25", generatedAt: "2026-11-25T04:00:00Z",
  stats: { feedsOk: 1, feedsFailed: 0, itemsCollected: 1, eventsFound: 1 },
  stories: [{
    id: "2026-11-25-1", rank: 1, headline: "הממשלה אישרה תוכנית לרכבת קלה", summary: "הממשלה אישרה תוכנית. הביצוע יחל בשנה הבאה.",
    whyItMatters: "תשתית לעשורים.", tag: "תשתיות", topic: "infrastructure-planning", region: "israel", singleSource: false,
    sources: [{ sourceId: "ynet", name: "ynet", lean: "מרכזי", lang: "he", title: "אושרה הרכבת", url: "https://ynet.co.il/1" }],
    lensSuggestions: [
      { lensId: "political-economy", question: "מי מרוויח?", kind: "core" },
      { lensId: "legal", question: "מה הסמכות?", kind: "core" },
      { lensId: "political-philosophy", question: "מה אומר הובס?", kind: "deep" },
    ],
  }],
};

class MemKV implements KV {
  m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async put(k: string, v: string) { this.m.set(k, v); }
}

const BASE = "https://data.test";
function fakeFetch(url: string | URL | Request): Promise<Response> {
  const u = String(url);
  if (u === `${BASE}/data/2026-11-25.json`) return Promise.resolve(Response.json(day));
  if (u === `${BASE}/lenses.json`) return Promise.resolve(Response.json(lensesFile));
  return Promise.resolve(new Response("nf", { status: 404 }));
}

let env: Env;
let calls: LlmCall[];
let llmImpl: (c: LlmCall) => Promise<{ text: string; model: string; inputTokens: number; outputTokens: number }>;
const deps = () => ({ fetch: fakeFetch as typeof fetch, now: () => new Date("2026-11-25T08:00:00Z"), llm: (c: LlmCall) => { calls.push(c); return llmImpl(c); } });

const post = (body: unknown, token = "secret-token") =>
  new Request("https://w.test/analyze", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  env = { CACHE: new MemKV(), APP_TOKEN: "secret-token", GEMINI_API_KEY: "x", DATA_BASE_URL: BASE, ANALYZE_MODELS: "m1,m2", MAX_PER_DAY: "3", MAX_PER_MINUTE: "10" };
  calls = [];
  llmImpl = async (c) => ({ text: `## מה ידוע\nניתוח מ-${c.model}`, model: c.model, inputTokens: 1, outputTokens: 1 });
});

describe("Worker ניתוח", () => {
  it("דוחה טוקן שגוי ובקשה לא תקינה", async () => {
    expect((await handle(post({ storyId: "2026-11-25-1", lensIds: ["legal"] }, "wrong"), env, deps())).status).toBe(401);
    expect((await handle(post({ storyId: "bad", lensIds: [] }), env, deps())).status).toBe(400);
    expect((await handle(post({ storyId: "2026-11-25-1", lensIds: ["nope"] }), env, deps())).status).toBe(400);
    expect((await handle(post({ storyId: "2026-11-25-9", lensIds: ["legal"] }), env, deps())).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("בקשה חוזרת מגיעה מה-cache בלי לקרוא למודל, גם בסדר מישורים אחר", async () => {
    const r1 = await (await handle(post({ storyId: "2026-11-25-1", lensIds: ["legal", "historical"] }), env, deps())).json();
    expect(r1.cached).toBe(false);
    expect(r1.label).toContain("AI");
    const r2 = await (await handle(post({ storyId: "2026-11-25-1", lensIds: ["historical", "legal"] }), env, deps())).json();
    expect(r2.cached).toBe(true);
    expect(r2.body).toBe(r1.body);
    expect(calls).toHaveLength(1);
  });

  it("ניתוח משולב מבקש שזירה ולא רצף; מישור יחיד לא", async () => {
    await handle(post({ storyId: "2026-11-25-1", lensIds: ["legal", "historical", "sociological"] }), env, deps());
    expect(calls[0].prompt).toContain("ניתוח משולב של 3 מישורים");
    expect(calls[0].prompt).toContain("מחזקים זה את זה");
    await handle(post({ storyId: "2026-11-25-1", lensIds: ["legal"] }), env, deps());
    expect(calls[1].prompt).toContain("ניתוח במישור אחד");
  });

  it("'בחר בשבילי' בוחר מישור מרכזי + מישור עמוק", async () => {
    expect(autoLenses(day.stories[0])).toEqual(["political-economy", "political-philosophy"]);
    const r = await (await handle(post({ storyId: "2026-11-25-1", lensIds: ["auto"] }), env, deps())).json();
    expect(r.lensIds).toEqual(["political-economy", "political-philosophy"]);
  });

  it("'העמק' מקבל את הגרסה הקצרה כדי לא לחזור עליה, ונשמר בנפרד", async () => {
    await handle(post({ storyId: "2026-11-25-1", lensIds: ["legal"] }), env, deps());
    const deep = await (await handle(post({ storyId: "2026-11-25-1", lensIds: ["legal"], depth: "deep" }), env, deps())).json();
    expect(deep.depth).toBe("deep");
    expect(calls[1].prompt).toContain("הגרסה הקצרה שהקורא כבר קרא");
    expect(calls[1].prompt).toContain("ניתוח מ-m1");
  });

  it("תקרה יומית: חוסם ניתוחים חדשים אבל לא cache", async () => {
    for (const l of ["legal", "historical", "sociological"]) expect((await handle(post({ storyId: "2026-11-25-1", lensIds: [l] }), env, deps())).status).toBe(200);
    const blocked = await handle(post({ storyId: "2026-11-25-1", lensIds: ["cultural"] }), env, deps());
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("daily_cap");
    expect((await handle(post({ storyId: "2026-11-25-1", lensIds: ["legal"] }), env, deps())).status).toBe(200);
  });

  it("הגבלת קצב לדקה", async () => {
    env.MAX_PER_MINUTE = "1";
    expect((await handle(post({ storyId: "2026-11-25-1", lensIds: ["legal"] }), env, deps())).status).toBe(200);
    const r = await handle(post({ storyId: "2026-11-25-1", lensIds: ["historical"] }), env, deps());
    expect((await r.json()).error.code).toBe("rate_limited");
  });

  it("עובר למודל הבא כשהראשון עמוס; מחזיר 503 כשכולם עמוסים ולא שומר ב-cache", async () => {
    llmImpl = async (c) => {
      if (c.model === "m1") throw new LlmError("busy", 503, true);
      return { text: "ok", model: c.model, inputTokens: 1, outputTokens: 1 };
    };
    expect((await (await handle(post({ storyId: "2026-11-25-1", lensIds: ["legal"] }), env, deps())).json()).model).toBe("m2");
    llmImpl = async () => { throw new LlmError("busy", 503, true); };
    const r = await handle(post({ storyId: "2026-11-25-1", lensIds: ["historical"] }), env, deps());
    expect(r.status).toBe(503);
    expect([...(env.CACHE as MemKV).m.keys()].some((k) => k.includes("historical"))).toBe(false);
  });

  it("health ו-CORS", async () => {
    expect((await handle(new Request("https://w.test/health"), env, deps())).status).toBe(200);
    expect((await handle(new Request("https://w.test/analyze", { method: "OPTIONS" }), env, deps())).headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
  });

  it("הפרומפט מסמן מקור יחיד", () => {
    const p = buildAnalysisPrompt({ ...day.stories[0], singleSource: true }, lensesFile.lenses.slice(0, 1), "normal", { minWords: 250, maxWords: 400, deepMaxWords: 900 });
    expect(p).toContain("מקור יחיד");
    expect(p).toContain("250-400 מילים");
  });
});

describe("לקוח Gemini", () => {
  it("תשובה שנקטעה (MAX_TOKENS) היא שגיאה ולא תוצאה", async () => {
    const { makeGemini } = await import("@daily-four/shared");
    const f = async () => Response.json({ candidates: [{ content: { parts: [{ text: "חצי משפט" }] }, finishReason: "MAX_TOKENS" }] });
    const llm = makeGemini("k", f as unknown as typeof fetch, 0);
    await expect(llm({ model: "m", system: "s", prompt: "p" })).rejects.toThrow(/נקטעה/);
  });

  it("503 נחשב עמוס (ניתן לניסיון חוזר)", async () => {
    const { makeGemini, LlmError } = await import("@daily-four/shared");
    const f = async () => new Response("busy", { status: 503 });
    const llm = makeGemini("k", f as unknown as typeof fetch, 0);
    const err = await llm({ model: "m", system: "s", prompt: "p" }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.retryable).toBe(true);
  });
});
