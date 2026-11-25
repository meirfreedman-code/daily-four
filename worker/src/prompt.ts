import type { Lens, Story } from "@daily-four/shared";

export interface AnalysisSettings {
  minWords: number;
  maxWords: number;
  deepMaxWords: number;
}

export const SYSTEM = `אתה אנליסט בכיר, רב-תחומי והוגן, שכותב בעברית רהוטה וחדה לקורא משכיל.
המטרה: להראות לקורא מה המישור (או המישורים) מגלה על הידיעה שלא רואים בכותרת.

כללי יושרה מחייבים:
- הפרד בבירור בין עובדות (מה שמופיע במקורות שסופקו) לבין פרשנות (שלך). אל תציג פרשנות כעובדה.
- אל תמציא ציטוטים, תאריכים, מספרים, שמות או אירועים. ידע היסטורי או תיאורטי כללי מותר, אבל אם אינך בטוח בפרט מסוים, אל תכתוב אותו או ציין במפורש שאינך בטוח.
- כשיש פרשנויות מתחרות, הצג אותן בהגינות, בלי לכפות עמדה פוליטית ובלי להכריע בשם הקורא.
- הודה באי-ודאות: מה עוד לא ידוע ומה עשוי לשנות את התמונה.
- אם הידיעה נשענת על מקור יחיד, ציין זאת.
- כתוב בעברית בלבד. מונח לועזי מותר רק בסוגריים אחרי המונח העברי, למשל: שינוי משטר (Regime Change). אסור לשלב אותיות ערביות או ביטויים באנגלית בתוך משפט עברי.

פורמט (Markdown פשוט בלבד: כותרות ##, פסקאות, **הדגשה**, רשימות עם -):
## מה ידוע
2-3 משפטים עובדתיים בלבד, מתוך המקורות.
## [כותרת משלך שמבטאת את התובנה המרכזית]
גוף הניתוח.
## פרשנויות מתחרות
## מה עוד לא ידוע`;

export function buildAnalysisPrompt(story: Story, lenses: Lens[], depth: "normal" | "deep", s: AnalysisSettings, previous?: string): string {
  const sources = story.sources.map((x) => `- [${x.name} | ${x.lean}] ${x.title}`).join("\n");
  const hints = story.lensSuggestions.filter((l) => lenses.some((x) => x.id === l.lensId)).map((l) => `- ${l.question}`).join("\n");
  const lensBlock = lenses.map((l) => `### ${l.name}\n${l.prompt}`).join("\n\n");
  const combined =
    lenses.length > 1
      ? `זהו ניתוח משולב של ${lenses.length} מישורים. אל תכתוב ניתוח נפרד לכל מישור ברצף. שזור אותם לטיעון אחד: כל פסקה מקדמת רעיון אחד ומשתמשת בכמה מישורים יחד כדי לבסס אותו. אל תפתח פסקאות במילים "במישור ה..." ואל תקצה פסקה לכל מישור. הקדש פסקה מפורשת לשאלה איפה המישורים מחזקים זה את זה ואיפה הם סותרים או מושכים לכיוונים שונים.`
      : `זהו ניתוח במישור אחד.`;
  const length =
    depth === "deep"
      ? `זו גרסה מורחבת ("העמק"), עד ${s.deepMaxWords} מילים. הוסף עומק, דוגמאות ותקדימים, ואל תחזור על מה שכבר נכתב בגרסה הקצרה.${previous ? `\n\nהגרסה הקצרה שהקורא כבר קרא:\n"""\n${previous}\n"""` : ""}`
      : `אורך: ${s.minWords}-${s.maxWords} מילים.`;

  return `הידיעה:
כותרת: ${story.headline}
תקציר: ${story.summary}
למה זה חשוב: ${story.whyItMatters}
${story.singleSource ? "שים לב: הידיעה נשענת על מקור יחיד.\n" : ""}
כותרות המקורות:
${sources}

המישורים לניתוח:
${lensBlock}
${hints ? `\nשאלות פתיחה שהוצעו לקורא (אפשר להיעזר בהן):\n${hints}\n` : ""}
${combined}
${length}`;
}

/** "בחר בשבילי": המישור המרכזי הראשון שהוצע + המישור העמוק שהוצע */
export function autoLenses(story: Story): string[] {
  const core = story.lensSuggestions.find((l) => l.kind !== "deep");
  const deep = story.lensSuggestions.find((l) => l.kind === "deep");
  const ids = [core?.lensId, deep?.lensId].filter((x): x is string => !!x);
  return ids.length ? ids : story.lensSuggestions.slice(0, 2).map((l) => l.lensId);
}
