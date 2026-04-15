# AdChat — הקשר פרויקט (CONTEXT)

מסמך זה מסכם את המערכת כפי שהיא משוקפת מהקוד (`server.js`, האפליקציה ב־Expo, ו־Supabase). לעדכן כשמשנים ארכיטקטורה או נתיבים.

---

## מה זה AdChat

**AdChat** הוא מוצר לניהול פרסום דיגיטלי לעסקים קטנים־בינוניים בישראל: צ'אט חכם בעברית, **סוכני AI** (קופי, ניתוח, גרפיקה, תוכן), **אונבורדינג** (כולל סריקת אתר עמוקה ל־JSON עם Claude), **זיכרון לקוח** (`client_memory`) ו־**Brand Kit** מהטבלה `businesses`, אינטגרציה עם **Meta (Facebook) Ads** לנתוני קמפיין והתראות, וספריית **מדיה** לתמונות שנוצרו.

הלקוח (אפליקציה) מדבר עם **שרת Node (Express)** שמרכז קריאות ל־**Anthropic (Claude)** ו־**Google Gemini** (תמונות), ועם **Supabase** (DB + Auth).

---

## הסטאק

| שכבה | טכנולוגיה |
|------|-----------|
| אפליקציה | **Expo** (~54), **expo-router** (~6), **React Native** 0.81, **React** 19 |
| שרת | **Node.js**, **Express** 5, **dotenv**, **cors**, **node-fetch** (fetch גלובלי) |
| Backend / DB | **Supabase** (`@supabase/supabase-js`) — Auth (JWT), Postgres, RLS לפי הגדרות הפרויקט |
| שפה מרכזית (טקסט) | **Anthropic Messages API** — מודל ברירת מחדל: `claude-haiku-4-5-20251001` |
| תמונות | **Gemini** (`generativelanguage.googleapis.com` — `gemini-3.1-flash-image-preview`) |
| אנימציות UI | **react-native-reanimated** ~4.1 |

**הרצה מקומית טיפוסית**

- אפליקציה: `npm run start` (ברירת מחדל Expo, לרוב פורט 8081 ל־web).
- שרת: `npm run server` — **`server.js`** מאזין על פורט **3001** (קבוע בקוד).

**משתנה חשוב ללקוח:** `EXPO_PUBLIC_API_URL` — כתובת בסיס לשרת (ברירת מחדל בקוד: `http://localhost:3001`).

---

## מבנה קבצים חשוב

```
adchat/
├── server.js                 # כל ה-API, סוכנים, Meta, סריקה, תמונות
├── package.json
├── app/                      # expo-router — מסכים
│   ├── _layout.tsx           # Root: Auth, BusinessProvider, ניתוב ציבורי/פרטי
│   ├── auth.tsx
│   ├── reset-password.tsx
│   ├── oauth-success.tsx
│   ├── onboarding.tsx
│   ├── media-library.tsx
│   ├── settings.tsx          # Redirect ל־(tabs)/settings
│   ├── (tabs)/
│   │   ├── _layout.tsx       # טאבים
│   │   ├── index.tsx         # בית / המלצות דנה
│   │   ├── chat.tsx          # צ'אט ראשי + פרוקסי
│   │   ├── campaigns.tsx
│   │   ├── library.tsx
│   │   └── settings.tsx      # הגדרות עסק / Meta / מותג
│   └── campaign/
│       ├── _layout.tsx
│       └── [id].tsx          # פירוט קמפיין Meta
├── contexts/
│   └── business-context.tsx  # עסק נבחר, טעינה מ־Supabase
├── lib/
│   ├── supabase.ts           # לקוח Supabase (URL + anon key בקוד)
│   ├── fetch-adchat-api.ts   # fetch לשרת + Authorization: Bearer (JWT)
│   └── password-validation.ts
├── components/
│   └── password-requirements.tsx
└── supabase/                 # SQL migrations / סכמות (לא רץ אוטומטית)
    ├── *.sql
```

---

## הסוכנים

כל הסוכנים רצים דרך **`runAgentTurn`** ב־`server.js`. אחרי השלמת אונבורדינג, **דנה** משמשת כ־orchestrator עם **זיהוי intent (מילות מפתח)** — השרת מנתב ישירות ליוני/רון/מאיה/נועה (ולעיתים שילוב יוני+רון ל"קמפיין"), במקום handoff טקסטואלי "מעביר אותך…".

