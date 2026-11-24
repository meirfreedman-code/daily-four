import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DAY_SCHEMA_VERSION, DayFile, DayIndex, LensesFile, SourcesFile, makeGemini, withFallback, modelList,
  type LlmFn, type SourceConfig,
} from "@daily-four/shared";
import { fetchAll, type FeedItem, type FeedResult } from "./feeds.js";
import { dedupItems } from "./dedup.js";
import { triage } from "./triage.js";
import { scoreEvents, selectStories, type SelectionRules } from "./select.js";
import { writeStories } from "./write.js";
import { formatFeedReport } from "./report.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "public");

export function localDate(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

async function readJson(p: string) {
  return JSON.parse(await readFile(p, "utf8"));
}

export async function runPipeline(opts: { llm: LlmFn; now?: Date; fetchImpl?: typeof fetch; outDir?: string; log?: (s: string) => void }) {
  const log = opts.log ?? console.log;
  const outDir = opts.outDir ?? OUT;
  const config = await readJson(path.join(ROOT, "config/config.json"));
  const { sources } = SourcesFile.parse(await readJson(path.join(ROOT, "config/sources.json")));
  const { lenses } = LensesFile.parse(await readJson(path.join(ROOT, "config/lenses.json")));
  const now = opts.now ?? new Date();
  const date = localDate(now, config.timezone);
  const srcMap = new Map<string, SourceConfig>(sources.map((s) => [s.id, s]));

  log(`📥 אוסף מ-${sources.filter((s) => s.active).length} מקורות...`);
  const { results, items: raw } = await fetchAll(sources, { lookbackHours: config.lookbackHours, maxItems: config.maxItemsPerSource, now, fetchImpl: opts.fetchImpl });
  const items = dedupItems(raw);
  const itemMap = new Map<string, FeedItem>(items.map((i) => [i.id, i]));
  const ok = results.filter((r) => r.ok).length;
  log(`   ${ok}/${results.length} פידים עובדים, ${raw.length} פריטים, ${items.length} אחרי הסרת כפילויות`);
  if (items.length < 10) throw new Error("נאספו פחות מ-10 פריטים. כנראה בעיית רשת, הצינור נעצר");

  const using = (models: string | string[]): LlmFn => (c) => withFallback(opts.llm, modelList(models))(c);
  log(`🧮 מקבץ ומדרג (${modelList(config.models.triage).join(" → ")})...`);
  const t = await triage(using(config.models.triage), "", items, srcMap);
  log(`   מודל: ${t.usage.model}`);
  log(`   ${t.events.length} אירועים`);

  const rules: SelectionRules = { count: config.storiesPerDay, ...config.selection };
  const scored = scoreEvents(t.events, itemMap, srcMap, rules);
  const chosen = selectStories(scored, rules);
  // קובץ אבחון מקומי (לא מתפרסם): כל האירועים, הציון ומה נבחר
  await writeFile(path.join(ROOT, "pipeline/.last-run.json"), JSON.stringify({
    date, events: t.events.map((e) => ({ ...e, score: scored.find((s) => s.label === e.label)?.score ?? null, chosen: chosen.some((c) => c.label === e.label), titles: e.itemIds.map((id) => itemMap.get(id)?.title) })),
  }, null, 2)).catch(() => {});
  if (!chosen.length) throw new Error("לא נמצאו אירועים מתאימים");

  log(`✍️  כותב ${chosen.length} ידיעות (${modelList(config.models.summarize).join(" → ")})...`);
  const w = await writeStories(using(config.models.summarize), "", date, chosen, itemMap, srcMap, lenses);
  log(`   מודל: ${w.usage.model}`);

  const day = DayFile.parse({
    schemaVersion: DAY_SCHEMA_VERSION,
    date,
    generatedAt: now.toISOString(),
    stories: w.stories,
    stats: { feedsOk: ok, feedsFailed: results.length - ok, itemsCollected: raw.length, eventsFound: t.events.length },
  });

  await mkdir(path.join(outDir, "data"), { recursive: true });
  await writeFile(path.join(outDir, "data", `${date}.json`), JSON.stringify(day, null, 2));
  await writeFile(path.join(outDir, "latest.json"), JSON.stringify(day, null, 2));
  await updateIndex(outDir, day);
  await copyFile(path.join(ROOT, "config/lenses.json"), path.join(outDir, "lenses.json"));
  await writeFile(path.join(outDir, "sources.json"), JSON.stringify(sources.map(({ id, name, lean, lang, region, active }) => ({ id, name, lean, lang, region, active })), null, 2));
  await writeFeedReport(outDir, results, now);

  const usage = {
    triage: { model: t.usage.model, in: t.usage.inputTokens, out: t.usage.outputTokens },
    write: { model: w.usage.model, in: w.usage.inputTokens, out: w.usage.outputTokens },
  };
  log(`✅ נכתב public/data/${date}.json. טוקנים: ${JSON.stringify(usage)}`);
  return { day, results, usage, events: t.events, chosen };
}

async function updateIndex(outDir: string, day: DayFile) {
  const p = path.join(outDir, "index.json");
  let index: DayIndex = { schemaVersion: DAY_SCHEMA_VERSION, latest: day.date, days: [] };
  if (existsSync(p)) {
    const parsed = DayIndex.safeParse(await readJson(p));
    if (parsed.success) index = parsed.data;
  }
  index.days = [{ date: day.date, headlines: day.stories.map((s) => s.headline) }, ...index.days.filter((d) => d.date !== day.date)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 365);
  index.latest = index.days[0].date;
  await writeFile(p, JSON.stringify(index, null, 2));
}

export async function writeFeedReport(outDir: string, results: FeedResult[], now: Date) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "feeds-report.json"), JSON.stringify({ checkedAt: now.toISOString(), results }, null, 2));
  await writeFile(path.join(outDir, "feeds-report.md"), formatFeedReport(results, now));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("חסר GEMINI_API_KEY");
    process.exit(1);
  }
  runPipeline({ llm: makeGemini(key) }).catch((e) => {
    console.error("❌", e.message);
    process.exit(1);
  });
}
