/**
 * הרצה מקומית של ה-Worker מול Gemini אמיתי, עם הנתונים מ-public/ ו-KV בזיכרון.
 * שימוש: GEMINI_API_KEY=... tsx scripts/local.ts <storyId> <lens1,lens2,...> [deep]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handle, type KV } from "../src/handler.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const kv = new Map<string, string>();
const CACHE: KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) };
const fetchLocal: typeof fetch = async (input, init) => {
  const u = String(input);
  if (u.startsWith("https://data.local/")) {
    try {
      return new Response(await readFile(path.join(ROOT, "public", u.slice("https://data.local/".length)), "utf8"), { status: 200 });
    } catch {
      return new Response("nf", { status: 404 });
    }
  }
  return fetch(input, init);
};
const config = JSON.parse(await readFile(path.join(ROOT, "config/config.json"), "utf8"));
const env = {
  CACHE, APP_TOKEN: "local", GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "", DATA_BASE_URL: "https://data.local",
  ANALYZE_MODELS: config.models.analyze.join(","), MAX_PER_DAY: "50", MAX_PER_MINUTE: "50",
};
const [storyId, lenses, depth] = process.argv.slice(2);
const call = async (d: string) => {
  const t = Date.now();
  const res = await handle(new Request("https://w/analyze", { method: "POST", headers: { Authorization: "Bearer local" }, body: JSON.stringify({ storyId, lensIds: lenses.split(","), depth: d }) }), env, { fetch: fetchLocal, now: () => new Date() });
  const body = await res.json() as any;
  console.log(`--- HTTP ${res.status} · ${((Date.now() - t) / 1000).toFixed(1)}s · cached=${body.cached} · model=${body.model}`);
  return body;
};
const r = await call("normal");
if (r.body) {
  console.log(`# ${r.title}\n${r.label}\n\n${r.body}\n\nמילים: ${r.body.split(/\s+/).length}`);
  await call("normal"); // אמור להגיע מה-cache
}
if (depth === "deep" && r.body) {
  const d = await call("deep");
  console.log(`\n# העמק\n${d.body}\n\nמילים: ${d.body?.split(/\s+/).length}`);
}
