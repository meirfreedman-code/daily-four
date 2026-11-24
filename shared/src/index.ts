import { z } from "zod";

/** גרסת ה-schema של קובץ היום. מעלים אותה בכל שינוי לא תואם לאחור. */
export const DAY_SCHEMA_VERSION = 1;

export const Region = z.enum(["israel", "regional", "international"]);
export type Region = z.infer<typeof Region>;

export const SourceConfig = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  lang: z.string().min(2),
  region: Region,
  type: z.string(),
  lean: z.string(),
  weight: z.number().min(0).max(3),
  active: z.boolean(),
});
export type SourceConfig = z.infer<typeof SourceConfig>;

export const SourcesFile = z.object({ sources: z.array(SourceConfig) }).superRefine((v, ctx) => {
  const seen = new Set<string>();
  for (const s of v.sources) {
    if (seen.has(s.id)) ctx.addIssue({ code: "custom", message: `מזהה מקור כפול: ${s.id}` });
    seen.add(s.id);
  }
});

export const Lens = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  icon: z.string().optional(),
  /** core = מישורים מרכזיים; deep = מישורים לא מובנים מאליהם (בכל ידיעה מוצע לפחות אחד) */
  group: z.enum(["core", "deep"]).default("core"),
  description: z.string(),
  prompt: z.string().min(10),
});
export type Lens = z.infer<typeof Lens>;
export const LensesFile = z.object({ lenses: z.array(Lens).min(1) });

export const StorySource = z.object({
  sourceId: z.string(),
  name: z.string(),
  lean: z.string(),
  lang: z.string(),
  title: z.string(),
  url: z.string().url(),
  publishedAt: z.string().optional(),
});
export type StorySource = z.infer<typeof StorySource>;

export const LensSuggestion = z.object({
  lensId: z.string(),
  question: z.string().min(5),
  kind: z.enum(["core", "deep"]).default("core"),
});
export type LensSuggestion = z.infer<typeof LensSuggestion>;

export const Story = z.object({
  id: z.string().regex(/^\d{4}-\d{2}-\d{2}-\d+$/),
  rank: z.number().int().min(1),
  headline: z.string().min(5),
  summary: z.string().min(20),
  whyItMatters: z.string().min(10),
  tag: z.string().min(2),
  topic: z.string(),
  region: Region,
  singleSource: z.boolean(),
  sources: z.array(StorySource).min(1),
  lensSuggestions: z.array(LensSuggestion).min(2).max(5),
});
export type Story = z.infer<typeof Story>;

export const DayFile = z.object({
  schemaVersion: z.literal(DAY_SCHEMA_VERSION),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generatedAt: z.string(),
  stories: z.array(Story).min(1),
  stats: z.object({
    feedsOk: z.number().int(),
    feedsFailed: z.number().int(),
    itemsCollected: z.number().int(),
    eventsFound: z.number().int(),
  }),
});
export type DayFile = z.infer<typeof DayFile>;

export const DayIndex = z.object({
  schemaVersion: z.literal(DAY_SCHEMA_VERSION),
  latest: z.string(),
  days: z.array(z.object({ date: z.string(), headlines: z.array(z.string()) })),
});
export type DayIndex = z.infer<typeof DayIndex>;

/** בקשה ותשובה של נקודת הקצה לניתוח */
export const AnalyzeRequest = z.object({
  storyId: Story.shape.id,
  lensIds: z.array(z.string()).min(1).max(4),
  depth: z.enum(["normal", "deep"]).default("normal"),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequest>;

export const AnalyzeResponse = z.object({
  storyId: z.string(),
  lensIds: z.array(z.string()),
  depth: z.enum(["normal", "deep"]),
  title: z.string(),
  body: z.string(),
  label: z.string(),
  model: z.string(),
  cached: z.boolean(),
  createdAt: z.string(),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponse>;

/** מפתח cache יציב: סדר המישורים לא משנה */
export function analysisCacheKey(storyId: string, lensIds: string[], depth: "normal" | "deep"): string {
  const lenses = [...new Set(lensIds)].sort().join("+");
  return `analysis:v${DAY_SCHEMA_VERSION}:${storyId}:${lenses}:${depth}`;
}

/** מזהה ידיעה -> תאריך הקובץ שלה */
export function storyDate(storyId: string): string {
  return storyId.slice(0, 10);
}
export * from "./gemini.js";