| מפתח | שם | תפקיד עיקרי |
|------|-----|-------------|
| `dana` | דנה | מנהלת לקוח, אונבורדינג, JSON עם `memory_updates`, תשובות כלליות כשאין intent ברור |
| `yoni` | יוני | קופי — מודעות, כותרות, CTA (פורמט 3 גרסאות לפי הפרומפט) |
| `ron` | רון | ניתוח PPC / ביצועים / המלצות מובנות |
| `maya` | מאיה | גרפיקה — פלט JSON `{"action":"generate_image","prompt":"...","aspect_ratio":"1:1"}`; השרת מריץ Gemini ומחזיר `image_base64` |
| `noa` | נועה | אסטרטגיית תוכן — לוח פרסומים / קלנדר |

**זיכרון לקוח:** קטגוריות מותרות ב־`POST /api/client-memory`: `business_profile`, `audience`, `brand`, `goals`, `insights`, `preferences`.

---

## Endpoints בשרת (`server.js`)

**הערת אבטחה:** חלק מהנתיבים משתמשים ב־`requireBearerAuthorization` (JWT), וחלקם **לא** — רשום לפי המימוש הנוכחי. בפרודקשן כדאי לאחד מדיניות אימות.

### כללי / בריאות

| שיטה | נתיב | תיאור קצר | אימות |
|------|------|-----------|--------|
| GET | `/health` | בדיקת חיים | לא |

### סריקת אתר

| שיטה | נתיב | תיאור | אימות |
|------|------|--------|--------|
| GET | `/api/scrape-website?business_id=` | סריקה "רדודה" לפי `website` של העסק, שומר `brand.website_content` | Bearer |
| POST | `/api/scrape-website` | גוף: `{ url, business_id }` — סריקה עמוקה (Claude), שמירה ל־`businesses` + `client_memory` | Bearer |

### המלצות / עסק / מדיה / רעיון עונתי

| שיטה | נתיב | תיאור | אימות |
|------|------|--------|--------|
| GET | `/api/dana-recommendations?business_id=` | 3 המלצות (Claude + מטמון DB/זיכרון) | Bearer |
| PATCH | `/api/businesses/:id` | עדכון שורת `businesses` | Bearer |
| GET | `/api/media-library?business_id=` | רשימת פריטי מדיה | Bearer |
| POST | `/api/media-library` | יצירת פריט (כולל `image_base64`) | Bearer |
| DELETE | `/api/media-library/:id` | מחיקה | Bearer |
| POST | `/api/seasonal-campaign-idea` | `{ business_id, event_name, event_date }` — רעיון קמפיין קצר | Bearer |

### שיחות צ'אט (sessions)

| שיטה | נתיב | תיאור | אימות |
|------|------|--------|--------|
| POST | `/api/chat-sessions` | יצירת סשן | Bearer |
| GET | `/api/chat-sessions?business_id=` | רשימת סשנים | Bearer |
| GET | `/api/chat-sessions/:id` | סשן מלא | Bearer |
| PATCH | `/api/chat-sessions/:id` | עדכון `messages` / `title` | Bearer |

### זיכרון לקוח

| שיטה | נתיב | תיאור | אימות |
|------|------|--------|--------|
| GET | `/api/client-memory?business_id=` | `by_category` (+ מטמון בזיכרון שרת) | לא (בקוד הנוכחי) |
| POST | `/api/client-memory` | upsert רשומת זיכרון | לא (בקוד הנוכחי) |

### Meta — הקשר, נכסים, התראות, קמפיינים, OAuth

| שיטה | נתיב | תיאור | אימות |
|------|------|--------|--------|
| GET | `/api/meta-context?business_id=` | תמצית הקשר Meta לעסק | לא |
| POST | `/api/disconnect-meta` | ניתוק טוקן Meta מהעסק | Bearer |
| GET | `/api/meta-assets?business_id=&type=` | `type`: `adaccounts` \| `pages` \| `instagram` | לא |
| PATCH | `/api/meta-selected-assets` | בחירת חשבון מודעות / עמוד / אינסטגרם | לא |
| GET | `/api/alerts?business_id=&limit=` | התראות + `unread_count` | לא |
| POST | `/api/check-alerts` | Cron: `Authorization: Bearer <CRON_SECRET>` | סוד cron |
| GET | `/api/meta-campaign/:campaignId?business_id=&range=` | `range`: 7/14/30 ימים | לא |
| POST | `/api/meta-campaign/:campaignId/pause` | עצירת קמפיין | לא |
| POST | `/api/meta-campaign/:campaignId/activate` | הפעלה | לא |
| POST | `/api/meta-campaign/:campaignId/budget` | `daily_budget_ils` | לא |
| POST | `/api/meta-campaign/:campaignId/duplicate` | שכפול | לא |
| GET | `/auth/meta?business_id=` | URL להתחלת OAuth Meta | Bearer |
| GET | `/auth/meta/callback` | callback של Meta (HTML / redirect ל־`/oauth-success`) | — |

