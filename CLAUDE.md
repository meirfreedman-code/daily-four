# CLAUDE.md

אפליקציית חדשות אישית: 4 ידיעות ביום בעברית + ניתוח לפי דרישה. המשתמש אינו מפתח: הסבר כל פעולה ידנית צעד אחר צעד, ותקשר בעברית.

## מבנה
npm workspaces: `shared/` (zod schema, לקוח Gemini REST), `pipeline/` (צינור יומי, tsx), `worker/` (Cloudflare Worker לניתוח), `app/` (Expo).
הגדרות לעריכה: `config/sources.json`, `config/lenses.json`, `config/config.json`.

## כללים
- מודל: Gemini במסלול החינמי (בחירת המשתמש, בלי תשלום). שמות מודלים רק ב-`config.json`, כרשימה לפי סדר עדיפות (`withFallback`). מודלי Pro/Gemini 4 בתשלום — לא להשתמש.
- אין מפתחות API באפליקציה. המפתח רק ב-GitHub Secrets וב-Worker secrets.
- זכויות יוצרים: רק כותרת+תקציר מהפיד, ניסוח מקורי, תמיד קישור. לא לעקוף חסימות בוטים/חומות תשלום.
- לא להוסיף עובדות שלא במקורות. `singleSource` מסמן ידיעה ממקור יחיד.
- שינוי לא תואם ב-`DayFile` => להעלות `DAY_SCHEMA_VERSION`.

## בדיקות
`npm test` (vitest). לפני commit: `npx -p typescript@5.9 tsc --noEmit -p pipeline`.
בסביבת הענן של Claude: `NODE_USE_ENV_PROXY=1`, ו-`GEMINI_API_KEY=proxy-injected` (ה-proxy מזריק את המפתח בכותרת x-goog-api-key).
