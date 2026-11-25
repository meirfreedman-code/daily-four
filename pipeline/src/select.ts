import type { SourceConfig } from "@daily-four/shared";
import type { FeedItem } from "./feeds.js";
import type { TriageEvent } from "./triage.js";

export interface SelectionRules {
  count: number;
  maxPerTopic: number;
  maxPerRegion: number;
  /** כמה ידיעות לפחות מחוץ לישראל והאזור (region=international) */
  minInternational: number;
  excludeTopics: string[];
  multiSourceBonus: number;
  minImportance: number;
  /** תוספת/הפחתה לציון לפי נושא (מ-config) */
  topicAdjust?: Record<string, number | string>;
  /** לכל היותר כמה אירועים מאותו קו עלילה (ברירת מחדל 1) */
  maxPerThread?: number;
  /** לפחות כמה ידיעות מסוגי policyTopics (מדיניות, תשתיות, בירוקרטיה, רשות מקומית) */
  minPolicy?: number;
  policyTopics?: string[];
}

export interface ScoredEvent extends TriageEvent {
  score: number;
  outletCount: number;
}

/** מספר כלי תקשורת שונים (ynet ו-ynet עולם נספרים כאחד) */
export function outletCount(ev: TriageEvent, items: Map<string, FeedItem>): number {
  const outlets = new Set<string>();
  for (const id of ev.itemIds) {
    const it = items.get(id);
    if (it) outlets.add(it.sourceId.split("-")[0]);
  }
  return outlets.size;
}

export function scoreEvents(
  events: TriageEvent[],
  items: Map<string, FeedItem>,
  sources: Map<string, SourceConfig>,
  rules: SelectionRules,
): ScoredEvent[] {
  return events
    .filter((e) => e.analyzable && !rules.excludeTopics.includes(e.topic) && e.importance >= rules.minImportance)
    .map((e) => {
      const n = outletCount(e, items);
      const weights = e.itemIds.map((id) => sources.get(items.get(id)?.sourceId ?? "")?.weight ?? 1);
      const avgWeight = weights.reduce((a, b) => a + b, 0) / Math.max(1, weights.length);
      // בונוס לוגריתמי לריבוי מקורות: 2 מקורות = +1, 4 = +2 ...
      const adj = Number(rules.topicAdjust?.[e.topic] ?? 0) || 0;
      const score = e.importance + rules.multiSourceBonus * Math.log2(Math.max(1, n)) + (avgWeight - 1) + adj;
      return { ...e, score, outletCount: n };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * בחירה חמדנית עם אילוצים:
 * - לכל היותר maxPerTopic מאותו נושא ו-maxPerRegion מאותו אזור (international לא מוגבל כאזור)
 * - לפחות minInternational ידיעות בינלאומיות (שומרים להן מקום מראש)
 */
export function selectStories(scored: ScoredEvent[], rules: SelectionRules): ScoredEvent[] {
  const chosen: ScoredEvent[] = [];
  const topicCount = new Map<string, number>();
  const regionCount = new Map<string, number>();
  const threadCount = new Map<string, number>();
  const canAdd = (e: ScoredEvent) =>
    (!e.thread || (threadCount.get(e.thread) ?? 0) < (rules.maxPerThread ?? 1)) &&
    (topicCount.get(e.topic) ?? 0) < rules.maxPerTopic &&
    (e.region === "international" || (regionCount.get(e.region) ?? 0) < rules.maxPerRegion);
  const add = (e: ScoredEvent) => {
    chosen.push(e);
    topicCount.set(e.topic, (topicCount.get(e.topic) ?? 0) + 1);
    regionCount.set(e.region, (regionCount.get(e.region) ?? 0) + 1);
    if (e.thread) threadCount.set(e.thread, (threadCount.get(e.thread) ?? 0) + 1);
  };

  // שלב א: הבינלאומיות הטובות ביותר עד המכסה המינימלית
  for (const e of scored) {
    if (chosen.filter((c) => c.region === "international").length >= rules.minInternational) break;
    if (e.region === "international" && canAdd(e)) add(e);
  }
  // שלב א2: ידיעות מדיניות עד המכסה המינימלית
  const policy = new Set(rules.policyTopics ?? []);
  for (const e of scored) {
    if (chosen.filter((c) => policy.has(c.topic)).length >= (rules.minPolicy ?? 0)) break;
    if (chosen.length >= rules.count) break;
    if (policy.has(e.topic) && !chosen.includes(e) && canAdd(e)) add(e);
  }
  // שלב ב: השאר לפי ציון
  for (const e of scored) {
    if (chosen.length >= rules.count) break;
    if (!chosen.includes(e) && canAdd(e)) add(e);
  }
  // שלב ג: אם האילוצים השאירו מקום ריק, ממלאים בלי מגבלת נושא/אזור (עדיף 4 ידיעות מ-3)
  for (const e of scored) {
    if (chosen.length >= rules.count) break;
    if (!chosen.includes(e)) chosen.push(e);
  }
  return chosen.sort((a, b) => b.score - a.score);
}