### AI — תמונה וסוכנים

| שיטה | נתיב | תיאור | אימות |
|------|------|--------|--------|
| POST | `/api/generate-image` | `{ prompt, aspect_ratio?, business_id? }` — Gemini | לא (בקוד הנוכחי) |
| POST | `/api/agent` | גוף כולל `agent`, `messages`, `business_id`, וכו' | לא |
| POST | `/api/chat` | כמו agent, ברירת מחדל `dana` | לא |

---

## משתני סביבה (ENV)

השרת טוען **`.env`** דרך `dotenv` (`require("dotenv").config()`).

### חובה להפעלת השרת (ייזרק אם חסר)

| משתנה | תפקיד |
|--------|--------|
| `SUPABASE_URL` | כתובת פרויקט Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` **או** `SUPABASE_ANON_KEY` | מפתח שרת ל־`createClient` (מועדף service role לפעולות admin) |
| `ANTHROPIC_API_KEY` | Claude |
| `GEMINI_API_KEY` | יצירת תמונות |
| `META_APP_SECRET` | OAuth Meta (החלפת קוד לטוקן) |

### אופציונלי / התנהגות

| משתנה | תפקיד |
|--------|--------|
| `META_APP_ID` | ברירת מחדל בקוד: מזהה קבוע אם לא הוגדר |
| `META_CONFIG_ID` | חובה לאפליקציות Meta מסוג Business — מזהה קונפיגורציית Facebook Login |
| `META_REDIRECT_URI` | כתובת callback של OAuth (ברירת מחדל: `http://localhost:3001/auth/meta/callback`) |
| `META_OAUTH_SCOPES` | scopes ל־OAuth (ברירת מחדל: ads_read, ads_management, …) |
| `APP_WEB_ORIGIN` | מקור האפליקציה ל־redirect אחרי Meta (ברירת מחדל `http://localhost:8081`) |
| `ANTHROPIC_MAYA_MODEL` | מודל נפרד למאיה; אם ריק — כמו מודל ברירת המחדל |
| `ENABLE_SUGGESTED_REPLIES` | `0` / `false` — כיבוי הצעות תשובה אחרי תור סוכן |
| `CRON_SECRET` | חובה ל־`POST /api/check-alerts` מבחוץ |
| `ENABLE_ALERTS_CRON` | `0` — כיבוי cron פנימי בשעת עליית השרת |

**הערה:** `META_REDIRECT_URI` נקרא עכשיו מ-ENV (ברירת מחדל `http://localhost:3001/auth/meta/callback`) — לפרודקשן צריך ליישר עם הגדרות אפליקציית Meta ודומיין אמיתי. אם האפליקציה מסוג Business (לא Consumer) חובה להגדיר `META_CONFIG_ID` — אחרת Facebook מפנה ל-`/dialog/oauth/business/` שדורש config_id.

### אפליקציה (Expo)

| משתנה | תפקיד |
|--------|--------|
| `EXPO_PUBLIC_API_URL` | בסיס API לשרת Node |
| `EXPO_PUBLIC_RESET_REDIRECT_URL` | (ב־`auth.tsx`) קישור לאיפוס סיסמה |

**Supabase בלקוח:** `lib/supabase.ts` מכיל כרגע `SUPABASE_URL` ו־`SUPABASE_ANON_KEY` **בקובץ** — לפרודקשן מומלץ להעביר ל־env/build secrets.

---

## בעיות / חוסרים ידועים (פתוחים)

1. **אימות לא אחיד:** חלק מה־API (למשל `/api/chat`, `/api/client-memory`, נתיבי Meta מסוימים) ללא `Bearer` בשרת — סיכון אם השרת חשוף לרשת.
2. **`META_REDIRECT_URI` קשיח** ל־localhost — לא מתאים deployment בלי שינוי קוד או refactor ל־ENV.
3. **`fetch-adchat-api.ts`** מבצע `console.log` על כל בקשה (כולל קיום JWT) — רעש ופוטנציאל דליפת מידע בלוגים בפרודקשן.
4. **מפתחות Supabase בלקוח** בקוד סטטי — לטפל לפני production.
5. **Intent routing** מבוסס מחרוזות — חפיפה בין מילים (למשל "פוסט" מול גרפיקה) עלולה לנתב לא נכון; דורש fine-tuning או LLM-router.
6. **סקריפטי SQL ב־`supabase/`** — יש לוודא שהורצו בפרויקט Supabase ושהטבלאות (`client_memory`, `media_library`, `alerts`, `recommendations_cache`, וכו') קיימות.

---

*עודכן לפי סריקת הקוד בפרויקט; לעדכן את התאריך כשמשנים endpoints או ENV.*
