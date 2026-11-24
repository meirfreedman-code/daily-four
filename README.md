# ארבע — אפליקציית חדשות אישית

4 ידיעות ביום, בעברית, ממקורות בספקטרום רחב. לכל ידיעה מוצעים מישורי ניתוח, והניתוח נוצר רק כשלוחצים.

## איך זה בנוי
| חלק | תיקייה | איפה רץ |
|---|---|---|
| צינור יומי | `pipeline/` | GitHub Actions, פעם ביום (`.github/workflows/daily.yml`) |
| פלט (JSON) | `public/` | GitHub Pages |
| נקודת קצה לניתוח | `worker/` | Cloudflare Worker *(שלב 2)* |
| האפליקציה | `app/` | Android (Expo) *(שלב 3)* |
| קוד משותף (schema, לקוח Gemini) | `shared/` | — |

## קבצים שאפשר לערוך בלי לגעת בקוד
- **`config/sources.json`** — מקורות. `active: false` משבית מקור. `weight` (0.5–2) משפיע על הדירוג. `lean` היא הנטייה שמוצגת באפליקציה.
- **`config/lenses.json`** — מישורי ניתוח. מוסיפים אובייקט עם `id`, `name`, `description` ו-`prompt`.
- **`config/config.json`** — כללי בחירה (כמה מאותו נושא, כמה עולמיות) ושמות מודלים (רשימה לפי סדר עדיפות).
- **שעת הריצה** — שורת `cron` ב-`.github/workflows/daily.yml` (בשעון UTC).

## פקודות
```bash
npm install
npm test                 # בדיקות אוטומטיות
npm run feeds:check      # דוח מצב פידים -> public/feeds-report.md
GEMINI_API_KEY=... npm run pipeline   # ריצה מלאה -> public/data/YYYY-MM-DD.json
```
בסביבה שעוברת דרך proxy צריך להוסיף `NODE_USE_ENV_PROXY=1`.

## הצינור, בקצרה
1. איסוף מכל הפידים הפעילים (רק כותרת ותקציר שהפיד חושף, בלי לעקוף חסימות או חומות תשלום).
2. הסרת כפילויות טכניות (אותה כתובת, אותה כותרת מאותו מקור).
3. מודל קטן מקבץ לאירועים ומדרג חשיבות (`triage.ts`).
4. בחירה דטרמיניסטית עם אילוצים (`select.ts`) — נבדקת בבדיקות.
5. מודל חזק יותר כותב כותרת, תקציר, "למה זה חשוב", תג והצעות מישורים (`write.ts`).
6. אימות מול schema גרסתי (`shared/src/index.ts`) וכתיבה ל-`public/`.

## פורמט הפלט (schemaVersion 1)
`public/latest.json`, `public/data/YYYY-MM-DD.json`, `public/index.json` (ארכיון), `public/lenses.json`, `public/feeds-report.md`.
ראו `DayFile` ב-`shared/src/index.ts`.
