import { z } from "zod";
import { parseJsonLoose, type LlmFn, type SourceConfig, Region } from "@daily-four/shared";
import type { FeedItem } from "./feeds.js";

/** אירוע = קבוצת פריטים ממקורות שונים שמתארים את אותו דבר */
export const TriageEvent = z.object({
  label: z.string(),
  itemIds: z.array(z.string()).min(1),
  topic: z.string(),
  /** קו עלילה מתמשך (slug באנגלית), למשל iran-israel-us. משמש לגיוון: אירוע אחד לכל קו */
  thread: z.string().default(""),
  region: Region,
  importance: z.number().min(0).max(10),
  analyzable: z.boolean(),
});
export type TriageEvent = z.input<typeof TriageEvent>;

export const TOPICS = [
  "security", "diplomacy", "political-maneuvering", "policy-governance", "infrastructure-planning", "bureaucracy",
  "local-government", "law", "economy", "markets", "society", "religion",
  "science-tech", "health", "environment", "culture", "sport", "gossip", "entertainment", "weather", "crime", "other",
] as const;

const schema = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "תיאור קצר בעברית של האירוע" },
          itemIds: { type: "array", items: { type: "string" } },
          topic: { type: "string", enum: [...TOPICS] },
          thread: { type: "string", description: "slug קצר באנגלית לקו העלילה המתמשך" },
          region: { type: "string", enum: ["israel", "regional", "international"] },
          importance: { type: "integer", description: "0-10, חשיבות לטווח ארוך" },
          analyzable: { type: "boolean" },
        },
        required: ["label", "itemIds", "topic", "thread", "region", "importance", "analyzable"],
      },
    },
  },
  required: ["events"],
};

const SYSTEM = `אתה עורך חדשות בכיר ומנוסה. תפקידך למיין ידיעות גולמיות מפידים, לא לכתוב אותן.
כללים:
- קבץ פריטים שמתארים את אותו אירוע (גם אם הם בשפות שונות ובניסוח שונה) לאירוע אחד. אל תקבץ אירועים שונים רק כי הם באותו נושא, באותו תחום או באותה כתבת סיכום. חברות שונות, אנשים שונים או החלטות שונות = אירועים נפרדים.
- region: israel = בעיקר פנים-ישראלי; regional = המזרח התיכון (כולל יחסי ישראל עם שכנותיה, איראן, עזה, לבנון, סוריה, המפרץ, טורקיה, מצרים); international = כל השאר.
- topic: הבחן היטב בין
  * political-maneuvering = פוליטיקה של מגעים, קואליציות, סקרים, הצהרות, פריימריז, ריבים בין פוליטיקאים;
  * policy-governance = החלטות ממשלה, רגולציה, חקיקה ותקציב עם השלכות ממשיות;
  * infrastructure-planning = אישור או עיכוב של פרויקטים גדולים: תחבורה, אנרגיה, דיור, תכנון ובנייה, מים;
  * bureaucracy = כשלים בירוקרטיים, דוחות מבקר, עיכובים ותקלות במנגנוני המדינה שדווחו;
  * markets = תנודות במניות, במדדים ובשערים, דוחות רבעוניים, הנפקות ועסקאות של חברות בודדות (economy שמור למדיניות כלכלית, מאקרו, תקציב, סחר ויוקר מחיה);
  * local-government = החלטות, מדיניות ומחלוקות ברשויות מקומיות, ובמיוחד התנגשויות ערכיות (דת ומדינה בעיר, מרחב ציבורי, קהילות). תקרית (פיגוע, תאונה, תקיפה של חיה) אינה local-government אלא אם היא עוסקת בהחלטה או במחלוקת על מדיניות.
- thread: מזהה קצר באנגלית לקו העלילה המתמשך שהאירוע שייך אליו (למשל iran-israel-us, us-trade-war, russia-ukraine, israel-coalition-talks). אירועים שונים מאותו סיפור מתמשך יקבלו אותו thread.
- region: אירוע שמעורבים בו ישראל או מדינה מהמזרח התיכון (כולל איראן) הוא regional גם אם הדיווח מגיע מוושינגטון.
- חשוב: הקורא מעדיף מדיניות, כלכלה וממשל בפועל על פני "פוליטיקה של מגעים". לכן הקפד לכלול ברשימת 30 האירועים גם אירועים קטנים יותר מסוג policy-governance, infrastructure-planning, bureaucracy ו-local-government, גם אם דווחו במקור אחד.
- importance: חשיבות לטווח ארוך (שבועות-שנים), לא רעש יומי. 9-10 = אירוע היסטורי; 7-8 = משמעותי מאוד; 4-6 = חשוב; 0-3 = רעש: תנודות יומיות בבורסה ובמניות (אלא אם מדובר במשבר פיננסי של ממש), פלילים שגרתיים, הצהרות חסרות השלכה, סקרים, טורי דעה בודדים.
- analyzable=false לספורט, רכילות, בידור, מזג אוויר, פלילים שגרתיים ותאונות, ולכל מה שאין בו עומק לניתוח.
- החזר רק את 30 האירועים החשובים ביותר, ממוינים מהחשוב לפחות חשוב. השתמש רק במזהי פריטים שקיבלת.`;

export function buildTriagePrompt(items: FeedItem[], sources: Map<string, SourceConfig>): string {
  const lines = items.map((i) => {
    const s = sources.get(i.sourceId);
    const desc = i.description ? ` | ${i.description.slice(0, 160)}` : "";
    return `${i.id} [${s?.name ?? i.sourceId}, ${s?.lang ?? "?"}] ${i.title}${desc}`;
  });
  return `להלן ${items.length} פריטים מפידי חדשות מ-24 השעות האחרונות. קבץ אותם לאירועים ודרג.\n\n${lines.join("\n")}`;
}

/** מנקה את פלט המודל: מסיר מזהים לא קיימים, ופריט שמופיע בכמה אירועים נשאר רק בראשון */
export function sanitizeEvents(raw: unknown, validIds: Set<string>): TriageEvent[] {
  const parsed = z.object({ events: z.array(z.unknown()) }).safeParse(raw);
  if (!parsed.success) throw new Error("פלט המיון אינו בפורמט הצפוי");
  const used = new Set<string>();
  const out: TriageEvent[] = [];
  for (const e of parsed.data.events) {
    const ev = TriageEvent.safeParse(e);
    if (!ev.success) continue;
    const ids = [...new Set(ev.data.itemIds)].filter((id) => validIds.has(id) && !used.has(id));
    if (!ids.length) continue;
    ids.forEach((id) => used.add(id));
    out.push({ ...ev.data, itemIds: ids });
  }
  return out;
}

export async function triage(llm: LlmFn, model: string, items: FeedItem[], sources: Map<string, SourceConfig>) {
  const res = await llm({ model, system: SYSTEM, prompt: buildTriagePrompt(items, sources), schema, temperature: 0.1, maxOutputTokens: 32000 });
  const events = sanitizeEvents(parseJsonLoose(res.text), new Set(items.map((i) => i.id)));
  return { events, usage: res };
}
