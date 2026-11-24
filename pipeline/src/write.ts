import { z } from "zod";
import { parseJsonLoose, type LlmFn, type Lens, type SourceConfig, type Story } from "@daily-four/shared";
import type { FeedItem } from "./feeds.js";
import type { ScoredEvent } from "./select.js";

const Written = z.object({
  stories: z.array(
    z.object({
      index: z.number().int(),
      headline: z.string(),
      summary: z.string(),
      whyItMatters: z.string(),
      tag: z.string(),
      lensSuggestions: z.array(z.object({ lensId: z.string(), question: z.string() })),
    }),
  ),
});

const schema = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          headline: { type: "string" },
          summary: { type: "string" },
          whyItMatters: { type: "string" },
          tag: { type: "string" },
          lensSuggestions: {
            type: "array",
            items: {
              type: "object",
              properties: { lensId: { type: "string" }, question: { type: "string" } },
              required: ["lensId", "question"],
            },
          },
        },
        required: ["index", "headline", "summary", "whyItMatters", "tag", "lensSuggestions"],
      },
    },
  },
  required: ["stories"],
};

const SYSTEM = `אתה עורך חדשות שכותב בעברית רהוטה, מדויקת ומאופקת, כמו עיתון איכותי.
כללים מחייבים:
- כתוב הכול בעברית, גם אם המקור באנגלית, בערבית או בשפה אחרת. שמות אנשים ומקומות בכתיב העברי המקובל (למשל: "ארדואן", "ריאד", "וושינגטון").
- השתמש רק בעובדות שמופיעות בכותרות ובתקצירים שקיבלת. אל תוסיף עובדות, מספרים, תאריכים או ציטוטים שאינם שם. אם יש סתירה בין מקורות, ציין זאת.
- נסח מחדש במילים שלך. אל תעתיק משפטים מהמקורות.
- headline: כותרת עניינית, עד 12 מילים, בלי סימני קריאה ובלי קליקבייט.
- summary: 2-3 משפטים.
- whyItMatters: משפט אחד שמסביר את המשמעות לטווח ארוך.
- tag: תג תחום קצר בעברית (מילה או שתיים), למשל "ביטחון", "משפט", "כלכלה", "דיפלומטיה", "חברה", "דת ומדינה".
- lensSuggestions: 2-4 מישורי ניתוח מתוך הרשימה שקיבלת (lensId מדויק), שהכי יאירו את הידיעה. לכל אחד שאלת פתיחה אחת חדה וספציפית לידיעה, שמראה מה המישור יגלה. למשל: "איזה תקדים היסטורי הכי דומה לזה, ובמה הוא שונה?". המישור "media-framing" מתאים רק כשיש כמה מקורות.`;

export function buildWritePrompt(events: ScoredEvent[], items: Map<string, FeedItem>, sources: Map<string, SourceConfig>, lenses: Lens[]): string {
  const lensList = lenses.map((l) => `- ${l.id}: ${l.name} – ${l.description}`).join("\n");
  const blocks = events.map((e, idx) => {
    const lines = e.itemIds.map((id) => {
      const it = items.get(id)!;
      const s = sources.get(it.sourceId);
      return `  * [${s?.name} | ${s?.lean} | ${s?.lang}] ${it.title}${it.description ? ` — ${it.description}` : ""}`;
    });
    return `ידיעה ${idx} (מספר מקורות: ${e.outletCount}):\n${lines.join("\n")}`;
  });
  return `מישורי הניתוח האפשריים:\n${lensList}\n\nכתוב את ${events.length} הידיעות הבאות (index = מספר הידיעה):\n\n${blocks.join("\n\n")}`;
}

export async function writeStories(
  llm: LlmFn,
  model: string,
  date: string,
  events: ScoredEvent[],
  items: Map<string, FeedItem>,
  sources: Map<string, SourceConfig>,
  lenses: Lens[],
): Promise<{ stories: Story[]; usage: { inputTokens: number; outputTokens: number } }> {
  const res = await llm({ model, system: SYSTEM, prompt: buildWritePrompt(events, items, sources, lenses), schema, temperature: 0.3 });
  const parsed = Written.parse(parseJsonLoose(res.text));
  const lensIds = new Set(lenses.map((l) => l.id));
  const stories: Story[] = events.map((e, idx) => {
    const w = parsed.stories.find((s) => s.index === idx);
    if (!w) throw new Error(`המודל לא כתב את ידיעה ${idx}`);
    const storySources = e.itemIds.map((id) => {
      const it = items.get(id)!;
      const s = sources.get(it.sourceId)!;
      return { sourceId: s.id, name: s.name, lean: s.lean, lang: s.lang, title: it.title, url: it.url, publishedAt: it.publishedAt };
    });
    let suggestions = w.lensSuggestions.filter((l) => lensIds.has(l.lensId));
    suggestions = suggestions.filter((l, i) => suggestions.findIndex((x) => x.lensId === l.lensId) === i).slice(0, 4);
    if (e.outletCount < 2) suggestions = suggestions.filter((l) => l.lensId !== "media-framing");
    if (suggestions.length < 2) throw new Error(`ידיעה ${idx}: פחות משתי הצעות מישור תקינות`);
    return {
      id: `${date}-${idx + 1}`,
      rank: idx + 1,
      headline: w.headline.trim(),
      summary: w.summary.trim(),
      whyItMatters: w.whyItMatters.trim(),
      tag: w.tag.trim(),
      topic: e.topic,
      region: e.region,
      singleSource: e.outletCount < 2,
      sources: storySources,
      lensSuggestions: suggestions,
    };
  });
  return { stories, usage: res };
}
