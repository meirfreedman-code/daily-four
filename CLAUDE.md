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

## אפליקציית התרגילים (`public/drills/`)
פרויקט נפרד באותו repo: PWA סטטי לשרטוט תרגילי כדורסל. JavaScript רגיל (ES modules) בלי build ובלי תלויות, בלי AI ובלי שרת.
- מתפרסם ל-`https://<user>.github.io/daily-four/drills/` דרך `.github/workflows/drills-pages.yml` (push ל-main). מעלה את כל `public` כדי לא למחוק את קבצי החדשות.
- מודל התרגיל (JSON) ב-`js/model.js`. זיהוי צורות ב-`js/recognize.js`, הסבר ב-`js/explain.js` (שתיהן פונקציות טהורות).
- בדיקות: `npm run test:drills`. שינוי ברשימת הקבצים => להוסיף ל-`FILES` ב-`sw.js` ולהעלות `VERSION`. כל שינוי בקבצים => להעלות `VERSION` כדי שהטלפון יתעדכן.
