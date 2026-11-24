/** בדיקת כל הפידים בלי מודל: npm run feeds:check */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourcesFile } from "@daily-four/shared";
import { fetchAll } from "./feeds.js";
import { formatFeedReport } from "./report.js";
import { writeFeedReport } from "./run.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { sources } = SourcesFile.parse(JSON.parse(await readFile(path.join(ROOT, "config/sources.json"), "utf8")));
const now = new Date();
const { results } = await fetchAll(sources.map((s) => ({ ...s, active: true })), { lookbackHours: 30, maxItems: 100, now });
await writeFeedReport(path.join(ROOT, "public"), results, now);
console.log(formatFeedReport(results, now));
