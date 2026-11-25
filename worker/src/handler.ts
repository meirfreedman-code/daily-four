import {
  AnalyzeRequest, DayFile, LensesFile, analysisCacheKey, storyDate, withFallback, makeGemini, LlmError,
  type AnalyzeResponse, type LlmFn, type Lens,
} from "@daily-four/shared";
import { SYSTEM, buildAnalysisPrompt, autoLenses, type AnalysisSettings } from "./prompt.js";

/** תת-קבוצה של Cloudflare KV שאנחנו משתמשים בה (קל לזייף בבדיקות) */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  CACHE: KV;
  /** טוקן אישי שהאפליקציה שולחת (Authorization: Bearer ...) */
  APP_TOKEN: string;
  GEMINI_API_KEY: string;
  /** כתובת הבסיס של הנתונים, למשל https://USER.github.io/daily-four */
  DATA_BASE_URL: string;
  /** רשימת מודלים מופרדת בפסיקים, לפי סדר עדיפות */
  ANALYZE_MODELS: string;
  /** תקרת ניתוחים חדשים (שלא מה-cache) ליום */
  MAX_PER_DAY?: string;
  /** תקרת ניתוחים חדשים לדקה */
  MAX_PER_MINUTE?: string;
}

export interface Deps {
  fetch: typeof fetch;
  now: () => Date;
  /** מאפשר להחליף את המודל בבדיקות */
  llm?: LlmFn;
}

export const LABEL = "ניתוח שנוצר ב-AI — כלי למחשבה, לא אמת מוחלטת";
const SETTINGS: AnalysisSettings = { minWords: 250, maxWords: 400, deepMaxWords: 900 };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
}
function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

/** השוואה בזמן קבוע כדי לא לחשוף את הטוקן דרך תזמון */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function getJson(deps: Deps, url: string): Promise<unknown | null> {
  const res = await deps.fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`שגיאה בטעינת ${url}: ${res.status}`);
  return res.json();
}

/** מונה פשוט ב-KV. לא אטומי, אבל מספיק למשתמש יחיד */
async function bump(kv: KV, key: string, ttl: number): Promise<number> {
  const n = Number((await kv.get(key)) ?? "0") + 1;
  await kv.put(key, String(n), { expirationTtl: ttl });
  return n;
}
async function peek(kv: KV, key: string): Promise<number> {
  return Number((await kv.get(key)) ?? "0");
}

export async function handle(req: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (url.pathname === "/health") return json({ ok: true });
  if (url.pathname !== "/analyze" || req.method !== "POST") return error(404, "not_found", "נתיב לא קיים");

  const auth = req.headers.get("Authorization") ?? "";
  if (!safeEqual(auth.replace(/^Bearer\s+/i, ""), env.APP_TOKEN)) return error(401, "unauthorized", "טוקן שגוי");

  let body: AnalyzeRequest;
  try {
    body = AnalyzeRequest.parse(await req.json());
  } catch {
    return error(400, "bad_request", "בקשה לא תקינה: צריך storyId ו-lensIds");
  }

  const base = env.DATA_BASE_URL.replace(/\/$/, "");
  const [dayRaw, lensesRaw] = await Promise.all([getJson(deps, `${base}/data/${storyDate(body.storyId)}.json`), getJson(deps, `${base}/lenses.json`)]);
  const day = dayRaw ? DayFile.safeParse(dayRaw) : null;
  if (!day?.success) return error(404, "story_not_found", "הידיעה לא נמצאה");
  const story = day.data.stories.find((s) => s.id === body.storyId);
  if (!story) return error(404, "story_not_found", "הידיעה לא נמצאה");
  const allLenses = LensesFile.parse(lensesRaw).lenses;

  const lensIds = body.lensIds.includes("auto") ? autoLenses(story) : [...new Set(body.lensIds)];
  const lenses = lensIds.map((id) => allLenses.find((l) => l.id === id)).filter((l): l is Lens => !!l);
  if (lenses.length !== lensIds.length) return error(400, "unknown_lens", "מישור ניתוח לא מוכר");

  const key = analysisCacheKey(story.id, lensIds, body.depth);
  const cached = await env.CACHE.get(key);
  if (cached) return json({ ...(JSON.parse(cached) as AnalyzeResponse), cached: true });

  // הגבלת קצב ותקרה יומית: נספרים רק ניתוחים חדשים (cache miss)
  const now = deps.now();
  const dayKey = `quota:day:${now.toISOString().slice(0, 10)}`;
  const minKey = `quota:min:${now.toISOString().slice(0, 16)}`;
  const maxDay = Number(env.MAX_PER_DAY ?? "15");
  const maxMin = Number(env.MAX_PER_MINUTE ?? "4");
  if ((await peek(env.CACHE, dayKey)) >= maxDay) return error(429, "daily_cap", `הגעת לתקרה היומית (${maxDay} ניתוחים חדשים). ניתוחים שכבר נוצרו עדיין זמינים.`);
  if ((await peek(env.CACHE, minKey)) >= maxMin) return error(429, "rate_limited", "יותר מדי בקשות בדקה. נסה שוב בעוד רגע.");
  await bump(env.CACHE, dayKey, 2 * 86400);
  await bump(env.CACHE, minKey, 120);

  // "העמק": אם יש גרסה קצרה ב-cache, מעבירים אותה כדי לא לחזור עליה
  const previous = body.depth === "deep" ? await env.CACHE.get(analysisCacheKey(story.id, lensIds, "normal")) : null;
  const prevBody = previous ? (JSON.parse(previous) as AnalyzeResponse).body : undefined;

  const llm = deps.llm ?? makeGemini(env.GEMINI_API_KEY, deps.fetch, 2);
  const models = env.ANALYZE_MODELS.split(",").map((m) => m.trim()).filter(Boolean);
  let text: string, model: string;
  try {
    const r = await withFallback(llm, models)({
      system: SYSTEM,
      prompt: buildAnalysisPrompt(story, lenses, body.depth, SETTINGS, prevBody),
      temperature: 0.6,
      // כולל טוקני "חשיבה" של המודל, לכן גבוה בהרבה מאורך הטקסט עצמו
      maxOutputTokens: body.depth === "deep" ? 24000 : 16000,
    });
    text = r.text.trim();
    model = r.model;
  } catch (e) {
    const busy = e instanceof LlmError && e.retryable;
    return error(busy ? 503 : 502, busy ? "model_busy" : "model_error", busy ? "המודל עמוס כרגע. נסה שוב בעוד דקה." : "הניתוח נכשל. נסה שוב.");
  }

  const result: AnalyzeResponse = {
    storyId: story.id,
    lensIds,
    depth: body.depth,
    title: lenses.map((l) => l.name).join(" · "),
    body: text,
    label: LABEL,
    model,
    cached: false,
    createdAt: now.toISOString(),
  };
  await env.CACHE.put(key, JSON.stringify(result), { expirationTtl: 400 * 86400 });
  return json(result);
}
