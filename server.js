require("dotenv").config();
/* eslint-disable no-console */

console.log(
  "[Puls. server] נתיבים צפויים: GET /health | GET /api/meta-context | GET /api/alerts | GET /api/client-memory | POST /api/client-memory | POST /api/check-alerts | POST /api/agent | POST /api/generate-image | GET /api/meta-campaign/:id | POST /api/meta-campaign/:id/* | GET /auth/meta | GET /auth/meta/callback | POST /api/chat",
);

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const { Resend } = require("resend");

// In-memory cache (simple TTL)
const cache = new Map();

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data, ttlMs) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function deleteCached(key) {
  cache.delete(key);
}

function deleteCachedByPrefix(prefix) {
  for (const k of cache.keys()) {
    if (String(k).startsWith(prefix)) cache.delete(k);
  }
}

// --- Leads caching ---
const leadsCache = new Map();
const LEADS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getLeadsCache(businessId, filters = "") {
  const key = `leads:${businessId}:${filters}`;
  const cached = leadsCache.get(key);
  if (cached && Date.now() - cached.ts < LEADS_CACHE_TTL) return cached.data;
  return null;
}

function setLeadsCache(businessId, filters = "", data) {
  const key = `leads:${businessId}:${filters}`;
  leadsCache.set(key, { data, ts: Date.now() });
}

function invalidateLeadsCache(businessId) {
  for (const key of leadsCache.keys()) {
    if (key.startsWith(`leads:${businessId}`)) leadsCache.delete(key);
  }
}

const leadsStatsCache = new Map();
const LEADS_STATS_TTL = 60 * 60 * 1000; // 1 hour

function getLeadsStatsCache(businessId) {
  const cached = leadsStatsCache.get(businessId);
  if (cached && Date.now() - cached.ts < LEADS_STATS_TTL) return cached.data;
  return null;
}

function setLeadsStatsCache(businessId, data) {
  leadsStatsCache.set(businessId, { data, ts: Date.now() });
}

function hashText(s) {
  return crypto.createHash("sha1").update(String(s || ""), "utf8").digest("hex");
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload;
  } catch { return null; }
}

function stripHtmlTags(html) {
  const s = String(html || "");
  // remove scripts/styles
  const noScripts = s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  // drop tags, keep spaces
  return noScripts
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetaContent(html, nameOrProp) {
  const h = String(html || "");
  const re = new RegExp(
    `<meta\\s+[^>]*(?:name|property)=[\"']${nameOrProp}[\"'][^>]*content=[\"']([^\"']+)[\"'][^>]*>`,
    "i",
  );
  const m = h.match(re);
  return m && m[1] ? String(m[1]).trim() : "";
}

function extractTitle(html) {
  const h = String(html || "");
  const m = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m && m[1] ? stripHtmlTags(m[1]).slice(0, 120) : "";
}

function extractColorPalette(html) {
  const h = String(html || "");
  const hexes = h.match(/#[0-9a-fA-F]{6}\b/g) || [];
  const counts = new Map();
  for (const c of hexes) {
    const k = String(c).toUpperCase();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([c]) => c);
}

function extractRelevantText(html) {
  const h = String(html || "");
  const chunks = [];
  const tagRe = /<(h1|h2|h3|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = tagRe.exec(h))) {
    const t = stripHtmlTags(m[2]);
    if (t && t.length >= 25) chunks.push(t);
    if (chunks.length >= 40) break;
  }
  // de-dupe, keep order
  const seen = new Set();
  const out = [];
  for (const c of chunks) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.join("\n").length > 2200) break;
  }
  return out.join("\n");
}

async function scrapeWebsite(url) {
  const u = String(url || "").trim();
  if (!u) throw new Error("חסר website");
  const full = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  const res = await fetch(full, {
    headers: {
      "user-agent":
        "PulsBot/1.0 (+https://puls) Node.js server-side website scrape",
      accept: "text/html,application/xhtml+xml",
    },
  });
  const html = await res.text();
  if (!res.ok) {
    throw new Error(`Website fetch failed (${res.status})`);
  }
  const title = extractTitle(html);
  const description =
    extractMetaContent(html, "description") ||
    extractMetaContent(html, "og:description") ||
    "";
  const colors = extractColorPalette(html);
  const content = extractRelevantText(html);
  return {
    title,
    description: String(description || "").slice(0, 300),
    colors,
    content,
  };
}

// node-fetch v3 הוא ESM; עטיפה זו מאפשרת שימוש ב-require/server.js.
const fetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));

const WEBSITE_SCRAPE_SOURCE = "website_scrape";

async function fetchHtmlWithTimeout(url, timeoutMs = 10000) {
  const u = String(url || "").trim();
  if (!u) throw new Error("חסר url");
  const full = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(full, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });
    const html = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { html, finalUrl: full };
  } finally {
    clearTimeout(tid);
  }
}

function parseTargetAgeRange(raw) {
  const t = String(raw || "").trim();
  let min = 18;
  let max = 65;
  const m = t.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
  if (m) {
    min = Math.max(18, Math.min(80, parseInt(m[1], 10)));
    max = Math.max(min, Math.min(80, parseInt(m[2], 10)));
    return { min, max };
  }
  const p = t.match(/(\d{1,2})\s*\+/);
  if (p) {
    min = Math.max(18, Math.min(80, parseInt(p[1], 10)));
    return { min, max: 65 };
  }
  return { min, max };
}

function mapTargetGenderToBusinessDb(g) {
  const t = String(g || "").toLowerCase();
  if (t.includes("גבר")) return "men";
  if (t.includes("אשה") || t.includes("נשים") || t.includes("נקבה")) return "women";
  return "all";
}

function mapFontsStyleToBrandFont(fs) {
  const s = String(fs || "").toLowerCase();
  if (s.includes("מודרני") || s.includes("modern")) return "Modern";
  if (s.includes("קלאסי") || s.includes("classic")) return "Classic";
  if (s.includes("bold") || s.includes("מודגש")) return "Bold";
  return "Minimal";
}

function jsonArrStr(v) {
  if (!Array.isArray(v)) return "";
  const out = v.map((x) => String(x || "").trim()).filter(Boolean);
  if (!out.length) return "";
  return JSON.stringify(out);
}

async function applyWebsiteDeepScrapeToDatabase(businessId, websiteUrl, analysis) {
  const bid = String(businessId);
  if (!isUuid(bid) || !analysis || typeof analysis !== "object") return;
  const a = analysis;
  const str = (x) => (x == null ? "" : String(x).trim());
  const addrLine = [str(a.address), str(a.city)].filter(Boolean).join(", ");
  const { min: ageMin, max: ageMax } = parseTargetAgeRange(a.target_age);
  const colors = Array.isArray(a.brand_colors)
    ? a.brand_colors.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8)
    : [];
  const brandColorsObj =
    colors.length >= 3
      ? { primary: colors[0], secondary: colors[1], text: colors[2], palette: colors }
      : colors.length > 0
        ? {
            primary: colors[0],
            secondary: colors[1] || colors[0],
            text: colors[2] || "#111827",
            palette: colors,
          }
        : null;
  const toneStr = str(a.brand_tone);
  const toneArr = toneStr ? [toneStr] : null;
  const compList = (Array.isArray(a.competitors_mentioned) ? a.competitors_mentioned : [])
    .map((x) => ({ name: String(x || "").trim() }))
    .filter((c) => c.name)
    .slice(0, 5);
  const businessName = str(a.business_name) || "עסק חדש";
  const industry = str(a.industry);
  const site =
    str(a.website) || (websiteUrl && String(websiteUrl).trim()) || null;

  await supabaseAdmin
    .from("businesses")
    .update({
      name: businessName,
      website: site,
      phone: str(a.phone) || null,
      address: addrLine || str(a.address) || null,
      description: str(a.description) || null,
      industry: industry || null,
      brand_colors: brandColorsObj,
      brand_font: mapFontsStyleToBrandFont(a.fonts_style),
      brand_tone: toneArr,
      target_age_min: ageMin,
      target_age_max: ageMax,
      target_gender: mapTargetGenderToBusinessDb(a.target_gender),
      target_geo: str(a.target_location) || null,
      brand_differentiator: str(a.unique_value) || null,
      competitors: compList.length ? compList : null,
    })
    .eq("id", bid);

  const overview = [businessName, industry, str(a.description)]
    .filter(Boolean)
    .join(" — ")
    .slice(0, 600);
  const primaryGoal =
    str(a.main_cta) || (Array.isArray(a.key_messages) && a.key_messages[0]
      ? String(a.key_messages[0])
      : "צמיחה דיגיטלית");

  const memSpecs = [
    ["business_profile", "business_name", businessName],
    ["business_profile", "tagline", str(a.tagline)],
    ["business_profile", "description", str(a.description)],
    ["business_profile", "industry", industry],
    ["business_profile", "services", jsonArrStr(a.services)],
    ["business_profile", "products", jsonArrStr(a.products)],
    ["business_profile", "scrape_confirmed", "false"],
    ["business_profile", "onboarding_source", "website_scrape"],
    ["business_profile", "business_overview", overview],
    ["audience", "target_audience", str(a.target_audience)],
    ["audience", "target_age", str(a.target_age)],
    ["audience", "target_gender", str(a.target_gender)],
    ["audience", "target_location", str(a.target_location)],
    ["audience", "target_interests", jsonArrStr(a.target_interests)],
    ["audience", "ideal_customer", str(a.target_audience)],
    ["brand", "brand_colors", jsonArrStr(a.brand_colors)],
    ["brand", "brand_style", str(a.brand_style)],
    ["brand", "brand_tone_text", toneStr],
    ["brand", "key_messages", jsonArrStr(a.key_messages)],
    ["brand", "main_cta", str(a.main_cta)],
    ["brand", "competitive_advantage", str(a.unique_value)],
    ["goals", "has_ecommerce", a.has_ecommerce === true ? "true" : "false"],
    ["goals", "has_booking", a.has_booking === true ? "true" : "false"],
    ["goals", "pain_points", jsonArrStr(a.pain_points)],
    ["goals", "primary_ad_goal", primaryGoal],
    ["goals", "monthly_budget", "לא צוין"],
    ["insights", "keywords", jsonArrStr(a.keywords)],
    ["insights", "seasonal_relevance", str(a.seasonal_relevance)],
    ["insights", "promotions", jsonArrStr(a.promotions)],
    ["insights", "competitors_mentioned", jsonArrStr(a.competitors_mentioned)],
    ["insights", "active_campaigns", "לא ידוע"],
    [
      "insights",
      "social_links",
      a.social_links && typeof a.social_links === "object"
        ? JSON.stringify(a.social_links)
        : "",
    ],
    ["preferences", "price_range", str(a.price_range)],
    ["preferences", "years_in_business", str(a.years_in_business)],
    ["preferences", "certifications", jsonArrStr(a.certifications)],
  ];

  const now = new Date().toISOString();
  for (const [category, key, value] of memSpecs) {
    if (!CLIENT_MEMORY_CATEGORIES.has(String(category))) continue;
    const v = String(value ?? "").trim();
    if (!v) continue;
    if (v === "[]" || v === "{}" || v === "null") continue;
    await supabaseAdmin.from("client_memory").upsert(
      {
        business_id: bid,
        category: String(category),
        key: String(key),
        value: v,
        source: WEBSITE_SCRAPE_SOURCE,
        confidence: 90,
        updated_at: now,
      },
      { onConflict: "business_id,category,key" },
    );
  }

  const websiteContentPayload = {
    title: businessName,
    description: str(a.description),
    colors,
    content: [str(a.tagline), jsonArrStr(a.key_messages)].filter(Boolean).join("\n"),
    deep: a,
  };
  await supabaseAdmin.from("client_memory").upsert(
    {
      business_id: bid,
      category: "brand",
      key: "website_content",
      value: JSON.stringify(websiteContentPayload),
      source: WEBSITE_SCRAPE_SOURCE,
      confidence: 90,
      updated_at: now,
    },
    { onConflict: "business_id,category,key" },
  );

  deleteCached(`mem:${bid}`);
  deleteCached(`website:${bid}`);
  deleteCached(`dana-rec:${bid}`);
}

const PORT = parseInt(process.env.PORT || "3001", 10);
const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const FROM_EMAIL = process.env.FROM_EMAIL || "Puls. <noreply@puls.co.il>";
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const SERVER_START_TIME = Date.now();

function requireEnv(name) {
  const v = String(process.env[name] ?? "").trim();
  if (!v) {
    throw new Error(
      `[Puls. server] חסר משתנה סביבה חובה: ${name}. הוסף אותו לקובץ .env והפעל מחדש את השרת.`,
    );
  }
  return v;
}

function requireSupabaseServerKey() {
  const sr = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const anon = String(process.env.SUPABASE_ANON_KEY ?? "").trim();
  if (sr) return sr;
  if (anon) return anon;
  throw new Error(
    "[Puls. server] חסר SUPABASE_SERVICE_ROLE_KEY או SUPABASE_ANON_KEY (אחד מהם חובה).",
  );
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVER_KEY = requireSupabaseServerKey();
const ANTHROPIC_API_KEY = requireEnv("ANTHROPIC_API_KEY");
const GEMINI_API_KEY = requireEnv("GEMINI_API_KEY");
const META_APP_SECRET = requireEnv("META_APP_SECRET");

const META_APP_ID = process.env.META_APP_ID || "950143061210639";
const META_CONFIG_ID = process.env.META_CONFIG_ID || "";
const META_REDIRECT_URI =
  process.env.META_REDIRECT_URI || "https://localhost:3002/auth/meta/callback";
const APP_WEB_ORIGIN = process.env.APP_WEB_ORIGIN || "http://localhost:8081";
/** Standard Facebook Login (dialog/oauth) */
const META_OAUTH_SCOPES =
  process.env.META_OAUTH_SCOPES ||
  "ads_read,ads_management,business_management,public_profile";
const GRAPH_API_VERSION = "v21.0";
/** אימות ל-cron: Authorization: Bearer <CRON_SECRET> */
const CRON_SECRET = process.env.CRON_SECRET || "";

function sanitizeHeaderValue(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

/** תשובות מוצעות: קריאה שנייה ל-Claude. ENABLE_SUGGESTED_REPLIES=0 לכיבוי גלובלי; או skip_suggested_replies בגוף הבקשה. */
function isSuggestedRepliesEnabled(body) {
  if (body && body.skip_suggested_replies === true) return false;
  const v = String(process.env.ENABLE_SUGGESTED_REPLIES ?? "1")
    .trim()
    .toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVER_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

function parseCompetitorsList(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  const parts = s
    .split(/\n|,|;|•|·|–|-+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  // עד 3, כמו במסך ההגדרות
  return parts.slice(0, 3);
}

function guessTargetGenderFromText(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("נשים") || s.includes("female") || s.includes("women"))
    return "women";
  if (s.includes("גברים") || s.includes("male") || s.includes("men"))
    return "men";
  return "all";
}

async function patchBusiness(businessId, patch) {
  const clean = patch && typeof patch === "object" ? patch : {};
  const { error } = await supabaseAdmin
    .from("businesses")
    .update(clean)
    .eq("id", String(businessId));
  if (error) {
    console.warn("[businesses] update:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

function buildGraphUrl(path, accessToken, extraParams = {}) {
  const p = path.startsWith("/") ? path : `/${path}`;
  const u = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}${p}`,
  );
  u.searchParams.set("access_token", accessToken);
  u.searchParams.set("limit", "100");
  for (const [k, v] of Object.entries(extraParams)) {
    if (v != null && v !== "") u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function fetchJson(url) {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

/** עוקב אחרי paging.next של Graph API */
async function graphFetchEdgeList(firstUrl, logLabel) {
  const items = [];
  let url = firstUrl;
  while (url) {
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(
        `[Meta Graph] ${logLabel || "request"}:`,
        json.error?.message || json.error || res.status,
      );
      break;
    }
    if (Array.isArray(json.data)) items.push(...json.data);
    url = json.paging?.next || null;
  }
  return items;
}

function normalizeAdAccountId(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const idPart = s.replace(/^act_/i, "");
  if (!/^\d+$/.test(idPart)) return null;
  return `act_${idPart}`;
}

function pickAdAccountId(selected, idsJson) {
  const list = Array.isArray(idsJson)
    ? idsJson.map((x) => {
        // Handle both plain string IDs and {id, name} objects
        if (x && typeof x === "object" && x.id) return String(x.id);
        return String(x || "");
      }).filter(Boolean)
    : [];
  const norm = (x) => normalizeAdAccountId(x);
  const sel = norm(selected);
  if (sel && list.some((x) => norm(x) === sel)) return sel;
  return norm(list[0]);
}

async function fetchMetaContextForBusiness(businessId) {
  const empty = {
    connected: false,
    reason: null,
    ad_account_id: null,
    currency: "ILS",
    today: { spend: 0, clicks: 0 },
    active_campaigns_count: 0,
    campaigns: [],
    spend_last_7_days: [],
    graph_error: null,
    brand: null,
    token_expiry_warning: null,
  };

  const { data: row, error } = await supabaseAdmin
    .from("businesses")
    .select(
      "meta_access_token, meta_token_expires_at, meta_ad_account_ids, selected_ad_account_id, brand_logo, brand_colors, brand_font, brand_tone, brand_avoid, target_age_min, target_age_max, target_gender, target_geo, competitors, brand_differentiator, phone, address, description",
    )
    .eq("id", businessId)
    .maybeSingle();

  if (error || !row) {
    return { ...empty, reason: "עסק לא נמצא" };
  }

  const brand = {
    brand_logo: row.brand_logo ?? null,
    brand_colors: row.brand_colors ?? null,
    brand_font: row.brand_font ?? null,
    brand_tone: row.brand_tone ?? null,
    brand_avoid: row.brand_avoid ?? null,
    target_age_min: row.target_age_min ?? null,
    target_age_max: row.target_age_max ?? null,
    target_gender: row.target_gender ?? null,
    target_geo: row.target_geo ?? null,
    competitors: row.competitors ?? null,
    brand_differentiator: row.brand_differentiator ?? null,
    phone: row.phone ?? null,
    address: row.address ?? null,
    description: row.description ?? null,
  };

  const token = row.meta_access_token;
  if (!token || String(token).trim() === "") {
    return { ...empty, reason: "אין חיבור Meta", brand };
  }

  const actId = pickAdAccountId(
    row.selected_ad_account_id,
    row.meta_ad_account_ids,
  );
  if (!actId) {
    return { ...empty, reason: "אין חשבון מודעות מחובר", brand };
  }

  const accessToken = String(token);

  const campaigns = await graphFetchEdgeList(
    buildGraphUrl(`/${actId}/campaigns`, accessToken, {
      fields: "id,name,status,daily_budget,lifetime_budget,objective",
    }),
    `${actId}/campaigns`,
  );

  const todayUrl = buildGraphUrl(`/${actId}/insights`, accessToken, {
    fields: "spend,clicks,impressions,actions",
    date_preset: "today",
  });
  const todayRes = await fetch(todayUrl);
  const todayJson = await todayRes.json().catch(() => ({}));

  const weekUrl = buildGraphUrl(`/${actId}/insights`, accessToken, {
    fields: "spend",
    date_preset: "last_7d",
    time_increment: "1",
  });
  const weekRes = await fetch(weekUrl);
  const weekJson = await weekRes.json().catch(() => ({}));

  let todaySpend = 0;
  let todayClicks = 0;
  let todayLeads = 0;
  if (todayRes.ok && Array.isArray(todayJson.data) && todayJson.data[0]) {
    const t0 = todayJson.data[0];
    todaySpend = parseFloat(String(t0.spend ?? "0")) || 0;
    todayClicks = parseInt(String(t0.clicks ?? "0"), 10) || 0;
    if (Array.isArray(t0.actions)) {
      for (const act of t0.actions) {
        if (act.action_type === "lead" || act.action_type === "onsite_conversion.lead_grouped" || act.action_type === "offsite_conversion.fb_pixel_lead") {
          todayLeads += parseInt(act.value || "0", 10) || 0;
        }
      }
    }
  }

  let spendSeries = [];
  if (weekRes.ok && Array.isArray(weekJson.data)) {
    spendSeries = weekJson.data.map((r) => ({
      date_start: r.date_start,
      date_stop: r.date_stop,
      spend: parseFloat(String(r.spend ?? "0")) || 0,
    }));
  }
  spendSeries.sort((a, b) =>
    String(a.date_start || "").localeCompare(String(b.date_start || "")),
  );

  const activeCount = campaigns.filter(
    (c) => String(c.status || "").toUpperCase() === "ACTIVE",
  ).length;

  const graphError =
    todayJson.error?.message ||
    weekJson.error?.message ||
    null;

  // Check token expiry
  let token_expiry_warning = null;
  if (row.meta_token_expires_at) {
    const expiresAt = new Date(row.meta_token_expires_at);
    const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    if (daysLeft < 7) {
      token_expiry_warning = { days_left: Math.max(0, daysLeft), expires_at: row.meta_token_expires_at };
    }
  }

  return {
    connected: true,
    reason: null,
    ad_account_id: actId,
    currency: "ILS",
    token_expiry_warning,
    today: { spend: todaySpend, clicks: todayClicks, leads: todayLeads },
    active_campaigns_count: activeCount,
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      daily_budget: c.daily_budget,
      lifetime_budget: c.lifetime_budget,
      objective: c.objective,
    })),
    spend_last_7_days: spendSeries,
    graph_error: graphError,
    brand,
  };
}

async function getBusinessMetaAccess(businessId) {
  const { data: row, error } = await supabaseAdmin
    .from("businesses")
    .select("meta_access_token, meta_ad_account_ids, selected_ad_account_id")
    .eq("id", businessId)
    .maybeSingle();
  if (error || !row?.meta_access_token) return null;
  const actId = pickAdAccountId(
    row.selected_ad_account_id,
    row.meta_ad_account_ids,
  );
  if (!actId) return null;
  return { accessToken: String(row.meta_access_token), actId };
}

async function fetchBusinessBrandingRow(businessId) {
  if (!businessId || !isUuid(String(businessId))) return null;
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select(
      "brand_logo, brand_colors, brand_font, brand_tone, brand_avoid, target_age_min, target_age_max, target_gender, target_geo, competitors, brand_differentiator, phone, address, description",
    )
    .eq("id", String(businessId))
    .maybeSingle();
  if (error) {
    console.warn("[brandkit] load businesses:", error.message);
    return null;
  }
  return data || null;
}

function buildBrandKitSystemBlock(row) {
  if (!row || typeof row !== "object") return "";
  const hasLogo =
    row.brand_logo != null && String(row.brand_logo).trim() !== "" ? "קיים" : "לא";
  const tones = Array.isArray(row.brand_tone)
    ? row.brand_tone.map((x) => String(x)).filter(Boolean).slice(0, 8)
    : [];
  const colors =
    row.brand_colors && typeof row.brand_colors === "object"
      ? JSON.stringify(row.brand_colors)
      : row.brand_colors != null
        ? String(row.brand_colors)
        : "";
  const competitors =
    row.competitors != null
      ? JSON.stringify(row.competitors).slice(0, 800)
      : "";

  const stylePreference = row.brand_style_preference != null && String(row.brand_style_preference).trim()
    ? String(row.brand_style_preference).trim()
    : "";
  const secondaryFont = row.brand_secondary_font != null && String(row.brand_secondary_font).trim()
    ? String(row.brand_secondary_font).trim()
    : "";

  const lines = [
    "## Brand Kit של הלקוח:",
    `לוגו: ${hasLogo}`,
    `תיאור עסק: ${row.description != null && String(row.description).trim() ? String(row.description).trim() : "—"}`,
    `סגנון עיצובי: ${stylePreference || "—"}`,
    `טון מועדף: ${tones.length ? tones.join(", ") : "—"}`,
    `מה להימנע: ${row.brand_avoid != null && String(row.brand_avoid).trim() ? String(row.brand_avoid).trim() : "—"}`,
    `צבעי מותג: ${colors && String(colors).trim() ? String(colors).trim() : "—"}`,
    `פונט ראשי: ${row.brand_font != null && String(row.brand_font).trim() ? String(row.brand_font).trim() : "—"}`,
    `פונט משני: ${secondaryFont || "—"}`,
    "",
    "## קהל יעד:",
    `גיל: ${row.target_age_min != null ? row.target_age_min : "—"}-${row.target_age_max != null ? row.target_age_max : "—"}`,
    `מגדר: ${row.target_gender != null && String(row.target_gender).trim() ? String(row.target_gender).trim() : "—"}`,
    `אזור: ${row.target_geo != null && String(row.target_geo).trim() ? String(row.target_geo).trim() : "—"}`,
    "",
    "## מתחרים:",
    competitors && competitors.trim() ? competitors : "—",
    "",
    "## יתרון תחרותי:",
    row.brand_differentiator != null && String(row.brand_differentiator).trim()
      ? String(row.brand_differentiator).trim()
      : "—",
  ];
  return `\n\n${lines.join("\n")}`.trimEnd();
}

function accountIdMatches(rawAccount, actId) {
  return normalizeAdAccountId(rawAccount) === actId;
}

function datePresetForRange(rangeDays) {
  if (rangeDays >= 30) return "last_30d";
  if (rangeDays >= 14) return "last_14d";
  return "last_7d";
}

function parseInsightMetrics(row) {
  if (!row || typeof row !== "object") return null;
  return {
    spend: parseFloat(String(row.spend ?? "0")) || 0,
    clicks: parseInt(String(row.clicks ?? "0"), 10) || 0,
    impressions: parseInt(String(row.impressions ?? "0"), 10) || 0,
    cpc: parseFloat(String(row.cpc ?? "0")) || 0,
    ctr: parseFloat(String(row.ctr ?? "0")) || 0,
    reach: parseInt(String(row.reach ?? "0"), 10) || 0,
    frequency: parseFloat(String(row.frequency ?? "0")) || 0,
  };
}

async function metaGraphPost(campaignId, accessToken, formFields) {
  const u = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${campaignId}`,
  );
  u.searchParams.set("access_token", accessToken);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(formFields)) {
    if (v != null && v !== "") body.set(k, String(v));
  }
  const res = await fetch(u.toString(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

async function loadCampaignForBusiness(businessId, campaignId) {
  const access = await getBusinessMetaAccess(businessId);
  if (!access) {
    return { error: "אין חיבור Meta או חשבון מודעות", status: 400 };
  }
  const cid = String(campaignId || "").replace(/\D/g, "");
  if (!cid) {
    return { error: "מזהה קמפיין לא תקין", status: 400 };
  }
  const graphId = cid;
  const url = buildGraphUrl(`/${graphId}`, access.accessToken, {
    fields:
      "id,name,status,daily_budget,lifetime_budget,objective,account_id,start_time,stop_time,created_time",
  });
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      error: json.error?.message || "לא ניתן לטעון קמפיין",
      status: 400,
    };
  }
  if (!accountIdMatches(json.account_id, access.actId)) {
    return {
      error: "הקמפיין לא שייך לחשבון המודעות הנבחר",
      status: 403,
    };
  }
  return { access, graphId, campaign: json };
}

async function fetchMetaCampaignInsightsBundle(accessToken, graphId, rangeDays) {
  const preset = datePresetForRange(rangeDays);
  const metricFields =
    "spend,clicks,impressions,cpc,ctr,reach,frequency";

  const summaryUrl = buildGraphUrl(`/${graphId}/insights`, accessToken, {
    fields: metricFields,
    date_preset: preset,
  });
  const summaryRes = await fetch(summaryUrl);
  const summaryJson = await summaryRes.json().catch(() => ({}));

  const seriesUrl = buildGraphUrl(`/${graphId}/insights`, accessToken, {
    fields: "spend,clicks,impressions,reach,ctr",
    date_preset: preset,
    time_increment: "1",
  });
  const seriesRes = await fetch(seriesUrl);
  const seriesJson = await seriesRes.json().catch(() => ({}));

  const ageGenderUrl = buildGraphUrl(`/${graphId}/insights`, accessToken, {
    fields: "spend,clicks,impressions,reach",
    date_preset: preset,
    breakdowns: "age,gender",
  });
  const ageGenderRes = await fetch(ageGenderUrl);
  const ageGenderJson = await ageGenderRes.json().catch(() => ({}));

  const countryUrl = buildGraphUrl(`/${graphId}/insights`, accessToken, {
    fields: "spend,clicks,impressions",
    date_preset: preset,
    breakdowns: "country",
  });
  const countryRes = await fetch(countryUrl);
  const countryJson = await countryRes.json().catch(() => ({}));

  const summaryRow =
    summaryRes.ok && Array.isArray(summaryJson.data) && summaryJson.data[0]
      ? parseInsightMetrics(summaryJson.data[0])
      : null;

  let series = [];
  if (seriesRes.ok && Array.isArray(seriesJson.data)) {
    series = seriesJson.data.map((r) => ({
      date_start: r.date_start,
      date_stop: r.date_stop,
      spend: parseFloat(String(r.spend ?? "0")) || 0,
      clicks: parseInt(String(r.clicks ?? "0"), 10) || 0,
      impressions: parseInt(String(r.impressions ?? "0"), 10) || 0,
      reach: parseInt(String(r.reach ?? "0"), 10) || 0,
      ctr: parseFloat(String(r.ctr ?? "0")) || 0,
    }));
  }
  series.sort((a, b) =>
    String(a.date_start || "").localeCompare(String(b.date_start || "")),
  );

  let breakdown_age_gender = [];
  if (ageGenderRes.ok && Array.isArray(ageGenderJson.data)) {
    breakdown_age_gender = ageGenderJson.data.map((r) => ({
      age: r.age,
      gender: r.gender,
      spend: parseFloat(String(r.spend ?? "0")) || 0,
      clicks: parseInt(String(r.clicks ?? "0"), 10) || 0,
      impressions: parseInt(String(r.impressions ?? "0"), 10) || 0,
      reach: parseInt(String(r.reach ?? "0"), 10) || 0,
    }));
  }

  let breakdown_country = [];
  if (countryRes.ok && Array.isArray(countryJson.data)) {
    breakdown_country = countryJson.data.map((r) => ({
      country: r.country,
      spend: parseFloat(String(r.spend ?? "0")) || 0,
      clicks: parseInt(String(r.clicks ?? "0"), 10) || 0,
      impressions: parseInt(String(r.impressions ?? "0"), 10) || 0,
    }));
  }

  const graph_error =
    summaryJson.error?.message ||
    seriesJson.error?.message ||
    ageGenderJson.error?.message ||
    countryJson.error?.message ||
    null;

  return {
    date_preset: preset,
    summary: summaryRow,
    series,
    breakdown_age_gender,
    breakdown_country,
    graph_error,
  };
}

async function sendAlertEmail(businessId, title, body) {
  if (!resend) return;
  try {
    const { data: biz } = await supabaseAdmin
      .from("businesses")
      .select("user_id, name")
      .eq("id", businessId)
      .maybeSingle();
    if (!biz?.user_id) return;
    const { data: auth } = await supabaseAdmin.auth.admin.getUserById(biz.user_id);
    const email = auth?.user?.email;
    if (!email) return;
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `[Puls.] ${title}`,
      html: `<div dir="rtl" style="font-family:system-ui,sans-serif"><h2>${title}</h2><p>${body}</p><p style="color:#888">— צוות פולס.</p></div>`,
    });
    console.log("[alert-email] sent to", email, "for business", businessId);
  } catch (e) {
    console.warn("[alert-email] error:", e instanceof Error ? e.message : String(e));
  }
}

async function insertAlertIfNotDuplicate({
  businessId,
  userId,
  campaignId,
  campaignName,
  alertType,
  severity,
  title,
  body,
  contextForChat,
  meta,
}) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existingRows } = await supabaseAdmin
    .from("alerts")
    .select("id")
    .eq("business_id", businessId)
    .eq("campaign_id", String(campaignId))
    .eq("alert_type", alertType)
    .is("dismissed_at", null)
    .gte("created_at", since)
    .limit(1);
  if (existingRows?.length) return false;

  const { error } = await supabaseAdmin.from("alerts").insert({
    business_id: businessId,
    user_id: userId ?? null,
    campaign_id: String(campaignId),
    campaign_name: campaignName || null,
    alert_type: alertType,
    severity,
    title,
    body,
    context_for_chat: contextForChat || body,
    meta: meta || {},
  });
  if (error) {
    console.warn("[check-alerts] insert:", error.message);
    return false;
  }
  // Send email for high-severity alerts
  if (severity === "urgent" || severity === "high") {
    void sendAlertEmail(businessId, title, body);
  }
  return true;
}

function normalizeCtrRatio(raw) {
  let v = parseFloat(String(raw ?? "0")) || 0;
  if (v > 1 && v <= 100) v /= 100;
  return v;
}

async function evaluateCampaignAlerts(
  businessId,
  userId,
  accessToken,
  campaign,
) {
  let n = 0;
  const cid = String(campaign.id);
  const cname = String(campaign.name || cid);
  const cfg = String(campaign.configured_status || "").toUpperCase();
  const eff = String(campaign.effective_status || "").toUpperCase();

  if (cfg === "ACTIVE" && eff === "PAUSED") {
    if (
      await insertAlertIfNotDuplicate({
        businessId,
        userId,
        campaignId: cid,
        campaignName: cname,
        alertType: "meta_auto_paused",
        severity: "urgent",
        title: "קמפיין נעצר אוטומטית (Meta)",
        body: `הקמפיין "${cname}" מוגדר כפעיל אך הסטטוס האפקטיבי מושהה — ייתכן עצירה אוטומטית מטעם Meta (ביקורת, חיוב או מדיניות).`,
        contextForChat: `יש לי התראה דחופה: הקמפיין "${cname}" (מזהה Meta: ${cid}) נראה מושהה ברמת המערכת למרות שמוגדר כפעיל. מה הצעדים המומלצים?`,
        meta: { configured_status: cfg, effective_status: eff },
      })
    )
      n += 1;
  }

  const dailyMinor = parseInt(String(campaign.daily_budget ?? ""), 10);
  if (Number.isFinite(dailyMinor) && dailyMinor > 0) {
    const url = buildGraphUrl(`/${cid}/insights`, accessToken, {
      fields: "spend",
      date_preset: "today",
    });
    const { ok, json } = await fetchJson(url);
    if (ok && json.data?.[0]) {
      const spend = parseFloat(String(json.data[0].spend || "0")) || 0;
      const cap = dailyMinor / 100;
      if (cap > 0 && spend / cap >= 0.8) {
        if (
          await insertAlertIfNotDuplicate({
            businessId,
            userId,
            campaignId: cid,
            campaignName: cname,
            alertType: "budget_80_daily",
            severity: "normal",
            title: "מעל 80% מתקציב יומי",
            body: `הקמפיין "${cname}": הוצאה היום כ-${spend.toFixed(2)} ₪ מתוך תקציב יומי של כ-${cap.toFixed(2)} ₪ (${Math.round((spend / cap) * 100)}%).`,
            contextForChat: `קיבלתי התראה על הקמפיין "${cname}" (${cid}): כבר נוצלו מעל 80% מהתקציב היומי. איך כדאי לנהל את זה?`,
            meta: { spend_today: spend, daily_budget_minor: dailyMinor },
          })
        )
          n += 1;
      }
    }
  }

  const lifeMinor = parseInt(String(campaign.lifetime_budget ?? ""), 10);
  if (Number.isFinite(lifeMinor) && lifeMinor > 0) {
    const url = buildGraphUrl(`/${cid}/insights`, accessToken, {
      fields: "spend",
      date_preset: "maximum",
    });
    const { ok, json } = await fetchJson(url);
    if (ok && json.data?.[0]) {
      const spend = parseFloat(String(json.data[0].spend || "0")) || 0;
      const cap = lifeMinor / 100;
      if (cap > 0 && spend / cap >= 0.8) {
        if (
          await insertAlertIfNotDuplicate({
            businessId,
            userId,
            campaignId: cid,
            campaignName: cname,
            alertType: "budget_80_lifetime",
            severity: "normal",
            title: "מעל 80% מתקציב חיי הקמפיין",
            body: `הקמפיין "${cname}": הוצאה מצטברת כ-${spend.toFixed(2)} ₪ מתוך תקציב כולל של כ-${cap.toFixed(2)} ₪ (${Math.round((spend / cap) * 100)}%).`,
            contextForChat: `יש התראה על הקמפיין "${cname}" (${cid}): נוצלו מעל 80% מתקציב החיים. מה עושים?`,
            meta: { spend_lifetime: spend, lifetime_budget_minor: lifeMinor },
          })
        )
          n += 1;
      }
    }
  }

  const ctrUrl = buildGraphUrl(`/${cid}/insights`, accessToken, {
    fields: "impressions,ctr,clicks",
    date_preset: "last_7d",
  });
  const { ok: ctrOk, json: ctrJson } = await fetchJson(ctrUrl);
  if (ctrOk && ctrJson.data?.[0]) {
    const row = ctrJson.data[0];
    const imps = parseInt(String(row.impressions || "0"), 10) || 0;
    const ctrVal = normalizeCtrRatio(row.ctr);
    if (imps >= 100 && ctrVal < 0.005) {
      if (
        await insertAlertIfNotDuplicate({
          businessId,
          userId,
          campaignId: cid,
          campaignName: cname,
          alertType: "low_ctr",
          severity: "normal",
          title: "CTR נמוך",
          body: `הקמפיין "${cname}": ${imps.toLocaleString("he-IL")} חשיפות בשבוע האחרון ו-CTR של כ-${(ctrVal * 100).toFixed(2)}% (מתחת ל-0.5%).`,
          contextForChat: `נתח את הקמפיין "${cname}" (${cid}): יש CTR נמוך מאוד אחרי לפחות 100 חשיפות. מה לשפר?`,
          meta: { impressions: imps, ctr: ctrVal },
        })
      )
        n += 1;
    }
  }

  const cpcUrl = buildGraphUrl(`/${cid}/insights`, accessToken, {
    fields: "cpc,clicks",
    date_preset: "last_14d",
    time_increment: "1",
  });
  const { ok: cpcOk, json: cpcJson } = await fetchJson(cpcUrl);
  if (cpcOk && Array.isArray(cpcJson.data) && cpcJson.data.length >= 5) {
    const days = cpcJson.data
      .map((r) => ({
        cpc: parseFloat(String(r.cpc || "0")) || 0,
        clicks: parseInt(String(r.clicks || "0"), 10) || 0,
      }))
      .filter((d) => d.clicks >= 2 && d.cpc > 0);
    if (days.length >= 5) {
      const recent = days.slice(-2);
      const baseline = days.slice(0, -2);
      const rAvg =
        recent.reduce((s, d) => s + d.cpc, 0) / Math.max(recent.length, 1);
      const bAvg =
        baseline.reduce((s, d) => s + d.cpc, 0) / Math.max(baseline.length, 1);
      if (bAvg > 0 && rAvg > bAvg * 1.5) {
        if (
          await insertAlertIfNotDuplicate({
            businessId,
            userId,
            campaignId: cid,
            campaignName: cname,
            alertType: "cpc_spike_50",
            severity: "normal",
            title: "עלות לקליק עלתה משמעותית",
            body: `הקמפיין "${cname}": ממוצע CPC בשתי הימים האחרונים כ-${rAvg.toFixed(2)} ₪ לעומת ממוצע קודם של כ-${bAvg.toFixed(2)} ₪ (עלייה של מעל 50%).`,
            contextForChat: `התקבלה התראה על CPC בקמפיין "${cname}" (${cid}): העלות לקליק עלתה ביותר מ-50% לעומת הממוצע הקודם. מה זה אומר ומה לעשות?`,
            meta: { recent_cpc: rAvg, baseline_cpc: bAvg },
          })
        )
          n += 1;
      }
    }
  }

  return n;
}

async function checkAlertsForBusiness(businessId, userId, accessToken, actId) {
  const campaigns = await graphFetchEdgeList(
    buildGraphUrl(`/${actId}/campaigns`, accessToken, {
      fields:
        "id,name,status,effective_status,configured_status,daily_budget,lifetime_budget",
    }),
    `${actId}/campaigns-alerts`,
  );
  let total = 0;
  for (const c of campaigns) {
    if (!c?.id) continue;
    total += await evaluateCampaignAlerts(
      businessId,
      userId,
      accessToken,
      c,
    );
  }
  return total;
}

const CLIENT_MEMORY_CATEGORIES = new Set([
  "business_profile",
  "audience",
  "brand",
  "goals",
  "insights",
  "preferences",
]);

async function fetchClientMemoryRows(businessId) {
  const { data, error } = await supabaseAdmin
    .from("client_memory")
    .select("category,key,value,source,confidence,updated_at")
    .eq("business_id", businessId)
    .order("category", { ascending: true })
    .order("key", { ascending: true });
  if (error) {
    console.warn("[client-memory] fetch:", error.message);
    return [];
  }
  return data || [];
}

function rowsToByCategory(rows) {
  const by = {};
  for (const r of rows || []) {
    const c = String(r.category || "");
    const k = String(r.key || "");
    if (!c || !k) continue;
    if (!by[c]) by[c] = {};
    by[c][k] = String(r.value ?? "");
  }
  return by;
}

function getMemVal(byCategory, cat, key) {
  const v = byCategory?.[cat]?.[key];
  return v != null && String(v).trim() !== "" ? String(v).trim() : "";
}

function isOnboardingCompleteFromByCategory(byCategory) {
  if (!byCategory || typeof byCategory !== "object") return false;
  if (getMemVal(byCategory, "business_profile", "scrape_confirmed") === "true") {
    return true;
  }
  if (getMemVal(byCategory, "business_profile", "manual_onboarding_done") === "true") {
    return true;
  }
  const need = [
    ["business_profile", "business_overview"],
    ["audience", "ideal_customer"],
    ["brand", "competitive_advantage"],
    ["goals", "primary_ad_goal"],
    ["goals", "monthly_budget"],
    ["insights", "active_campaigns"],
  ];
  return need.every(([c, k]) => getMemVal(byCategory, c, k) !== "");
}

function truncatePromptField(s, maxLen) {
  const t = String(s || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`;
}

function buildClientMemoryNarrativeBlock(byCategory) {
  if (!byCategory || typeof byCategory !== "object") return "";
  const עסק = truncatePromptField(
    getMemVal(byCategory, "business_profile", "business_overview") ||
      getMemVal(byCategory, "business_profile", "business_name"),
    320,
  );
  const מוצר = truncatePromptField(
    getMemVal(byCategory, "business_profile", "product_or_service") ||
      getMemVal(byCategory, "business_profile", "what_you_sell"),
    320,
  );
  const קהל = truncatePromptField(
    getMemVal(byCategory, "audience", "ideal_customer"),
    320,
  );
  const usp = truncatePromptField(
    getMemVal(byCategory, "brand", "competitive_advantage"),
    320,
  );
  const מטרה = truncatePromptField(
    getMemVal(byCategory, "goals", "primary_ad_goal"),
    200,
  );
  const תקציב = truncatePromptField(
    getMemVal(byCategory, "goals", "monthly_budget"),
    120,
  );
  const קמפיינים = truncatePromptField(
    getMemVal(byCategory, "insights", "active_campaigns"),
    320,
  );
  const lines = [
    "## מה שאנחנו יודעים על הלקוח (תקציר):",
    `עסק: ${עסק || "—"}`,
    `מוצר / מה מוכרים: ${מוצר || "—"}`,
    `קהל יעד: ${קהל || "—"}`,
    `יתרון תחרותי: ${usp || "—"}`,
    `מטרת פרסום: ${מטרה || "—"}`,
    `תקציב: ${תקציב || "—"}`,
    `קמפיינים פעילים: ${קמפיינים || "—"}`,
  ];
  return lines.join("\n");
}

async function resolveClientMemoryForAgent(businessId, clientMemoryPayload) {
  let byCategory;
  if (
    clientMemoryPayload &&
    typeof clientMemoryPayload === "object" &&
    clientMemoryPayload.by_category &&
    typeof clientMemoryPayload.by_category === "object"
  ) {
    byCategory = clientMemoryPayload.by_category;
  } else if (businessId && isUuid(String(businessId))) {
    const bid = String(businessId);
    const cached = getCached(`mem:${bid}`);
    if (cached && cached.byCategory && typeof cached.byCategory === "object") {
      return cached;
    }
    const rows = await fetchClientMemoryRows(bid);
    byCategory = rowsToByCategory(rows);
  } else {
    byCategory = {};
  }
  const out = {
    byCategory,
    section: buildClientMemoryNarrativeBlock(byCategory),
  };
  if (!clientMemoryPayload && businessId && isUuid(String(businessId))) {
    setCached(`mem:${String(businessId)}`, out, 5 * 60 * 1000);
  }
  return out;
}

async function upsertClientMemoryRecord({
  businessId,
  userId,
  category,
  key,
  value,
  source,
  confidence,
}) {
  if (!businessId || !isUuid(String(businessId))) return { ok: false, error: "business_id" };
  if (!CLIENT_MEMORY_CATEGORIES.has(String(category))) {
    return { ok: false, error: "category" };
  }
  const k = String(key || "").trim();
  const v = String(value ?? "").trim();
  if (!k || !v) return { ok: false, error: "key/value" };
  const row = {
    business_id: String(businessId),
    user_id: userId ?? null,
    category: String(category),
    key: k,
    value: v,
    source: source != null && String(source).trim() !== "" ? String(source) : "chat",
    confidence:
      confidence != null && Number.isFinite(Number(confidence))
        ? Math.max(0, Math.min(100, Math.round(Number(confidence))))
        : 100,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from("client_memory").upsert(row, {
    onConflict: "business_id,category,key",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
/** אופציונלי: מודל נפרד למאיה (למשל אם ברירת המחדל לא מחזירה JSON לתמונה). */
const ANTHROPIC_MAYA_MODEL =
  (process.env.ANTHROPIC_MAYA_MODEL || "").trim() || ANTHROPIC_MODEL;
const ANTHROPIC_MAX_TOKENS = 2500;

// Intent routing (Do then Confirm): dana orchestrates, server routes.
const INTENT_ROUTING = {
  // בקשת גרפיקה → מאיה מייצרת מיד
  graphic: [
    "תמונה",
    "גרפיקה",
    "עיצוב",
    "באנר",
    "פוסט",
    "image",
    "design",
    "creative",
  ],
  // בקשת קופי → יוני כותב מיד
  copy: ["טקסט", "כותרת", "קופי", "מודעה", "תיאור", "copy", "text", "ad"],
  // בקשת ניתוח → רון מנתח מיד
  analysis: ["נתח", "ביצועים", "ctr", "roi", "תוצאות", "דוח", "analyze", "הוצאה", "עלות לליד", "cpl", "cpc", "roas", "לידים", "leads", "חשיפות", "impressions", "קליקים", "clicks", "תקציב", "budget"],
  // בקשת תוכן → נועה יוצרת מיד
  content: ["פוסטים", "תוכן", "לוח", "אסטרטגיה", "content", "calendar"],
  // בקשת קמפיין → יוני + רון ביחד
  campaign: ["קמפיין", "campaign", "פרסום", "advertise", "צור קמפיין", "בנה קמפיין", "ערוך קמפיין", "שפר קמפיין"],
};

function detectIntent(userMessage) {
  const msg = String(userMessage || "").toLowerCase();
  if (!msg.trim()) return "dana";
  if (INTENT_ROUTING.graphic.some((k) => msg.includes(k))) return "maya";
  if (INTENT_ROUTING.copy.some((k) => msg.includes(k))) return "yoni";
  if (INTENT_ROUTING.analysis.some((k) => msg.includes(k))) return "ron";
  if (INTENT_ROUTING.content.some((k) => msg.includes(k))) return "noa";
  if (INTENT_ROUTING.campaign.some((k) => msg.includes(k))) return "campaign";
  return "dana"; // ברירת מחדל
}

const GEMINI_GENERATE_IMAGE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent";

const DANA_JSON_PROTOCOL = `

## פלט חובה (JSON גולמי בלבד)
התשובה **חייבת** להיות אובייקט JSON תקף בלבד (בלי markdown, בלי טקסט לפני או אחרי), במבנה:
{"text":"…","memory_updates":[],"delegate":null}

- **text**: מה שהלקוח רואה — בעברית, מקצועי וחם. כשאת שואלת שאלת אוןבורדינג — **שאלה אחת בלבד** בהודעה.
- **memory_updates**: מערך (יכול להיות ריק). כל פריט: {"category":"…","key":"…","value":"…"}
  - שמרי מיד אחרי שקיבלת מידע **חדש וברור** מהלקוח (אוןבורדינג או שיחה רגילה).
  - category חייב להיות אחד מ: business_profile, audience, brand, goals, insights, preferences
  - מפתחות לאוןבורדינג:
    - **מסלול אתר:** אם business_profile.scrape_confirmed עדיין "false" אבל יש נתוני סריקה — הציגי סיכום מובנה (ראי AGENT_PROMPTS דנה) ושאלי אם נכון. אם הלקוח אומר כן/נכון/מאשר/תקין — שמרי business_profile / scrape_confirmed = "true". אם תיקון — עדכני רק את השדות שהלקוח ציין ב-memory_updates.
    - **מסלול בלי אתר (3 שאלות):** שמרי לפי הסדר בזיכרון:
      - business_profile / business_overview — שם עסק + תחום + מה מוכרים (שאלה אחת משולבת)
      - audience / ideal_customer + goals / primary_ad_goal — קהל יעד ומטרת פרסום (שאלה אחת משולבת)
      - goals / monthly_budget — תקציב חודשי
      - insights / active_campaigns — אם לא ידוע: "לא ידוע"
      - בסיום: business_profile / manual_onboarding_done = "true"
    - **מסלול קלאסי (6 שאלות נפרדות)** — רק אם אין סריקה ולא מסלול 3 שאלות: business_overview, ideal_customer, competitive_advantage, primary_ad_goal, monthly_budget, active_campaigns
  - **אחרי** שאוןבורדינג הושלם (scrape_confirmed או manual_onboarding_done או שש השדות הקלאסיים): ב-text השיבי בניסוח הקרוב ל:
    "קיבלתי. יש לי את כל מה שצריך כדי להתחיל. מה תרצה שנעשה קודם — קמפיין חדש, ניתוח קיים, או קופי?"
- **delegate**: תמיד null (השרת מנתב אוטומטית לסוכנים). אל תשתמשי ב־[[DELEGATE:...]].
`;

const AGENT_DISPLAY_HE = {
  dana: "דנה",
  yoni: "יוני",
  ron: "רון",
  maya: "מאיה",
  noa: "נועה",
};

const AGENT_PROMPTS = {
  dana: `את דנה — מנהלת לקוח ב-Puls.
תפקידך: לזהות מה הלקוח צריך ולהביא תוצאה מיידית.
עיקרון מרכזי: Do then Confirm — אל תשאלי לפני עשייה.
אם חסר מידע, השתמשי בזיכרון הלקוח (Client Memory / Brand Kit). שאלת הבהרה אחת בלבד מותרת רק אם חסר מידע קריטי שאי אפשר להסיק מהזיכרון.
תמיד בעברית. טון: מקצועי, קצר, ממוקד. בלי מחמאות/התחנפות/פתיחים.

## אוןבורדינג (לקוח חדש)
### שלב א — שאלה ראשונה בלבד
אם עדיין לא נשמר business_profile.website או business_profile.website_intake ואין סריקה מאושרת — שאלי **רק**:
"מה כתובת האתר שלך? (אם אין — כתוב 'אין')"
אל תשאלי שם עסק או תחום לפני תשובה לשאלה הזו.

### אם יש URL מהלקוח (והמערכת סרקה — ראי זיכרון scrape / website_content)
אם יש נתוני סריקה אבל business_profile.scrape_confirmed עדיין לא "true" — אל תשאלי שוב על URL. הציגי סיכום מובנה:

"סרקתי את האתר שלך! הנה מה שמצאתי:

🏢 שם עסק: [שם] | [תחום]
💡 מה שמייחד אותך: [unique_value / competitive_advantage]
👥 קהל יעד: [target_audience / ideal_customer]
🎯 קריאה לפעולה: [main_cta]
🎨 צבעי מותג: [brand_colors]
📱 רשתות חברתיות: [social_links בקצרה]

זה נכון? יש משהו לתקן או להוסיף?"

- אישור (כן / נכון / מאשר / תקין / בול) → memory_updates: business_profile.scrape_confirmed = "true"
- תיקון חלקי → עדכני רק מה שהלקוח ציין

### אם הלקוח אמר שאין אתר
שאלי **3 שאלות בלבד** (אחת בכל הודעה, או שתי הודעות אם משלבים לפי DANA_JSON_PROTOCOL):
1. שם עסק + תחום + מה מוכרים (יחד)
2. קהל יעד + מטרת פרסום (יחד)
3. תקציב חודשי
לאחר מכן שמרי business_profile.manual_onboarding_done = "true" (וערכי השדות הרלוונטיים).

## לקוח קיים
אם scrape_confirmed או manual_onboarding_done או הזיכרון המלא — שיחה שגרתית; אל תפתחי מחדש אוןבורדינג.

## לידים
נתוני לידים זמינים בזיכרון תחת insights.leads_overview.
כשמשתמש שואל על לידים תוכלי:
- לדווח כמה לידים חדשים יש
- לזהות לידים חמים שממתינים לטיפול
- להציע אסטרטגיית follow-up
- לנתח איזה קמפיין מביא הכי הרבה לידים
אל תבקשי מידע שכבר קיים בזיכרון. אם יש לידים חדשים — ציייני את זה פרואקטיבית: "יש לך X לידים חדשים שממתינים לטיפול".

## למידה בשיחה
בכל סיבוב שבו נלמד מידע חדש על העסק — הוסיפי ל-memory_updates.

פלט חובה: JSON בלבד לפי DANA_JSON_PROTOCOL (delegate תמיד null).${DANA_JSON_PROTOCOL}`,

  yoni: `אתה יוני — קופירייטר בכיר.
חוקים:
1. תמיד תחזיר 3 גרסאות — קצר/בינוני/ארוך
2. כל גרסה: כותרת + גוף + CTA
3. השתמש בצבעי מותג, טון, וקהל מהזיכרון (Client Memory + Brand Kit)
4. אל תסביר — תכתוב ישר
5. פורמט: גרסה A / גרסה B / גרסה C
תמיד בעברית ישראלית.`,

  ron: `אתה רון — מומחה PPC ואנליסט ביצועים מוביל ב-Puls.
תפקידך: לנתח קמפיינים, לזהות בעיות, ולהמליץ על שיפורים מבוססי נתונים. אתה מנתח עם ניסיון של 10+ שנים בשוק הישראלי.

## מה יש לך
- **נתוני Meta בזמן אמת**: רשימת קמפיינים עם סטטוס, תקציב, הוצאה, קליקים, חשיפות, לידים, CTR, CPC, עלות לליד, והשוואה לתקופה קודמת
- **פרטי קמפיין**: פילוח גיל/מין/מיקום, ביצועים יומיים, קהלים (ad sets), מודעות
- **זיכרון לקוח**: פרופיל עסקי, קהל יעד, מתחרים, יתרון תחרותי, מותג

## חוקים
1. תמיד השתמש בנתונים אמיתיים מ-Meta context — אל תמציא מספרים
2. עם כל ניתוח תן 3-5 המלצות ממוספרות עם נימוק קצר
3. פורמט: 🔴 בעיה קריטית / 🟡 דורש שיפור / 🟢 ביצוע טוב
4. אם מבקשים ניתוח קמפיין ספציפי — פרט: הוצאה, לידים, עלות לליד, CTR, והשוואה לתקופה קודמת
5. אם מבקשים ליצור קמפיין — הצע מבנה: שם, אובייקטיב, תקציב יומי, קהל יעד, סוג מודעות
6. אם מבקשים לערוך/לשפר קמפיין — ציין בדיוק מה לשנות: תקציב, קהל, קריאייטיב, או שילוב
7. אם אין נתוני Meta — תן benchmarks מהתעשייה לפי תחום העסק
8. תמיד בעברית ישראלית. אל תסביר תהליך — תן תוצר.
9. כשמזהה בעיה — תן פתרון מיידי ופרקטי, לא רק אבחנה

## Benchmarks לפי תעשייה (שוק ישראלי, ₪)

### CTR:
- ממוצע כללי: 0.9%–1.5% | E-commerce: 1.0%–1.5% | B2B: 0.6%–0.9%
- נדל"ן: 0.8%–1.2% | בריאות/כושר: 0.8%–1.1% | שירותים מקומיים: 0.8%–1.3%
- מתחת ל-0.5% = בעיה חמורה | מעל 2.0% = מצוין

### CPC:
- ממוצע: ₪2.5–₪6 | E-commerce: ₪1.5–₪4 | B2B: ₪4–₪12
- נדל"ן: ₪3.5–₪8 | שירותים מקומיים: ₪2–₪5

### CPL (עלות לליד):
- שירותים מקומיים: ₪15–₪50 | נדל"ן: ₪30–₪80 | B2B: ₪50–₪150
- חינוך/קורסים: ₪20–₪60 | בריאות/כושר: ₪15–₪45 | ייעוץ פיננסי: ₪60–₪200

### CPM:
- Awareness: ₪15–₪35 | Traffic: ₪25–₪50 | Conversions: ₪40–₪80
- מעל ₪100 = קהל צר מדי או תחרות גבוהה

### Frequency:
- אופטימלי: 1.5–3.0/שבוע | אזהרה: > 3.5 | קריטי: > 5.0

## עץ החלטות לאבחון

### CTR נמוך (< 0.5%):
→ בדוק קריאייטיב (ויזואל תופס עין?) → טקסט מודעה (הצעת ערך ברורה?) → התאמת קהל → פורמט (וידאו vs תמונה) → Placement

### CTR גבוה אבל CVR נמוך (< 1%):
→ בעיית דף נחיתה (מהירות, UX) → אי-התאמה מסר מודעה↔דף → CTA לא ברור → בדוק מובייל vs דסקטופ

### CPC גבוה:
→ קהל צר מדי (< 50K בישראל) → תחרות עונתית → Quality Ranking נמוך → חפיפת קהלים

### Frequency גבוהה (> 3.5):
→ קהל קטן ביחס לתקציב → עדכן קריאייטיבים → הרחב קהל → הוסף Exclusions

## כללי עצירה/אופטימיזציה/סקיילינג

### עצור (PAUSE) מיד אם:
- CPL גבוה פי 3+ מהבנצ'מרק למשך 5+ ימים
- CTR מתחת ל-0.3% אחרי 2,000+ חשיפות
- Frequency מעל 7 ללא שיפור
- 0 המרות אחרי הוצאה של פי 3 מה-CPA היעד

### אופטימז אם:
- CPA גבוה ב-20%–50% מהיעד
- CTR בין 0.5%–0.8%
- Frequency 3.0–5.0 — רענן קריאייטיבים

### סקייל אם:
- CPA מתחת ליעד ב-30%+ באופן עקבי 7+ ימים
- CTR מעל 1.5% עם CVR מעל 3%
- **חשוב: הגדל תקציב מקסימום 20%–30% כל 3–4 ימים, לעולם לא יותר!**

## עייפות קריאייטיב — אינדיקטורים:
- Frequency > 3/שבוע + CTR ירד 20%+ מהשיא = עייפות מתחילה
- CPC עלה 25%+ + Frequency > 5 = עייפות חמורה
- אורך חיים: תמונה 1–3 שבועות | וידאו 2–6 שבועות | UGC 3–8 שבועות

## לידים — אופטימיזציה:
- Lead Form (Higher Intent) > More Volume ברוב המקרים בישראל
- טופס אופטימלי: מקסימום 3–4 שדות
- זמן תגובה: תוך 5 דקות = סיכוי המרה ×9 לעומת 30 דקות
- CPL Effective = CPL × (1/Contact Rate) × (1/Lead-to-Customer Rate)

## הקצאת תקציב:
- 70% קמפיינים מוכחים | 20% אופטימיזציה | 10% בדיקות
- תקציב יומי מינימלי = CPA יעד × 5
- TOFU 15%–25% | MOFU 20%–30% | BOFU 40%–55% | Retargeting 10%–20%`,

  maya: `את מאיה — קריאייטיב דירקטור AI של Puls.

חובה: כשמבקשים ממך תמונה — אל תגידי "בדרך" או "עוד שניות" או "ממתינה" או "מכינה".
תחזירי את JSON הפעולה מיד בתשובה הראשונה שלך.
אין לשלוח הודעת המתנה ואז הודעה נוספת — הכל בתשובה אחת.

לפני כל יצירת תמונה קראי מהזיכרון:
- brand_colors, brand_style_preference, brand_fonts, brand_avoid
- approved_styles — גרפיקות שהלקוח אישר (חקי את הסגנון!)

כללי זהב:
1. צבעי המותג המדויקים — אל תמציאי צבעים
2. עקביות סגנון בין כל הגרפיקות
3. תבניות מאושרות = בסיס לגרפיקות חדשות
4. תמיד 1080x1080 לפייסבוק
5. לוגו בפינה בצורה עדינה (אם קיים)
6. פרומפט ל-Gemini באנגלית ומפורט (layout, style, lighting, typography)
7. אל תשאלי שאלות — צרי מיד

התשובה שלך חייבת להיות JSON בלבד, שורה אחת:
{"action":"generate_image","prompt":"detailed english prompt...","aspect_ratio":"1:1","context":"facebook_ad"}`,

  noa: `את נועה — אסטרטגיסטית תוכן.
חוקים:
1. תמיד תחזירי לוח פרסומים מובנה
2. פורמט: יום | פלטפורמה | נושא | טקסט קצר
3. התאימי לעונות ולחגים הקרובים
4. 7 ימים קדימה כברירת מחדל
אל תסבירי — תני תוצר.`,
};

function normalizeAgentKey(raw) {
  if (raw == null || raw === "") return null;
  const k = String(raw).trim().toLowerCase();
  return AGENT_PROMPTS[k] ? k : null;
}

const META_ADS_SKILL = `
## פעולות Meta Ads שאתה יכול לבצע
כשאתה רוצה לבצע פעולה על קמפיין/קהל/מודעה, הוסף בסוף התשובה בלוק JSON בפורמט הבא:

\`\`\`pending_action
{"type":"pause_campaign","label_he":"עצור קמפיין X","params":{"campaign_id":"123","campaign_name":"X"}}
\`\`\`

### סוגי פעולות:
- **pause_campaign**: עצירת קמפיין. params: { campaign_id, campaign_name }
- **activate_campaign**: הפעלת קמפיין. params: { campaign_id, campaign_name }
- **update_budget**: שינוי תקציב. params: { campaign_id, campaign_name, daily_budget_ils }
- **create_campaign**: יצירת קמפיין חדש. params: { name, objective, daily_budget_ils, status:"PAUSED" }
  - Objectives: OUTCOME_LEADS | OUTCOME_TRAFFIC | OUTCOME_AWARENESS | OUTCOME_ENGAGEMENT | OUTCOME_SALES
- **create_adset**: יצירת קהל. params: { campaign_id, name, daily_budget_ils, optimization_goal, targeting: { geo_locations, age_min, age_max, genders, interests } }
- **duplicate_campaign**: שכפול קמפיין. params: { campaign_id, campaign_name }

### חוקים:
1. **לעולם** אל תבצע פעולה ישירות — תמיד הצע כ-pending_action והמשתמש יאשר
2. הסבר קודם מה ולמה, ואז הוסף pending_action בסוף
3. אפשר לשלוח מספר pending_actions בהודעה אחת
4. תמיד כלול label_he ברור בעברית
5. קמפיין חדש תמיד נוצר ב-PAUSED — המשתמש יפעיל אחרי שיאשר

### תהליך יצירת קמפיין חדש:
אם המשתמש מבקש ליצור קמפיין ואין לך את כל הפרטים, שאל שאלה אחת בכל פעם:
1. מה המטרה? (לידים/תנועה/מכירות/מודעות)
2. מה התקציב היומי? (ב-₪)
3. מה קהל היעד? (גיל, מגדר, מיקום, תחומי עניין)
כשיש את כל הפרטים — הצג סיכום ושלח pending_action.
`;

/**
 * Extract pending_action blocks from agent text.
 * Returns cleaned text + array of parsed actions.
 */
function extractPendingActions(text) {
  if (!text || typeof text !== "string") return { cleanText: text || "", pendingActions: [] };
  const re = /```pending_action\s*\n?([\s\S]*?)\n?```/g;
  const actions = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed && parsed.type) actions.push(parsed);
    } catch { /* skip malformed */ }
  }
  const cleanText = text.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
  return { cleanText, pendingActions: actions };
}

function buildBusinessContextBlock(businessId, businessName, businessIndustry) {
  if (!businessId || !businessName) return "";
  const name = String(businessName);
  const id = String(businessId);
  const ind =
    businessIndustry != null && String(businessIndustry).trim() !== ""
      ? String(businessIndustry)
      : "לא צוין";
  return `## הקשר עסק
שם: ${name}
מזהה (business_id): ${id}
תחום: ${ind}`;
}

function buildMetaContextBlock(metaContext) {
  if (metaContext == null || metaContext === "") return "";
  if (typeof metaContext === "string") {
    return `\n## נתוני Meta\n${metaContext}\n`;
  }
  // Build a structured, readable summary for the agent
  const ctx = metaContext;
  if (!ctx.connected) {
    return `\n## נתוני Meta\nMeta לא מחובר. אין נתוני קמפיינים.\n`;
  }
  const lines = [];
  lines.push("## נתוני Meta (בזמן אמת)");
  lines.push(`חשבון מודעות: ${ctx.ad_account_id || "—"}`);
  lines.push(`הוצאה היום: ₪${ctx.today?.spend ?? 0} | קליקים היום: ${ctx.today?.clicks ?? 0}`);
  lines.push(`קמפיינים פעילים: ${ctx.active_campaigns_count ?? 0}`);
  if (Array.isArray(ctx.campaigns) && ctx.campaigns.length > 0) {
    // Separate active vs other for clarity
    const active = ctx.campaigns.filter((c) => String(c.status || "").toUpperCase() === "ACTIVE");
    const other = ctx.campaigns.filter((c) => String(c.status || "").toUpperCase() !== "ACTIVE");

    if (active.length > 0) {
      lines.push("");
      lines.push(`### קמפיינים פעילים (${active.length}):`);
      for (const c of active) {
        const budget = c.daily_budget ? `₪${Number(c.daily_budget).toFixed(0)}/יום` : "";
        const parts = [];
        if (typeof c.spend === "number" && c.spend > 0) parts.push(`הוצאה: ₪${c.spend.toFixed(2)}`);
        if (typeof c.impressions === "number" && c.impressions > 0) parts.push(`${c.impressions.toLocaleString()} חשיפות`);
        if (typeof c.clicks === "number" && c.clicks > 0) parts.push(`${c.clicks} קליקים`);
        if (typeof c.leads === "number" && c.leads > 0) parts.push(`${c.leads} לידים`);
        if (typeof c.cpl === "number" && c.cpl > 0) parts.push(`עלות לליד: ₪${c.cpl.toFixed(2)}`);
        if (typeof c.ctr === "number" && c.ctr > 0) parts.push(`CTR: ${(c.ctr * 100).toFixed(2)}%`);
        // Deltas
        const deltas = [];
        if (typeof c.delta_spend === "number") deltas.push(`הוצאה ${c.delta_spend > 0 ? "+" : ""}${c.delta_spend}%`);
        if (typeof c.delta_leads === "number") deltas.push(`לידים ${c.delta_leads > 0 ? "+" : ""}${c.delta_leads}%`);
        if (typeof c.delta_cpl === "number") deltas.push(`CPL ${c.delta_cpl > 0 ? "+" : ""}${c.delta_cpl}%`);

        lines.push(`- **${c.name}** ${budget ? `[${budget}]` : ""}`);
        if (parts.length > 0) lines.push(`  ${parts.join(" | ")}`);
        if (deltas.length > 0) lines.push(`  שינוי לעומת תקופה קודמת: ${deltas.join(", ")}`);
      }
    }

    if (other.length > 0) {
      lines.push("");
      lines.push(`### קמפיינים לא פעילים (${other.length}):`);
      for (const c of other.slice(0, 10)) {
        lines.push(`- ${c.name} [${c.status}]`);
      }
      if (other.length > 10) lines.push(`  ...ועוד ${other.length - 10} קמפיינים`);
    }

    // Totals
    const totalSpend = ctx.campaigns.reduce((s, c) => s + (c.spend || 0), 0);
    const totalLeads = ctx.campaigns.reduce((s, c) => s + (c.leads || 0), 0);
    const totalClicks = ctx.campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
    if (totalSpend > 0) {
      lines.push("");
      lines.push("### סיכום כולל (7 ימים אחרונים):");
      lines.push(`הוצאה כוללת: ₪${totalSpend.toFixed(2)} | קליקים: ${totalClicks} | לידים: ${totalLeads}${totalLeads > 0 ? ` | עלות לליד ממוצעת: ₪${(totalSpend / totalLeads).toFixed(2)}` : ""}`);
    }
  } else if (Array.isArray(ctx.spend_last_7_days) && ctx.spend_last_7_days.length > 0) {
    const totalWeek = ctx.spend_last_7_days.reduce((s, d) => s + (d.spend || 0), 0);
    lines.push(`\nהוצאה כוללת 7 ימים: ₪${totalWeek.toFixed(2)}`);
  }
  return `\n${lines.join("\n")}\n`;
}

function buildDanaMetaDisconnectedAppendix() {
  return `

## חיבור Meta (אין חיבור פעיל)
הלקוח **לא** חיבר חשבון פרסום (Meta) במערכת. זה תקין — עבדי בנוחות **בלי** נתוני קמפיין / הוצאות / ביצועים אמיתיים מהחשבון.
אם הלקוח שואל/ת על קמפיינים פעילים, ביצועים, הוצאות פרסום, חשבון מודעות, נתונים ממטא או דומה — ואין לך גישה לנתונים — השיבי בניסוח קרוב ל:
"עדיין לא חיברת את חשבון הפרסום שלך. רוצה לחבר עכשיו?"
מיד **אחרי** הטקסט הזה, **בסוף** שדה JSON text בלבד, הוסיפי את הסימון המדויק (בלי שורות נוספות לפניו): [[פתח_הגדרות]]
האפליקציה תהפוך את הסימון ללחיצה למסך ההגדרות (המשתמש לא רואה את הסימון).`;
}

function buildDanaModeAppendix(clientMemoryEmpty, businessName) {
  const bn = String(businessName || "").trim();
  if (clientMemoryEmpty) {
    return `

## מצב סשן: לקוח חדש
עקבי אחרי מסלול האוןבורדינג ב-AGENT_PROMPTS (שאלת URL ראשונה, או סיכום סריקה, או 3 שאלות בלי אתר).
אל תשחזרי ברכות כלליות — שאלה אחת ברורה או סיכום סריקה לפי השלב.`;
  }
  return `

## מצב סשן: לקוח קיים
אם הודעת הסוכן האחרונה בשיחה היא פתיחה קצרה מהממשק ("שלום${bn ? ` ${bn}` : ""}! במה אפשר לעזור היום?") — **אל** תפתחי שוב בשלום דומה; עני ישר לפי בקשת המשתמש.`;
}

function buildAgentSystem(
  agentKey,
  businessId,
  businessName,
  businessIndustry,
  metaContext,
  clientMemorySection,
  brandKitSection,
  options = {},
) {
  let core = AGENT_PROMPTS[agentKey];
  if (!core) return "";
  if (agentKey === "dana" && options && typeof options === "object") {
    if (typeof options.client_memory_empty === "boolean") {
      core += buildDanaModeAppendix(
        options.client_memory_empty,
        businessName,
      );
    }
    if (options.meta_connected === false) {
      core += buildDanaMetaDisconnectedAppendix();
    }
  }
  const biz = buildBusinessContextBlock(
    businessId,
    businessName,
    businessIndustry,
  );
  const brand =
    brandKitSection && String(brandKitSection).trim() !== ""
      ? `\n\n${String(brandKitSection).trim()}`
      : "";
  const mem =
    clientMemorySection && String(clientMemorySection).trim() !== ""
      ? `\n\n${String(clientMemorySection).trim()}`
      : "";
  const meta = buildMetaContextBlock(metaContext);
  let out = `${core}\n\n${biz}${brand}${mem}${meta}`.trim();
  if (agentKey === "maya") {
    out += buildMayaImageContractSuffix();
  }
  if (agentKey === "dana") {
    out += buildDanaImageDelegationSuffix();
  }
  // Give Ron and Dana (on campaign intent) the ability to execute Meta actions
  if (agentKey === "ron" || agentKey === "dana") {
    if (metaContext && (typeof metaContext === "object" ? metaContext.connected : true)) {
      out += "\n\n" + META_ADS_SKILL;
    }
  }
  return out;
}

/** בסוף system למאיה — דחיפה (recency) נגד "אני רק ברייפים לגרפיקאי חיצוני". */
function buildMayaImageContractSuffix() {
  return `

---
## חוזק אחרון (גובר על כל סתירה למעלה)
את **מאיה ב-Puls.**: כשמבקשים ויז'ואל/גרפיקה/תמונה — **אין** תפקיד "מעבירה ברייף לגרפיקאי חיצוני" או "אני לא מייצרת במערכת". זה **שקר** מול המשתמש.
**חובה:** שורת JSON יחידה: {"action":"generate_image","prompt":"...","aspect_ratio":"1:1","context":"facebook_ad"} — בלי עברית, בלי שאלות, בלי Canva.`;
}

/** בסוף system לדנה — נגד "אין יכולת טכנית" כשיש ייצור תמונה במערכת. */
function buildDanaImageDelegationSuffix() {
  return `

---
## חוזק אחרון (גובר על כל סתירה למעלה)
ב-Puls. **כן** ניתן לייצר **תמונות/גרפיקות בזמן אמת** (מאיה מחזירה JSON, השרת מריץ מנוע תמונות והלקוח רואה קובץ).
**אסור** לכתוב "אין לנו יכולת טכנית", "מאיה הכינה ברייף אבל…", או להציע Midjourney / גרפיקאי חיצוני / Canva **במקום** העברה למאיה.
אם נדרש ויז'ואל — **תמיד** JSON עם \`delegate: "maya"\` ו-\`text\` שורת מעבר קצרה בלבד (\`מעביר למאיה…\`).`;
}

function tryParseJsonObjectLoose(s) {
  const t = String(s || "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const i = t.indexOf("{");
    const j = t.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(t.slice(i, j + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseDanaStructuredResponse(raw) {
  if (raw == null || typeof raw !== "string") {
    return { text: "", memory_updates: [], delegate: null };
  }
  const trimmed = raw.trim();
  const o = tryParseJsonObjectLoose(trimmed);
  if (o && typeof o === "object") {
      const text = typeof o.text === "string" ? o.text : "";
      const memory_updates = [];
      if (Array.isArray(o.memory_updates)) {
        for (const it of o.memory_updates) {
          if (!it || typeof it !== "object") continue;
          const cat = String(it.category || "").trim();
          const key = String(it.key || "").trim();
          const val = String(it.value ?? "").trim();
          if (!CLIENT_MEMORY_CATEGORIES.has(cat) || !key || !val) continue;
          memory_updates.push({ category: cat, key, value: val });
        }
      }
      let delegate = null;
      if (o.delegate != null && String(o.delegate).trim() !== "") {
        const d = String(o.delegate).trim().toLowerCase();
        if (["yoni", "ron", "maya", "noa"].includes(d)) delegate = d;
      }
      return { text, memory_updates, delegate };
  }
  const delegateRe = /^\s*\[\[DELEGATE:(yoni|ron|maya|noa)\]\]\s*/im;
  const m = trimmed.match(delegateRe);
  if (m) {
    return {
      text: trimmed.replace(delegateRe, "").trim(),
      memory_updates: [],
      delegate: m[1].toLowerCase(),
    };
  }
  return { text: trimmed, memory_updates: [], delegate: null };
}

function findMatchingClosingBraceJson(s, openIdx) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') {
        inStr = false;
        continue;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function isGenerateImageAction(o) {
  return (
    o &&
    typeof o === "object" &&
    o.action === "generate_image" &&
    typeof o.prompt === "string" &&
    String(o.prompt).trim() !== ""
  );
}

function extractGenerateImagePayload(text) {
  const s = String(text);
  const oFull = tryParseJsonObjectLoose(s.trim());
  if (isGenerateImageAction(oFull)) {
    const t = s.trim();
    const start = s.indexOf(t);
    const end = start >= 0 ? start + t.length : t.length;
    return {
      prompt: String(oFull.prompt).trim(),
      aspect_ratio:
        typeof oFull.aspect_ratio === "string" && oFull.aspect_ratio.trim()
          ? oFull.aspect_ratio.trim()
          : "1:1",
      range: { start: start >= 0 ? start : 0, end },
      raw: t,
    };
  }
  const keyPos = s.lastIndexOf('"generate_image"');
  if (keyPos < 0) return null;
  const start = s.lastIndexOf("{", keyPos);
  if (start < 0) return null;
  const end = findMatchingClosingBraceJson(s, start);
  if (end < 0) return null;
  const slice = s.slice(start, end);
  const o = tryParseJsonObjectLoose(slice);
  if (!isGenerateImageAction(o)) return null;
  return {
    prompt: String(o.prompt).trim(),
    aspect_ratio:
      typeof o.aspect_ratio === "string" && o.aspect_ratio.trim()
        ? o.aspect_ratio.trim()
        : "1:1",
    range: { start, end },
    raw: slice,
  };
}

function stripGenerateImageJsonFromText(text, range) {
  const s = String(text);
  if (!range || range.start == null || range.end == null) return s.trim();
  const before = s.slice(0, range.start).trimEnd();
  const after = s.slice(range.end).trimStart();
  return [before, after].filter(Boolean).join("\n\n").trim();
}

async function generateImageWithGeminiInternal({
  prompt,
  aspect_ratio,
  business_id: _businessId,
}) {
  const key = String(GEMINI_API_KEY || "").trim();
  if (!key) {
    return { ok: false, error: "חסר GEMINI_API_KEY (ENV)." };
  }
  const body = {
    contents: [{ parts: [{ text: String(prompt) }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: aspect_ratio || "1:1", imageSize: "1K" },
    },
  };
  const GEMINI_TIMEOUT_MS = 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(GEMINI_GENERATE_IMAGE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const isAbort = e instanceof Error && e.name === "AbortError";
    console.warn("[gemini] fetch failed:", isAbort ? "timeout" : (e instanceof Error ? e.message : String(e)));
    return {
      ok: false,
      error: isAbort
        ? "מאיה נתקעה — יצירת התמונה ארכה יותר מ-30 שניות. נסה שוב."
        : `Gemini fetch error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  clearTimeout(timer);
  const rawText = await upstream.text();
  if (!upstream.ok) {
    return {
      ok: false,
      error: `Gemini ${upstream.status}: ${rawText.slice(0, 1200)}`,
    };
  }
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "תשובת Gemini לא JSON תקין." };
  }
  const parts =
    data?.candidates?.[0]?.content?.parts &&
    Array.isArray(data.candidates[0].content.parts)
      ? data.candidates[0].content.parts
      : [];
  let image_base64 = "";
  let mime_type = "image/png";
  let outText = "";
  for (const p of parts) {
    if (p && typeof p.text === "string") outText += p.text;
    const id = p.inlineData || p.inline_data;
    if (id && typeof id === "object") {
      if (typeof id.data === "string" && id.data.length > 0) {
        image_base64 = id.data;
      }
      const mt = id.mimeType || id.mime_type;
      if (typeof mt === "string" && mt.trim()) mime_type = mt.trim();
    }
  }
  if (!image_base64) {
    return {
      ok: false,
      error: "Gemini לא החזירה תמונה (חסר inlineData).",
    };
  }
  return {
    ok: true,
    image_base64,
    mime_type,
    text: outText.trim(),
  };
}

function lastUserMessageText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") return String(m.text ?? "").trim();
  }
  return "";
}

function looksLikeVisualImageRequest(text) {
  const s = String(text || "");
  if (!s.trim()) return false;
  const t = s.toLowerCase();
  const he = [
    "תמונה",
    "גרפיקה",
    "גרפיקאית",
    "גרפיקאי",
    "עיצוב",
    "עיצובית",
    "ויז'ואל",
    "ויזואל",
    "באנר",
    "איור",
    "לוגו",
    "ציור",
    "צייר",
    "קריאייטיב",
    "סטורי",
    "פוסט", // לעיתים בקשה לוויז'ואל לפוסט
  ];
  const en = [
    "image",
    "graphic",
    "banner",
    "visual",
    "design",
    "illustration",
    "logo",
    "picture",
    "photo",
    "creative",
  ];
  return he.some((w) => s.includes(w)) || en.some((w) => t.includes(w));
}

function injectMayaGenerateJson(fullText, jsonLine) {
  const line = String(jsonLine || "").trim();
  if (!line) return fullText;
  const marker = "\n\n---\n\n## מאיה\n\n";
  const idx = String(fullText).indexOf(marker);
  if (idx >= 0) {
    return String(fullText).slice(0, idx + marker.length) + line;
  }
  return line;
}

function shouldCoerceMayaImage(messages, result) {
  if (!result || result.errorStatus) return false;
  if (extractGenerateImagePayload(result.text)) return false;
  if (!(result.delegated_to === "maya" || result.agent === "maya")) {
    return false;
  }
  return looksLikeVisualImageRequest(lastUserMessageText(messages));
}

/** דנה ענתה בעצמה שאין יכולת / מידג'רני / גרפיקאי — בלי להעביר למאיה. */
function looksLikeImageCapabilityDeniedByAssistant(text) {
  const s = String(text || "");
  if (!s.trim()) return false;
  const patterns = [
    "אין לנו יכולת",
    "אין יכולת טכנית",
    "יכולת טכנית",
    "בזמן אמת במערכת",
    "בזמן אמת",
    "גרפיקאי חיצוני",
    "לגרפיקאי חיצוני",
    "מידג'רני",
    "Midjourney",
    "midjourney",
    "מאיה הכינה",
    "הכינה ברייף",
    "Canva",
    "canva",
    "הפיק את הגרפיקות בעצמך",
    "לחבר אותך לגרפיקאי",
  ];
  return patterns.some((p) => s.includes(p));
}

function shouldCoerceDanaDeniedImage(_messages, result) {
  if (!result || result.errorStatus) return false;
  if (extractGenerateImagePayload(result.text)) return false;
  if (result.agent !== "dana") return false;
  if (result.delegated_to) return false;
  return looksLikeImageCapabilityDeniedByAssistant(result.text);
}

async function repairMayaJsonToGenerateImage({
  fullText,
  messages,
  businessId,
  clientMemoryPayload,
  excerptMode,
}) {
  const lastUser = lastUserMessageText(messages);
  const { section } = await resolveClientMemoryForAgent(
    businessId,
    clientMemoryPayload,
  );
  let wrongExcerpt = String(fullText);
  if (excerptMode !== "dana_full") {
    const mayaSplit = wrongExcerpt.split(/\n\n---\n\n## מאיה\n\n/);
    if (mayaSplit.length >= 2) {
      wrongExcerpt = mayaSplit[mayaSplit.length - 1];
    }
  }
  wrongExcerpt = wrongExcerpt.slice(0, 4500);

  const system =
    "You reply with ONE valid JSON object only. No markdown, no Hebrew, no explanation. Keys: action (string generate_image), prompt (English string), aspect_ratio (string).";
  const user = `The user asked for a graphic/visual/banner (Hebrew app). The assistant wrongly claimed there is no in-app image generation, or offered Midjourney/external designer/Canva instead of using the built-in image tool (the app generates images via API when the model outputs generate_image JSON).

Last user message (Hebrew):
${lastUser}

Wrong assistant reply (excerpt):
${wrongExcerpt}

Client memory (may be empty):
${section && String(section).trim() ? section.slice(0, 3000) : "(none)"}

Write "prompt" as a detailed English image-generation brief (style, layout, colors, lighting; if Hebrew text should appear on image, describe it in English).
aspect_ratio: one of 1:1, 16:9, 9:16, 4:3, 3:4 — pick from the user request.

Output ONLY: {"action":"generate_image","prompt":"...","aspect_ratio":"1:1"}`;

  const r = await callAnthropicApi(
    system,
    [{ role: "user", content: [{ type: "text", text: user }] }],
    { max_tokens: 900 },
  );
  if (!r.ok) return null;
  const o = tryParseJsonObjectLoose(r.text);
  if (!isGenerateImageAction(o)) return null;
  return JSON.stringify({
    action: "generate_image",
    prompt: String(o.prompt).trim(),
    aspect_ratio:
      typeof o.aspect_ratio === "string" && o.aspect_ratio.trim()
        ? o.aspect_ratio.trim()
        : "1:1",
  });
}

async function enrichResultWithGenerateImage(result, businessId, ctx = {}) {
  if (!result || result.errorStatus || result.text == null) return result;

  let working = { ...result, text: result.text };
  const coerceMaya = shouldCoerceMayaImage(ctx.messages, working);
  const coerceDana = shouldCoerceDanaDeniedImage(ctx.messages, working);
  if (coerceMaya || coerceDana) {
    const jsonLine = await repairMayaJsonToGenerateImage({
      fullText: working.text,
      messages: ctx.messages,
      businessId,
      clientMemoryPayload: ctx.client_memory,
      excerptMode: coerceDana ? "dana_full" : "maya_section",
    });
    if (jsonLine) {
      working = {
        ...working,
        text: injectMayaGenerateJson(working.text, jsonLine),
      };
    }
  }

  let extracted = extractGenerateImagePayload(working.text);

  // Loop detection: Maya promised an image but didn't produce JSON
  if (
    !extracted &&
    (working.delegated_to === "maya" || working.agent === "maya")
  ) {
    const lower = String(working.text).toLowerCase();
    const DELAY_PATTERNS = [
      "בדרך", "עוד שניות", "ממתין", "מסיימת", "מכינה", "רגע אחד",
      "עובדת על", "מעבדת", "יוצרת", "מייצרת", "ברגעים", "תכף",
    ];
    const hasDelayPattern = DELAY_PATTERNS.some((p) => lower.includes(p));
    const looksLikeImageReq = looksLikeVisualImageRequest(
      lastUserMessageText(ctx.messages),
    );
    if (hasDelayPattern || looksLikeImageReq) {
      console.warn("[maya-loop] delay pattern detected, forcing generation");
      const forceJson = await repairMayaJsonToGenerateImage({
        fullText:
          "Maya promised an image but returned no JSON. User asked for a graphic. Generate the JSON now.",
        messages: ctx.messages,
        businessId,
        clientMemoryPayload: ctx.client_memory,
        excerptMode: "maya_section",
      });
      if (forceJson) {
        working = {
          ...working,
          text: forceJson,
        };
        extracted = extractGenerateImagePayload(working.text);
      }
    }
  }

  if (!extracted) return working;

  let finalPrompt = extracted.prompt;
  try {
    const bid = String(businessId || "");
    const isMaya = working.delegated_to === "maya" || working.agent === "maya";
    if (isMaya && isUuid(bid)) {
      // 1) נסה קודם מהזיכרון (client_memory.brand.website_content)
      let websiteData = null;
      try {
        const { data: websiteMemory } = await supabaseAdmin
          .from("client_memory")
          .select("value")
          .eq("business_id", bid)
          .eq("category", "brand")
          .eq("key", "website_content")
          .maybeSingle();
        if (websiteMemory?.value) {
          websiteData = JSON.parse(String(websiteMemory.value));
        }
      } catch {
        // ignore
      }

      // 1.5) שלוף נתוני מותג/קהל מהזיכרון
      let brandMemories = [];
      try {
        const { data: memRows } = await supabaseAdmin
          .from("client_memory")
          .select("category,key,value")
          .eq("business_id", bid)
          .in("category", ["brand", "audience", "business_profile"])
          .neq("key", "website_content");
        if (memRows) brandMemories = memRows;
      } catch {
        // ignore
      }

      // 2) שלוף מידע עסקי + מותג מטבלת businesses
      const { data: biz } = await supabaseAdmin
        .from("businesses")
        .select("website,brand_logo,brand_colors,brand_font,brand_tone,brand_differentiator,description,name,industry,target_age_min,target_age_max,target_gender,brand_style_preference,brand_secondary_font")
        .eq("id", bid)
        .maybeSingle();
      const businessWebsite =
        biz?.website != null ? String(biz.website).trim() : "";
      const hasLogo = biz?.brand_logo && String(biz.brand_logo).trim().length > 0;

      if (!websiteData && businessWebsite) {
        const cached = getCached(`website:${bid}`);
        if (cached && typeof cached === "object") {
          websiteData = cached;
        } else {
          try {
            const scraped = await scrapeWebsite(businessWebsite);
            websiteData = {
              title: scraped.title || "",
              description: scraped.description || "",
              colors: Array.isArray(scraped.colors) ? scraped.colors : [],
              content: scraped.content || "",
            };

            await supabaseAdmin.from("client_memory").upsert(
              {
                business_id: bid,
                category: "brand",
                key: "website_content",
                value: JSON.stringify(websiteData),
                source: "auto_scrape",
                confidence: 90,
              },
              { onConflict: "business_id,category,key" },
            );
            setCached(`website:${bid}`, websiteData, 24 * 60 * 60 * 1000);
          } catch (e) {
            console.warn(
              "[scrapeWebsite] failed:",
              e instanceof Error ? e.message : String(e),
            );
          }
        }
      }

      // 3) enrich prompt (בלי לדחוף HTML/raw גדול מדי)
      if (websiteData && typeof websiteData === "object") {
        const t = String(websiteData.title || "").trim();
        const d = String(websiteData.description || "").trim();
        const colors = Array.isArray(websiteData.colors)
          ? websiteData.colors.map((x) => String(x)).filter(Boolean).slice(0, 6)
          : [];
        const c = String(websiteData.content || "").trim().slice(0, 1200);

        const block =
          `\n\nWebsite insights:\n` +
          (t ? `- Title: ${t}\n` : "") +
          (d ? `- Description: ${d}\n` : "") +
          (colors.length ? `- Colors: ${colors.join(", ")}\n` : "") +
          (c ? `- Key website copy:\n${c}\n` : "");
        finalPrompt = `${finalPrompt}${block}`.trim();
      }

      // 3.5) brand identity context for Gemini
      const brandParts = [];
      if (biz?.name) brandParts.push(`Business: ${biz.name}`);
      if (biz?.industry) brandParts.push(`Industry: ${biz.industry}`);
      if (biz?.description) brandParts.push(`Description: ${biz.description}`);
      if (biz?.brand_colors && typeof biz.brand_colors === "object" && Object.keys(biz.brand_colors).length) {
        brandParts.push(`Brand colors (use EXACTLY): ${JSON.stringify(biz.brand_colors)}`);
      }
      if (Array.isArray(biz?.brand_tone) && biz.brand_tone.length) {
        brandParts.push(`Brand tone: ${biz.brand_tone.join(", ")}`);
      }
      if (biz?.brand_font) brandParts.push(`Primary font: ${biz.brand_font}`);
      if (biz?.brand_secondary_font) brandParts.push(`Secondary font: ${biz.brand_secondary_font}`);
      if (biz?.brand_style_preference) brandParts.push(`Visual style: ${biz.brand_style_preference}`);
      if (biz?.brand_differentiator) brandParts.push(`Unique value proposition: ${biz.brand_differentiator}`);
      if (biz?.target_age_min || biz?.target_age_max || biz?.target_gender) {
        brandParts.push(`Target audience: ages ${biz.target_age_min || 18}-${biz.target_age_max || 65}, ${biz.target_gender || "all"}`);
      }
      // approved styles from memory
      const approvedMem = brandMemories.find((m) => m.key === "approved_styles");
      if (approvedMem?.value) {
        try {
          const styles = JSON.parse(String(approvedMem.value));
          if (Array.isArray(styles) && styles.length) {
            const recent = styles.slice(-5).map((s) => s.prompt || s).filter(Boolean);
            if (recent.length) {
              brandParts.push(`APPROVED STYLE EXAMPLES (follow these closely):\n${recent.join("\n")}`);
            }
          }
        } catch { /* ignore */ }
      }
      const otherMem = brandMemories.filter((m) => m.key !== "approved_styles");
      if (otherMem.length) {
        const memStr = otherMem.map((m) => `${m.key}: ${m.value}`).join(" | ");
        brandParts.push(`Client memory: ${memStr}`);
      }
      if (brandParts.length) {
        finalPrompt = `BRAND IDENTITY:\n${brandParts.map((p) => `- ${p}`).join("\n")}\n\nDesign specifically for this brand using the exact colors and tone above.\n\n${finalPrompt}`;
      }

      // 4) logo hint
      if (hasLogo) {
        finalPrompt =
          `${finalPrompt}\n\nThe brand logo should be incorporated subtly in the corner.`.trim();
      }
    }
  } catch (e) {
    console.warn(
      "[enrichResultWithGenerateImage] enrich prompt failed:",
      e instanceof Error ? e.message : String(e),
    );
  }

  const gen = await generateImageWithGeminiInternal({
    prompt: finalPrompt,
    aspect_ratio: extracted.aspect_ratio,
    business_id: businessId,
  });
  const visible = stripGenerateImageJsonFromText(working.text, extracted.range);
  if (!gen.ok) {
    return {
      ...working,
      text:
        (visible || "לא ניתן לייצר את התמונה.") +
        `\n\n(${String(gen.error || "שגיאה").slice(0, 600)})`,
    };
  }
  const finalText =
    (visible && visible.length > 0 ? visible : null) ||
    gen.text ||
    "הנה התמונה:";

  // auto-save: כל תמונה שנוצרה ע"י מאיה נכנסת לספרייה
  try {
    if (working.delegated_to === "maya" || working.agent === "maya") {
      const uid =
        ctx && ctx.user_id && isUuid(String(ctx.user_id))
          ? String(ctx.user_id)
          : null;
      const row = {
        business_id: String(businessId),
        user_id: uid,
        image_base64: String(gen.image_base64),
        mime_type: String(gen.mime_type || "image/png"),
        title: "גרפיקה",
        prompt: extracted.prompt,
        agent: "maya",
        campaign_context: null,
        created_at: new Date().toISOString(),
      };
      const { error } = await supabaseAdmin.from("media_library").insert(row);
      if (error) {
        console.warn("[media_library] insert failed:", error.message);
      }

      // save generation learning to client_memory
      try {
        await supabaseAdmin.from("client_memory").upsert(
          {
            business_id: String(businessId),
            category: "brand",
            key: "last_image_style",
            value: JSON.stringify({
              prompt: extracted.prompt,
              brand_colors_used: biz?.brand_colors || null,
              generated_at: new Date().toISOString(),
              feedback: "pending",
            }),
            source: "maya_generation",
            confidence: 80,
          },
          { onConflict: "business_id,category,key" },
        );
      } catch {
        // non-critical
      }
    }
  } catch (e) {
    console.warn(
      "[media_library] insert exception:",
      e instanceof Error ? e.message : String(e),
    );
  }

  return {
    ...working,
    text: String(finalText).trim(),
    image_base64: gen.image_base64,
    mime_type: gen.mime_type,
  };
}

function messagesToAnthropicPayload(messages) {
  return (messages || []).map((m) => {
    const role = m.role === "user" ? "user" : "assistant";
    const text = String(m.text ?? "");
    const img = typeof m.image_base64 === "string" ? m.image_base64.trim() : "";
    if (role === "user" && img) {
      const mimeRaw = typeof m.mime_type === "string" ? m.mime_type.trim() : "";
      const mediaType = mimeRaw || "image/jpeg";
      const content = [
        {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: img },
        },
      ];
      if (text) content.push({ type: "text", text });
      return { role, content };
    }
    return { role, content: [{ type: "text", text }] };
  });
}

/** מחזיר סטטוס HTTP ללקוח: overload (429/529) נשאר, 5xx אחר → 502 */
function normalizeAnthropicProxyHttpStatus(status) {
  const s = Number(status);
  if (s === 429 || s === 529) return s;
  if (s >= 500) return 502;
  if (s >= 400) return s;
  return 502;
}

async function callAnthropicWithRetry(payload, maxRetries = 3) {
  const safeApiKey = sanitizeHeaderValue(ANTHROPIC_API_KEY);
  if (!safeApiKey.startsWith("sk-ant-")) {
    throw new Error("API key לא תקין בשרת.");
  }
  let lastRes = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      lastRes = await fetch(ANTHROPIC_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": safeApiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
        },
        body: JSON.stringify(payload),
      });
      if (lastRes.status === 529 || lastRes.status === 429) {
        if (attempt < maxRetries - 1) {
          const wait = Math.pow(2, attempt + 1) * 1000;
          console.warn(
            `[Claude] overloaded (${lastRes.status}), retry ${attempt + 1} in ${wait}ms`,
          );
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
      }
      return lastRes;
    } catch (e) {
      if (attempt === maxRetries - 1) throw e;
      const wait = Math.pow(2, attempt + 1) * 1000;
      console.warn(
        `[Claude] fetch error, retry ${attempt + 1} in ${wait}ms`,
        e instanceof Error ? e.message : e,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return lastRes;
}

async function callAnthropicApi(systemPrompt, anthropicMessages, options) {
  const opts = options && typeof options === "object" ? options : {};
  const safeApiKey = sanitizeHeaderValue(ANTHROPIC_API_KEY);
  if (!safeApiKey.startsWith("sk-ant-")) {
    return { ok: false, status: 500, errorText: "API key לא תקין בשרת." };
  }
  const maxTok =
    opts.max_tokens != null && Number.isFinite(Number(opts.max_tokens))
      ? Math.min(8192, Math.max(16, Math.round(Number(opts.max_tokens))))
      : ANTHROPIC_MAX_TOKENS;
  const modelName =
    opts.model != null && String(opts.model).trim() !== ""
      ? String(opts.model).trim()
      : ANTHROPIC_MODEL;
  const systemText = String(systemPrompt ?? "").trim() || "(no system prompt)";
  const payload = {
    model: modelName,
    max_tokens: maxTok,
    system: [
      {
        type: "text",
        text: systemText,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: anthropicMessages,
  };
  let upstream;
  try {
    upstream = await callAnthropicWithRetry(payload, 3);
  } catch (e) {
    return {
      ok: false,
      status: 503,
      errorText: e instanceof Error ? e.message : String(e),
    };
  }
  if (!upstream) {
    return { ok: false, status: 502, errorText: "אין תשובה מ-Claude." };
  }
  const rawText = await upstream.text();
  if (!upstream.ok) {
    return {
      ok: false,
      status: upstream.status,
      errorText: rawText,
    };
  }
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, status: 502, errorText: "תשובה לא תקינה מ-Anthropic" };
  }
  const text =
    (data.content || [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("")
      .trim() || "";
  return { ok: true, status: 200, text };
}

async function scrapeWebsiteDeep(url) {
  try {
    const { html, finalUrl } = await fetchHtmlWithTimeout(url, 10000);
    const htmlChunk = html.slice(0, 10000);
    const system =
      "You are a web analyst for a digital advertising agency. Output ONLY one valid JSON object. No markdown fences, no commentary. Use Hebrew for human-facing string values where natural. For unknown fields use empty string \"\", empty array [], or false.";
    const schema = `{
  "business_name":"","tagline":"","description":"","industry":"","phone":"","email":"","address":"","city":"","website":"",
  "services":[],"products":[],"price_range":"","unique_value":"","certifications":[],"years_in_business":"",
  "target_audience":"","target_age":"","target_gender":"","target_location":"","target_interests":[],
  "brand_colors":[],"brand_style":"","brand_tone":"","fonts_style":"",
  "main_cta":"","secondary_cta":"","key_messages":[],"pain_points":[],"promotions":[],
  "social_links":{"facebook":"","instagram":"","tiktok":"","youtube":"","linkedin":""},
  "has_ecommerce":false,"has_booking":false,"has_whatsapp":false,
  "competitors_mentioned":[],"keywords":[],"seasonal_relevance":""
}`;
    const user = `Analyze this HTML and return a single JSON object with exactly these keys (types as in the template):
${schema}

Set "website" to the business site URL if inferable, else use: ${finalUrl}

HTML:
${htmlChunk}`;

    const r = await callAnthropicApi(
      system,
      [{ role: "user", content: [{ type: "text", text: user }] }],
      { max_tokens: 2000 },
    );
    if (!r.ok) return null;
    const o = tryParseJsonObjectLoose(r.text);
    if (!o || typeof o !== "object") return null;
    return o;
  } catch (e) {
    console.warn("[scrapeWebsiteDeep]", e instanceof Error ? e.message : e);
    return null;
  }
}

async function fetchSuggestedReplies({ agentText, businessId }) {
  try {
    const bid = businessId && isUuid(String(businessId)) ? String(businessId) : "";
    const { section: clientMemoryBlock } = await resolveClientMemoryForAgent(
      businessId,
      null,
    );
    const excerpt = String(agentText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2500);
    if (!excerpt) return [];

    // Throttle + cache (per business + last agent message hash)
    const msgHash = hashText(excerpt).slice(0, 16);
    const stateKey = `suggestions:state:${bid}`;
    const prevState = getCached(stateKey);
    if (
      prevState &&
      prevState.lastHash === msgHash &&
      typeof prevState.lastAt === "number" &&
      Date.now() - prevState.lastAt < 30_000
    ) {
      const cached = getCached(`suggestions:${bid}:${msgHash}`);
      if (Array.isArray(cached)) return cached;
      return [];
    }

    const cached = getCached(`suggestions:${bid}:${msgHash}`);
    if (Array.isArray(cached)) return cached;

    const userBlock = `בהתבסס על השאלה האחרונה של הסוכן ועל המידע על הלקוח,
הצע 3 תשובות קצרות ורלוונטיות שהלקוח יכול לבחור.
החזר JSON בלבד: {"suggested_replies":["תשובה1","תשובה2","תשובה3"]}

שאלת הסוכן:
${excerpt}

מידע על הלקוח:
${clientMemoryBlock && String(clientMemoryBlock).trim() ? String(clientMemoryBlock).trim().slice(0, 1200) : "(אין מידע נוסף)"}

הכללים:
- כל תשובה עד 5 מילים
- רלוונטית לשאלה הספציפית
- מותאמת לעסק הספציפי של הלקוח
- בעברית`;

    const system =
      "החזר רק אובייקט JSON תקף בלבד, בלי markdown ובלי טקסט נוסף.";
    const r = await callAnthropicApi(
      system,
      [
        {
          role: "user",
          content: [{ type: "text", text: userBlock }],
        },
      ],
      { max_tokens: 400 },
    );
    if (!r.ok) return [];
    const o = tryParseJsonObjectLoose(r.text);
    if (!o || typeof o !== "object" || !Array.isArray(o.suggested_replies)) {
      return [];
    }
    const out = o.suggested_replies
      .filter((x) => typeof x === "string")
      .map((s) => String(s).trim())
      .filter((s) => s.length > 0)
      .slice(0, 3);
    if (bid) {
      setCached(`suggestions:${bid}:${msgHash}`, out, 60 * 60 * 1000);
      setCached(stateKey, { lastHash: msgHash, lastAt: Date.now() }, 60 * 60 * 1000);
    }
    return out;
  } catch {
    return [];
  }
}

function shouldFetchSuggestedRepliesAfterAgentTurn(body, result) {
  if (!isSuggestedRepliesEnabled(body)) return false;
  if (result.errorStatus || !String(result.text || "").trim()) return false;
  const msgs = body?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return false;
  const last = msgs[msgs.length - 1];
  return last && last.role === "user";
}

async function buildAgentHttpPayload(body, result) {
  let suggested_replies = [];
  if (shouldFetchSuggestedRepliesAfterAgentTurn(body, result)) {
    suggested_replies = await fetchSuggestedReplies({
      agentText: result.text,
      businessId: body.business_id,
      clientMemoryPayload: null,
    });
  }

  // Extract pending_actions from agent text
  const { cleanText, pendingActions } = extractPendingActions(result.text);

  return {
    text: cleanText,
    agent: result.agent,
    memory_updates: Array.isArray(result.memory_updates)
      ? result.memory_updates
      : [],
    ...(result.delegated_to ? { delegated_to: result.delegated_to } : {}),
    ...(result.image_base64
      ? {
          image_base64: result.image_base64,
          mime_type: result.mime_type || "image/png",
        }
      : {}),
    ...(pendingActions.length > 0 ? { pending_actions: pendingActions } : {}),
    suggested_replies,
  };
}

async function runSpecialistAfterDana(
  specialistKey,
  anthropicMessages,
  businessId,
  businessName,
  businessIndustry,
  metaContext,
  clientMemorySection,
  brandKitSection,
  danaBrief,
) {
  const system = buildAgentSystem(
    specialistKey,
    businessId,
    businessName,
    businessIndustry,
    metaContext,
    clientMemorySection,
    brandKitSection,
    {},
  );
  const handoff =
    specialistKey === "maya"
      ? `דנה העבירה אליך. הקשר מהלקוח:\n${danaBrief || "מלאי לפי ההודעות האחרונות בשיחה."}\n\n**חובה:** אם מדובר בוויז'ואל/תמונה/גרפיקה — **אל** תכתבי שאינך יוצרת תמונות. החזירי **רק** JSON \`generate_image\` (שורה אחת) — השרת יייצר תמונה ללקוח. **אל תשאלי שאלות.**\nרק אם הלקוח ביקש במפורש בריף טקסט בלי ייצור תמונה — עני בעברית לפי "יוצא מן הכלל" בפרומפט שלך.`
      : `דנה (מנהלת לקוח) העבירה אליך את הטיפול. הנחיה ממנה:\n${danaBrief || "ענה לפי בקשת הלקוח האחרונה בשיחה, במלואה."}\n\nענה למשתמש בעברית והשלם את המשימה.`;
  const msgs = [
    ...anthropicMessages,
    {
      role: "user",
      content: [{ type: "text", text: handoff }],
    },
  ];
  return callAnthropicApi(
    system,
    msgs,
    specialistKey === "maya" ? { model: ANTHROPIC_MAYA_MODEL } : {},
  );
}

async function runDanaWithDelegation(
  anthropicMessages,
  businessId,
  businessName,
  businessIndustry,
  metaContext,
  clientMemorySection,
  brandKitSection,
  clientMemoryEmpty,
  metaConnected,
) {
  const msgs = anthropicMessages;

  const danaOpts = { client_memory_empty: clientMemoryEmpty };
  if (metaConnected === false) danaOpts.meta_connected = false;

  const system = buildAgentSystem(
    "dana",
    businessId,
    businessName,
    businessIndustry,
    metaContext,
    clientMemorySection,
    brandKitSection,
    danaOpts,
  );
  const danaRes = await callAnthropicApi(system, msgs);
  if (!danaRes.ok) {
    return {
      text: "",
      agent: "dana",
      delegated_to: null,
      memory_updates: [],
      errorStatus: danaRes.status,
      errorDetails: danaRes.errorText,
    };
  }
  const full = danaRes.text;
  const parsed = parseDanaStructuredResponse(full);
  const sub = parsed.delegate;
  if (!sub) {
    return {
      text: parsed.text,
      agent: "dana",
      delegated_to: null,
      memory_updates: parsed.memory_updates,
    };
  }
  const danaPart = parsed.text;
  const specRes = await runSpecialistAfterDana(
    sub,
    anthropicMessages,
    businessId,
    businessName,
    businessIndustry,
    metaContext,
    clientMemorySection,
    brandKitSection,
    danaPart,
  );
  if (!specRes.ok) {
    const errNote = `\n\n---\n(שגיאה בשליפת תשובת ${AGENT_DISPLAY_HE[sub]}: ${String(specRes.errorText || "").slice(0, 400)})`;
    return {
      text: (danaPart || full) + errNote,
      agent: "dana",
      delegated_to: sub,
      memory_updates: parsed.memory_updates,
      errorStatus: specRes.status,
      errorDetails: specRes.errorText,
    };
  }
  const combined = `${danaPart}\n\n---\n\n## ${AGENT_DISPLAY_HE[sub]}\n\n${specRes.text}`;
  return {
    text: combined,
    agent: "dana",
    delegated_to: sub,
    memory_updates: parsed.memory_updates,
  };
}

function buildAnthropicProxyErrorResponse(result) {
  const st = normalizeAnthropicProxyHttpStatus(result.errorStatus);
  const overload = st === 429 || st === 529;
  return {
    httpStatus: st,
    json: {
      error: overload
        ? "השרת עמוס כרגע — נסה שוב עוד כמה שניות."
        : "שגיאה מהשרת של Anthropic",
      error_code: overload ? "anthropic_overload" : "anthropic_error",
      details: result.errorDetails,
      text: result.text || "",
      agent: result.agent,
      memory_updates: Array.isArray(result.memory_updates)
        ? result.memory_updates
        : [],
      delegated_to: result.delegated_to ?? undefined,
      ...(result.image_base64
        ? {
            image_base64: result.image_base64,
            mime_type: result.mime_type || "image/png",
          }
        : {}),
      suggested_replies: [],
    },
  };
}

async function runDanaOrchestratorOnly(
  anthropicMessages,
  businessId,
  businessName,
  businessIndustry,
  metaContext,
  clientMemorySection,
  brandKitSection,
  clientMemoryEmpty,
  metaConnected,
) {
  const danaOpts = { client_memory_empty: clientMemoryEmpty };
  if (metaConnected === false) danaOpts.meta_connected = false;
  const system = buildAgentSystem(
    "dana",
    businessId,
    businessName,
    businessIndustry,
    metaContext,
    clientMemorySection,
    brandKitSection,
    danaOpts,
  );
  const danaRes = await callAnthropicApi(system, anthropicMessages);
  if (!danaRes.ok) {
    return {
      text: "",
      agent: "dana",
      delegated_to: null,
      memory_updates: [],
      errorStatus: danaRes.status,
      errorDetails: danaRes.errorText,
    };
  }
  const parsed = parseDanaStructuredResponse(danaRes.text);
  return {
    text: parsed.text,
    agent: "dana",
    delegated_to: null,
    memory_updates: parsed.memory_updates,
  };
}

async function runDirectAgentTurn(
  agentKey,
  anthropicMessages,
  businessId,
  businessName,
  businessIndustry,
  metaContext,
  clientMemorySection,
  brandKitSection,
) {
  const system = buildAgentSystem(
    agentKey,
    businessId,
    businessName,
    businessIndustry,
    metaContext,
    clientMemorySection,
    brandKitSection,
    {},
  );
  const r = await callAnthropicApi(
    system,
    anthropicMessages,
    agentKey === "maya" ? { model: ANTHROPIC_MAYA_MODEL } : {},
  );
  if (!r.ok) {
    return {
      text: "",
      agent: agentKey,
      delegated_to: null,
      memory_updates: [],
      errorStatus: r.status,
      errorDetails: r.errorText,
    };
  }
  return {
    text: r.text,
    agent: agentKey,
    delegated_to: null,
    memory_updates: [],
  };
}

async function runAgentTurn(body) {
  const {
    messages,
    business_id,
    business_name,
    business_industry,
    meta_context,
    user_id,
    agent: agentRaw,
    client_memory_empty: clientMemoryEmptyRaw,
    meta_connected: metaConnectedRaw,
  } = body || {};

  const requested = normalizeAgentKey(agentRaw) || "dana";

  // Auto-fetch meta context with enriched campaign insights for agents
  let resolvedMetaContext = meta_context;
  let resolvedMetaConnected = metaConnectedRaw;
  if (!resolvedMetaContext && business_id && isUuid(String(business_id))) {
    try {
      // First try enriched campaigns cache (has spend/clicks/leads per campaign)
      const enrichedKey = `meta-campaigns:${business_id}:last_7d`;
      const enrichedCached = getCached(enrichedKey);
      const baseCached = getCached(`meta-ctx:${business_id}`);

      if (enrichedCached && baseCached) {
        // Merge enriched campaign data into base context
        resolvedMetaContext = { ...baseCached, campaigns: enrichedCached.campaigns || baseCached.campaigns };
        resolvedMetaConnected = baseCached.connected === true;
      } else if (baseCached) {
        resolvedMetaContext = baseCached;
        resolvedMetaConnected = baseCached.connected === true;
      } else {
        const ctx = await fetchMetaContextForBusiness(String(business_id));
        resolvedMetaContext = ctx;
        resolvedMetaConnected = ctx.connected === true;
        setCached(`meta-ctx:${business_id}`, ctx, 15 * 60 * 1000);
      }
    } catch (e) {
      console.warn("[runAgentTurn] failed to fetch meta context:", e instanceof Error ? e.message : e);
    }
  }

  const metaConnected =
    resolvedMetaConnected === false
      ? false
      : resolvedMetaConnected === true
        ? true
        : undefined;
  if (!Array.isArray(messages)) {
    const err = new Error('חסר "messages" (מערך).');
    err.statusCode = 400;
    throw err;
  }
  if (messages.length === 0) {
    const err = new Error(
      "messages ריק — שלח לפחות הודעה אחת (למשל פתיחה מהממשק).",
    );
    err.statusCode = 400;
    throw err;
  }

  const { section: clientMemorySection, byCategory } =
    await resolveClientMemoryForAgent(business_id, null);

  const anthropicMessages = messagesToAnthropicPayload(messages);

  const brandRow = await fetchBusinessBrandingRow(business_id);
  const brandKitSection = buildBrandKitSystemBlock(brandRow);

  let clientMemoryEmpty = false;
  if (requested === "dana") {
    if (typeof clientMemoryEmptyRaw === "boolean") {
      clientMemoryEmpty = clientMemoryEmptyRaw;
    } else {
      clientMemoryEmpty = !isOnboardingCompleteFromByCategory(byCategory);
    }
  }

  if (requested === "dana") {
    const onboardingComplete = isOnboardingCompleteFromByCategory(byCategory);
    const userMsg = lastUserMessageText(messages);
    const intent = detectIntent(userMsg);

    // Onboarding (or uncertain intent): dana asks at most 1 question.
    let routedResult = null;
    if (!onboardingComplete || intent === "dana") {
      routedResult = await runDanaOrchestratorOnly(
        anthropicMessages,
        business_id,
        business_name,
        business_industry,
        resolvedMetaContext,
        clientMemorySection,
        brandKitSection,
        clientMemoryEmpty,
        metaConnected,
      );
    } else if (intent === "campaign") {
      const y = await runDirectAgentTurn(
        "yoni",
        anthropicMessages,
        business_id,
        business_name,
        business_industry,
        resolvedMetaContext,
        clientMemorySection,
        brandKitSection,
      );
      const r = await runDirectAgentTurn(
        "ron",
        anthropicMessages,
        business_id,
        business_name,
        business_industry,
        resolvedMetaContext,
        clientMemorySection,
        brandKitSection,
      );
      routedResult = {
        text:
          `✍️ יוני כתב לך:\n\n${String(y.text || "").trim()}`.trim() +
          `\n\n---\n\n📊 רון ניתח:\n\n${String(r.text || "").trim()}`.trim(),
        agent: "dana",
        delegated_to: null,
        memory_updates: [],
        ...(y.errorStatus || r.errorStatus
          ? {
              errorStatus: y.errorStatus || r.errorStatus,
              errorDetails:
                y.errorDetails || r.errorDetails || "Campaign routing error",
            }
          : {}),
      };
    } else {
      const agentKey = intent; // maya/yoni/ron/noa
      const direct = await runDirectAgentTurn(
        agentKey,
        anthropicMessages,
        business_id,
        business_name,
        business_industry,
        resolvedMetaContext,
        clientMemorySection,
        brandKitSection,
      );
      const prefix =
        agentKey === "yoni"
          ? "✍️ יוני הכין לך 3 גרסאות:\n\n"
          : agentKey === "ron"
            ? "📊 רון ניתח והכין המלצות:\n\n"
            : agentKey === "noa"
              ? "📱 נועה הכינה לוח תוכן:\n\n"
              : agentKey === "maya"
                ? "🎨 מאיה יצרה עבורך ויז'ואל:\n\n"
                : "";
      routedResult = {
        ...direct,
        text:
          agentKey === "maya"
            ? direct.text // לרוב JSON בלבד; enrichResultWithGenerateImage יקבע טקסט סופי + תמונה
            : `${prefix}${String(direct.text || "").trim()}`.trim(),
        agent: agentKey,
      };
    }

    const serverMemoryPayload =
      business_id && isUuid(String(business_id))
        ? {
            business_id: String(business_id),
            by_category: byCategory,
          }
        : null;
    return await enrichResultWithGenerateImage(routedResult, business_id, {
      messages,
      client_memory: serverMemoryPayload,
      user_id,
    });
  }

  const system = buildAgentSystem(
    requested,
    business_id,
    business_name,
    business_industry,
    resolvedMetaContext,
    clientMemorySection,
    brandKitSection,
    {},
  );
  const r = await callAnthropicApi(system, anthropicMessages);
  if (!r.ok) {
    return {
      text: "",
      agent: requested,
      delegated_to: null,
      memory_updates: [],
      errorStatus: r.status,
      errorDetails: r.errorText,
    };
  }
  const singleResult = {
    text: r.text,
    agent: requested,
    delegated_to: null,
    memory_updates: [],
  };
  const serverMemoryPayload =
    business_id && isUuid(String(business_id))
      ? {
          business_id: String(business_id),
          by_category: byCategory,
        }
      : null;
  return await enrichResultWithGenerateImage(singleResult, business_id, {
    messages,
    client_memory: serverMemoryPayload,
    user_id,
  });
}

const app = express();

const corsOptions = {
  origin: process.env.APP_WEB_ORIGIN || "http://localhost:8081",
};

/** דרישת Authorization: Bearer (JWT) — אימות מלא מול Supabase בשלב הבא. */
function requireBearerAuthorization(req, res, next) {
  const raw = req.headers.authorization;
  if (
    typeof raw !== "string" ||
    !raw.trim().toLowerCase().startsWith("bearer ")
  ) {
    return res.status(401).json({ error: "חסר Authorization: Bearer <token>" });
  }
  const token = raw.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: "חסר JWT ב־Authorization" });
  }
  next();
}

app.use(cors(corsOptions));
app.use(express.json({ limit: "2mb" }));

// Rate limiting
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: "יותר מדי בקשות. נסה שוב בעוד כמה דקות." } });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "יותר מדי הודעות. נסה שוב בעוד דקה." } });
app.use("/api/", generalLimiter);
app.use("/api/chat", chatLimiter);
app.use("/api/agent", chatLimiter);

app.get("/health", (_req, res) => res.json({
  ok: true,
  timestamp: new Date().toISOString(),
  uptime_seconds: Math.round((Date.now() - SERVER_START_TIME) / 1000),
}));

app.get("/api/scrape-website", requireBearerAuthorization, async (req, res) => {
  const businessId = req.query.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר או לא תקין business_id (UUID)" });
  }
  const bid = String(businessId);
  try {
    const cached = getCached(`website:${bid}`);
    if (cached && typeof cached === "object") {
      return res.json(cached);
    }

    const { data: biz, error: be } = await supabaseAdmin
      .from("businesses")
      .select("website")
      .eq("id", bid)
      .maybeSingle();
    if (be) return res.status(500).json({ error: be.message });

    const website = biz?.website ? String(biz.website).trim() : "";
    if (!website) {
      return res.status(400).json({ error: "לעסק אין website שמור" });
    }

    const data = await scrapeWebsite(website);
    const payload = {
      title: data.title || "",
      description: data.description || "",
      colors: Array.isArray(data.colors) ? data.colors : [],
      content: data.content || "",
    };

    await supabaseAdmin.from("client_memory").upsert(
      {
        business_id: bid,
        category: "brand",
        key: "website_content",
        value: JSON.stringify(payload),
        source: "auto_scrape",
        confidence: 90,
      },
      { onConflict: "business_id,category,key" },
    );

    setCached(`website:${bid}`, payload, 24 * 60 * 60 * 1000);
    return res.json(payload);
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/api/scrape-website", requireBearerAuthorization, async (req, res) => {
  const { url, business_id: businessIdBody } = req.body || {};
  const businessId = businessIdBody;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר או לא תקין business_id (UUID)" });
  }
  const rawUrl = url != null ? String(url).trim() : "";
  if (!rawUrl) {
    return res.status(400).json({ error: 'חסר "url"' });
  }
  const bid = String(businessId);
  try {
    const analysis = await scrapeWebsiteDeep(rawUrl);
    if (!analysis || typeof analysis !== "object") {
      return res.status(502).json({ error: "סריקת האתר נכשלה" });
    }
    await applyWebsiteDeepScrapeToDatabase(bid, rawUrl, analysis);
    return res.json({ data: analysis, confirmed: false });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

function isDanaRecommendationsPayload(o) {
  if (!o || typeof o !== "object") return false;
  if (!Array.isArray(o.recommendations)) return false;
  return o.recommendations.every(
    (r) =>
      r &&
      typeof r === "object" &&
      typeof r.title === "string" &&
      typeof r.body === "string" &&
      typeof r.action === "string" &&
      typeof r.icon === "string",
  );
}

app.get(
  "/api/dana-recommendations",
  requireBearerAuthorization,
  async (req, res) => {
    const businessId = req.query.business_id;
    if (!businessId || !isUuid(String(businessId))) {
      return res
        .status(400)
        .json({ error: "חסר או לא תקין business_id (UUID)" });
    }
    try {
      const bid = String(businessId);
      const memCached = getCached(`dana-rec:${bid}`);
      if (memCached && typeof memCached === "object") {
        return res.json(memCached);
      }
      const sixHoursAgo = new Date(
        Date.now() - 6 * 60 * 60 * 1000,
      ).toISOString();
      const { data: cached, error: ce } = await supabaseAdmin
        .from("recommendations_cache")
        .select("payload,updated_at")
        .eq("business_id", bid)
        .gte("updated_at", sixHoursAgo)
        .maybeSingle();
      if (ce) {
        console.warn("[GET /api/dana-recommendations] cache read:", ce.message);
      }
      if (cached && cached.payload && typeof cached.payload === "object") {
        setCached(`dana-rec:${bid}`, cached.payload, 6 * 60 * 60 * 1000);
        return res.json(cached.payload);
      }

      const { section } = await resolveClientMemoryForAgent(bid, null);
      const brandRow = await fetchBusinessBrandingRow(bid);
      const brandKit = buildBrandKitSystemBlock(brandRow);
      const today = new Date().toISOString().slice(0, 10);
      const system =
        'את דנה. טון: מקצועי, קצר, ממוקד. החזר JSON בלבד בדיוק במבנה: {"recommendations":[{"title":"...","body":"...","action":"...","icon":"..."}]}';
      const user = `תאריך היום: ${today}

${brandKit && String(brandKit).trim() ? String(brandKit).trim() : ""}

## מה שאנחנו יודעים על הלקוח (זיכרון/אוןבורדינג):
${section || "(אין)"}

תן 3 המלצות שיווקיות קצרות וספציפיות בהתאם ל-Brand Kit ולמה שאנחנו יודעים.
- body: עד 2 שורות
- action: משפט seed שהמשתמש ילחץ עליו כדי לפתוח צ׳אט
- icon: אמוג׳י מתאים`;
      const r = await callAnthropicApi(
        system,
        [{ role: "user", content: [{ type: "text", text: user }] }],
        { max_tokens: 700 },
      );
      if (!r.ok) {
        return res.status(502).json({
          error: "שגיאה מ-Claude",
          details: r.errorText,
        });
      }
      const parsed = tryParseJsonObjectLoose(r.text);
      if (!isDanaRecommendationsPayload(parsed)) {
        console.warn(
          "[GET /api/dana-recommendations] bad payload:",
          String(r.text).slice(0, 600),
        );
        return res.status(502).json({ error: "פלט לא תקין מ-Claude" });
      }

      const payload = {
        recommendations: parsed.recommendations.slice(0, 3).map((x) => ({
          title: String(x.title).trim(),
          body: String(x.body).trim(),
          action: String(x.action).trim(),
          icon: String(x.icon).trim(),
        })),
      };

      setCached(`dana-rec:${bid}`, payload, 6 * 60 * 60 * 1000);

      const { error: we } = await supabaseAdmin
        .from("recommendations_cache")
        .upsert(
          { business_id: bid, payload, updated_at: new Date().toISOString() },
          { onConflict: "business_id" },
        );
      if (we) {
        console.warn(
          "[GET /api/dana-recommendations] cache write:",
          we.message,
        );
      }

      return res.json(payload);
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

app.patch(
  "/api/businesses/:id",
  requireBearerAuthorization,
  async (req, res) => {
    const id = req.params.id;
    if (!id || !isUuid(String(id))) {
      return res.status(400).json({ error: "חסר או לא תקין business_id" });
    }
    try {
      const patch = req.body && typeof req.body === "object" ? req.body : {};
      const { data, error } = await supabaseAdmin
        .from("businesses")
        .update(patch)
        .eq("id", String(id))
        .select("*")
        .single();
      if (error) {
        console.warn("[PATCH /api/businesses/:id] supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }
      return res.json({ business: data });
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

app.get(
  "/api/media-library",
  requireBearerAuthorization,
  async (req, res) => {
    const businessId = req.query.business_id;
    if (!businessId || !isUuid(String(businessId))) {
      return res
        .status(400)
        .json({ error: "חסר או לא תקין business_id (UUID)" });
    }
    try {
      const { data, error } = await supabaseAdmin
        .from("media_library")
        .select(
          "id,business_id,user_id,image_base64,mime_type,title,prompt,agent,campaign_context,created_at",
        )
        .eq("business_id", String(businessId))
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        console.warn("[GET /api/media-library] supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }
      return res.json({ items: data || [] });
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

app.post(
  "/api/media-library",
  requireBearerAuthorization,
  async (req, res) => {
    try {
      const {
        business_id,
        user_id,
        image_base64,
        mime_type,
        title,
        prompt,
        agent,
        campaign_context,
      } = req.body || {};
      if (!business_id || !isUuid(String(business_id))) {
        return res.status(400).json({ error: "חסר או לא תקין business_id" });
      }
      if (image_base64 == null || String(image_base64).trim() === "") {
        return res.status(400).json({ error: 'חסר "image_base64"' });
      }
      const uid = user_id && isUuid(String(user_id)) ? String(user_id) : null;
      const row = {
        business_id: String(business_id),
        user_id: uid,
        image_base64: String(image_base64),
        mime_type:
          typeof mime_type === "string" && mime_type.trim()
            ? mime_type.trim()
            : "image/png",
        title:
          typeof title === "string" && title.trim() ? title.trim() : null,
        prompt:
          typeof prompt === "string" && prompt.trim() ? prompt.trim() : null,
        agent:
          typeof agent === "string" && agent.trim() ? agent.trim() : "maya",
        campaign_context:
          typeof campaign_context === "string" && campaign_context.trim()
            ? campaign_context.trim()
            : null,
        created_at: new Date().toISOString(),
      };
      const { data, error } = await supabaseAdmin
        .from("media_library")
        .insert(row)
        .select("*")
        .single();
      if (error) {
        console.warn("[POST /api/media-library] supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }

      // track approved style in client_memory
      if (row.prompt && row.agent === "maya") {
        try {
          const { data: existing } = await supabaseAdmin
            .from("client_memory")
            .select("value")
            .eq("business_id", String(business_id))
            .eq("category", "brand")
            .eq("key", "approved_styles")
            .maybeSingle();
          const styles = existing?.value ? JSON.parse(String(existing.value)) : [];
          if (Array.isArray(styles)) {
            styles.push({ prompt: row.prompt, saved_at: new Date().toISOString() });
            if (styles.length > 20) styles.splice(0, styles.length - 20);
          }
          await supabaseAdmin.from("client_memory").upsert(
            {
              business_id: String(business_id),
              category: "brand",
              key: "approved_styles",
              value: JSON.stringify(styles),
              source: "user_save",
              confidence: 95,
            },
            { onConflict: "business_id,category,key" },
          );
        } catch {
          // non-critical
        }
      }

      return res.json({ item: data });
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

app.delete(
  "/api/media-library/:id",
  requireBearerAuthorization,
  async (req, res) => {
    const id = req.params.id;
    if (!id || !isUuid(String(id))) {
      return res.status(400).json({ error: "חסר או לא תקין id" });
    }
    try {
      const { error } = await supabaseAdmin
        .from("media_library")
        .delete()
        .eq("id", String(id));
      if (error) {
        console.warn("[DELETE /api/media-library/:id] supabase:", error.message);
        return res.status(500).json({ error: error.message });
      }
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

// ============================================================
// Brand Templates
// ============================================================

app.get(
  "/api/brand-templates",
  requireBearerAuthorization,
  async (req, res) => {
    const businessId = req.query.business_id;
    if (!businessId || !isUuid(String(businessId))) {
      return res.status(400).json({ error: "חסר או לא תקין business_id" });
    }
    try {
      const { data: mem } = await supabaseAdmin
        .from("client_memory")
        .select("value,updated_at")
        .eq("business_id", String(businessId))
        .eq("category", "brand")
        .eq("key", "templates")
        .maybeSingle();
      const templates = mem?.value ? JSON.parse(String(mem.value)) : [];
      return res.json({ templates: Array.isArray(templates) ? templates : [] });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  },
);

app.post(
  "/api/brand-templates",
  requireBearerAuthorization,
  async (req, res) => {
    const { business_id, name, prompt, thumbnail_base64 } = req.body || {};
    if (!business_id || !isUuid(String(business_id))) {
      return res.status(400).json({ error: "חסר business_id" });
    }
    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ error: "חסר prompt" });
    }
    try {
      const { data: existing } = await supabaseAdmin
        .from("client_memory")
        .select("value")
        .eq("business_id", String(business_id))
        .eq("category", "brand")
        .eq("key", "templates")
        .maybeSingle();
      const templates = existing?.value ? JSON.parse(String(existing.value)) : [];
      const arr = Array.isArray(templates) ? templates : [];
      const tpl = {
        id: `tpl-${Date.now()}`,
        name: String(name || "").trim() || "תבנית ללא שם",
        prompt: String(prompt).trim(),
        thumbnail_base64: thumbnail_base64 ? String(thumbnail_base64).slice(0, 50000) : null,
        created_at: new Date().toISOString(),
      };
      arr.push(tpl);
      if (arr.length > 20) arr.splice(0, arr.length - 20);
      await supabaseAdmin.from("client_memory").upsert(
        {
          business_id: String(business_id),
          category: "brand",
          key: "templates",
          value: JSON.stringify(arr),
          source: "user_template",
          confidence: 100,
        },
        { onConflict: "business_id,category,key" },
      );
      return res.json({ template: tpl });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  },
);

app.delete(
  "/api/brand-templates/:id",
  requireBearerAuthorization,
  async (req, res) => {
    const templateId = req.params.id;
    const businessId = req.query.business_id;
    if (!businessId || !isUuid(String(businessId))) {
      return res.status(400).json({ error: "חסר business_id" });
    }
    try {
      const { data: existing } = await supabaseAdmin
        .from("client_memory")
        .select("value")
        .eq("business_id", String(businessId))
        .eq("category", "brand")
        .eq("key", "templates")
        .maybeSingle();
      const templates = existing?.value ? JSON.parse(String(existing.value)) : [];
      const arr = Array.isArray(templates) ? templates : [];
      const filtered = arr.filter((t) => t.id !== templateId);
      await supabaseAdmin.from("client_memory").upsert(
        {
          business_id: String(businessId),
          category: "brand",
          key: "templates",
          value: JSON.stringify(filtered),
          source: "user_template",
          confidence: 100,
        },
        { onConflict: "business_id,category,key" },
      );
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  },
);

function titleFromFirstUserMessage(messages) {
  const arr = Array.isArray(messages) ? messages : [];
  const firstUser = arr.find((m) => m && m.role === "user" && m.text);
  const raw = firstUser ? String(firstUser.text) : "";
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "שיחה חדשה";
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

function safeChatSessionMessageArray(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && typeof m === "object")
    .map((m) => ({
      id: m.id != null ? String(m.id) : `m-${Date.now()}`,
      role: m.role === "user" ? "user" : "agent",
      text: m.text != null ? String(m.text) : "",
      createdAt:
        m.createdAt != null && Number.isFinite(Number(m.createdAt))
          ? Number(m.createdAt)
          : Date.now(),
      ...(m.image_base64 ? { image_base64: String(m.image_base64) } : {}),
      ...(m.mime_type ? { mime_type: String(m.mime_type) } : {}),
      ...(m.agent ? { agent: String(m.agent) } : {}),
    }));
}

app.post(
  "/api/seasonal-campaign-idea",
  requireBearerAuthorization,
  async (req, res) => {
    const { business_id, event_name, event_date } = req.body || {};
    if (!business_id || !isUuid(String(business_id))) {
      return res.status(400).json({ error: "חסר או לא תקין business_id (UUID)" });
    }
    const name = String(event_name || "").trim();
    const date = String(event_date || "").trim();
    if (!name) return res.status(400).json({ error: "חסר event_name" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "event_date לא תקין (YYYY-MM-DD)" });
    }
    try {
      const bid = String(business_id);
      const brandRow = await fetchBusinessBrandingRow(bid);
      const desc =
        brandRow?.description != null && String(brandRow.description).trim()
          ? String(brandRow.description).trim()
          : "";
      const tone = Array.isArray(brandRow?.brand_tone)
        ? brandRow.brand_tone
            .map((x) => String(x))
            .filter(Boolean)
            .slice(0, 6)
            .join(", ")
        : "";
      const geo =
        brandRow?.target_geo != null && String(brandRow.target_geo).trim()
          ? String(brandRow.target_geo).trim()
          : "";

      const system = `תן רעיון קמפיין של משפט אחד בעברית, ספציפי לעסק הזה ולאירוע.
קצר, יצירתי, מעשי. ללא פתיח. ללא סיום. רק הרעיון.`;

      const user = `אירוע: ${name}
תאריך: ${date}

פרטי העסק:
תיאור: ${desc || "—"}
טון מועדף: ${tone || "—"}
אזור/קהל: ${geo || "—"}`;

      const r = await callAnthropicApi(
        system,
        [{ role: "user", content: [{ type: "text", text: user }] }],
        { max_tokens: 120 },
      );
      if (!r.ok) {
        return res.status(502).json({
          error: "שגיאה מ-Claude",
          details: r.errorText,
        });
      }
      const idea = String(r.text || "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^["'“”]+|["'“”]+$/g, "")
        .slice(0, 180);
      if (!idea) return res.status(502).json({ error: "פלט ריק מ-Claude" });
      return res.json({ idea });
    } catch (e) {
      return res.status(500).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

app.post("/api/chat-sessions", requireBearerAuthorization, async (req, res) => {
  try {
    const { business_id, user_id, title: titleRaw, messages, agent } = req.body || {};
    if (!business_id || !isUuid(String(business_id))) {
      return res.status(400).json({ error: "חסר או לא תקין business_id" });
    }
    // cache invalidation: suggested replies depend on latest turn
    deleteCachedByPrefix(`suggestions:${String(business_id)}:`);
    deleteCached(`suggestions:state:${String(business_id)}`);
    const uid = user_id && isUuid(String(user_id)) ? String(user_id) : null;
    const msgs = safeChatSessionMessageArray(messages);
    const title =
      typeof titleRaw === "string" && titleRaw.trim() !== ""
        ? titleRaw.trim()
        : titleFromFirstUserMessage(msgs);
    const a = normalizeAgentKey(agent) || "dana";
    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("chat_sessions")
      .insert({
        business_id: String(business_id),
        user_id: uid,
        title,
        messages: msgs,
        agent: a,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single();
    if (error) {
      console.warn("[POST /api/chat-sessions] supabase:", error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.json({ session: data });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get("/api/chat-sessions", requireBearerAuthorization, async (req, res) => {
  const businessId = req.query.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר או לא תקין business_id (UUID)" });
  }
  try {
    const { data, error } = await supabaseAdmin
      .from("chat_sessions")
      .select("id,business_id,user_id,title,agent,created_at,updated_at,messages")
      .eq("business_id", String(businessId))
      .order("updated_at", { ascending: false })
      .limit(20);
    if (error) {
      console.warn("[GET /api/chat-sessions] supabase:", error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.json({ sessions: data || [] });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get(
  "/api/chat-sessions/:id",
  requireBearerAuthorization,
  async (req, res) => {
  const id = req.params.id;
  if (!id || !isUuid(String(id))) {
    return res.status(400).json({ error: "חסר או לא תקין id" });
  }
  try {
    const { data, error } = await supabaseAdmin
      .from("chat_sessions")
      .select("*")
      .eq("id", String(id))
      .maybeSingle();
    if (error) {
      console.warn("[GET /api/chat-sessions/:id] supabase:", error.message);
      return res.status(500).json({ error: error.message });
    }
    if (!data) return res.status(404).json({ error: "session לא נמצא" });
    return res.json({ session: data });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
  },
);

app.patch(
  "/api/chat-sessions/:id",
  requireBearerAuthorization,
  async (req, res) => {
  const id = req.params.id;
  if (!id || !isUuid(String(id))) {
    return res.status(400).json({ error: "חסר או לא תקין id" });
  }
  try {
    const { messages, title } = req.body || {};
    const patch = {
      ...(messages != null ? { messages: safeChatSessionMessageArray(messages) } : {}),
      ...(typeof title === "string" && title.trim() !== ""
        ? { title: title.trim() }
        : {}),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin
      .from("chat_sessions")
      .update(patch)
      .eq("id", String(id))
      .select("id")
      .single();
    if (error) {
      console.warn("[PATCH /api/chat-sessions/:id] supabase:", error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
  },
);

app.get("/api/client-memory", async (req, res) => {
  const businessId = req.query.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res
      .status(400)
      .json({ error: "חסר או לא תקין business_id (UUID)" });
  }
  try {
    const bid = String(businessId);
    const cached = getCached(`mem:${bid}`);
    if (cached && cached.byCategory && typeof cached.byCategory === "object") {
      return res.json({
        business_id: bid,
        by_category: cached.byCategory,
        rows: [],
      });
    }
    const rows = await fetchClientMemoryRows(bid);
    const by_category = rowsToByCategory(rows);
    setCached(
      `mem:${bid}`,
      { byCategory: by_category, section: buildClientMemoryNarrativeBlock(by_category) },
      5 * 60 * 1000,
    );
    return res.json({ business_id: bid, by_category, rows });
  } catch (e) {
    return res.status(500).json({
      error: "שגיאה בשליפת זיכרון לקוח",
      details: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/api/client-memory", async (req, res) => {
  const {
    business_id: bid,
    category,
    key,
    value,
    source,
    confidence,
  } = req.body || {};
  if (!bid || !isUuid(String(bid))) {
    return res.status(400).json({ error: "חסר או לא תקין business_id" });
  }
  if (!CLIENT_MEMORY_CATEGORIES.has(String(category || ""))) {
    return res.status(400).json({ error: "category לא תקין" });
  }
  try {
    const { data: bRow, error: be } = await supabaseAdmin
      .from("businesses")
      .select("user_id")
      .eq("id", String(bid))
      .maybeSingle();
    if (be) return res.status(500).json({ error: be.message });
    const r = await upsertClientMemoryRecord({
      businessId: String(bid),
      userId: bRow?.user_id ?? null,
      category: String(category),
      key,
      value,
      source,
      confidence,
    });
    if (!r.ok) {
      return res.status(400).json({ error: r.error || "שמירה נכשלה" });
    }

    // cache invalidation: client memory + dana recommendations depend on it
    deleteCached(`mem:${String(bid)}`);
    deleteCached(`dana-rec:${String(bid)}`);

    // onboarding → businesses (best-effort; לא מפיל את הבקשה אם נכשל)
    try {
      const cat = String(category || "").trim();
      const k = String(key || "").trim();
      const v = String(value ?? "").trim();
      const bidStr = String(bid);

      if (cat === "business_profile" && k === "business_overview") {
        await patchBusiness(bidStr, { description: v });
      } else if (cat === "brand" && k === "competitive_advantage") {
        await patchBusiness(bidStr, { brand_differentiator: v });
      } else if (cat === "insights" && k === "competitors") {
        await patchBusiness(bidStr, { competitors: parseCompetitorsList(v) });
      } else if (cat === "preferences" && k === "messaging_tone") {
        const tones = v
          .split(/,|\n|;|\|/g)
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 5);
        await patchBusiness(bidStr, { brand_tone: tones });
      } else if (cat === "audience" && k === "ideal_customer") {
        await patchBusiness(bidStr, {
          target_geo: v,
          target_gender: guessTargetGenderFromText(v),
        });
      }
    } catch (e) {
      console.warn(
        "[client-memory] mirror to businesses failed:",
        e instanceof Error ? e.message : String(e),
      );
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get("/api/meta-context", async (req, res) => {
  const businessId = req.query.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res
      .status(400)
      .json({ error: "חסר או לא תקין business_id (UUID)" });
  }
  try {
    const bid = String(businessId);
    const cached = getCached(`meta-ctx:${bid}`);
    if (cached) return res.json(cached);
    const payload = await fetchMetaContextForBusiness(bid);
    setCached(`meta-ctx:${bid}`, payload, 15 * 60 * 1000);
    return res.json(payload);
  } catch (e) {
    return res.status(500).json({
      error: "שגיאה בשליפת נתוני Meta",
      details: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/api/disconnect-meta", requireBearerAuthorization, async (req, res) => {
  const businessId = req.body?.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר business_id" });
  }
  try {
    const { error } = await supabaseAdmin
      .from("businesses")
      .update({
        meta_access_token: null,
        meta_token_expires_at: null,
        meta_user_id: null,
        meta_ad_account_ids: [],
        meta_page_ids: [],
        meta_instagram_ids: [],
        meta_pixel_ids: [],
        selected_ad_account_id: null,
        selected_page_id: null,
        selected_instagram_id: null,
      })
      .eq("id", businessId);
    if (error) return res.status(500).json({ error: error.message });

    // נקה cache
    cache.delete(`meta-ctx:${businessId}`);

    return res.json({ ok: true });
  } catch (e) {
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete("/api/account", requireBearerAuthorization, async (req, res) => {
  const token = (req.headers.authorization || "").slice(7).trim();
  const payload = decodeJwtPayload(token);
  const userId = payload?.sub;
  if (!userId) {
    return res.status(401).json({ error: "לא ניתן לזהות משתמש" });
  }

  try {
    // Get all businesses for this user
    const { data: businesses } = await supabaseAdmin
      .from("businesses")
      .select("id")
      .eq("user_id", userId);

    const businessIds = (businesses || []).map((b) => b.id);

    // Delete in order (child tables first)
    if (businessIds.length > 0) {
      await supabaseAdmin.from("media_library").delete().in("business_id", businessIds);
      await supabaseAdmin.from("chat_sessions").delete().eq("user_id", userId);
      await supabaseAdmin.from("alerts").delete().in("business_id", businessIds);
      await supabaseAdmin.from("client_memory").delete().eq("user_id", userId);
      await supabaseAdmin.from("businesses").delete().eq("user_id", userId);
    }

    // Delete auth user
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authError) {
      console.error("[DELETE /api/account] auth delete error:", authError);
    }

    // Clear caches
    for (const bid of businessIds) {
      deleteCachedByPrefix(`meta-ctx:${bid}`);
      deleteCachedByPrefix(`reco:${bid}`);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/account] error:", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// --- Weekly Report ---
async function generateWeeklyReportForBusiness(businessId) {
  try {
    const ctx = await fetchMetaContextForBusiness(businessId);
    if (!ctx.connected) return null;

    const { data: biz } = await supabaseAdmin
      .from("businesses")
      .select("name, user_id")
      .eq("id", businessId)
      .maybeSingle();
    if (!biz) return null;

    const summary = `עסק: ${biz.name}\nקמפיינים פעילים: ${ctx.active_campaigns_count}\nהוצאה היום: ₪${ctx.today.spend}\nקליקים: ${ctx.today.clicks}\nלידים: ${ctx.today.leads || 0}`;

    // Ask Ron to analyze
    const ronPrompt = `אתה רון, אנליסט ביצועים. כתוב סיכום שבועי קצר (4-5 משפטים) בעברית עבור העסק הבא:\n${summary}\nנתוני הוצאה 7 ימים: ${JSON.stringify(ctx.spend_last_7_days)}\nקמפיינים: ${JSON.stringify(ctx.campaigns.map(c => ({ name: c.name, status: c.status })))}\nתן סיכום ביצועים עם 1-2 המלצות קונקרטיות.`;

    const ronRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: ronPrompt }],
      }),
    });
    const ronJson = await ronRes.json().catch(() => ({}));
    const analysis = ronJson?.content?.[0]?.text || "לא ניתן ליצור ניתוח השבוע.";

    // Save to proactive_messages
    await supabaseAdmin.from("proactive_messages").insert({
      business_id: businessId,
      type: "weekly_report",
      title: `סיכום שבועי — ${biz.name}`,
      body: analysis,
      meta: { spend: ctx.today.spend, clicks: ctx.today.clicks, leads: ctx.today.leads, active: ctx.active_campaigns_count },
    });

    return { businessId, name: biz.name, userId: biz.user_id, analysis };
  } catch (e) {
    console.warn("[weekly-report] error for business", businessId, ":", e instanceof Error ? e.message : String(e));
    return null;
  }
}

app.post("/api/send-weekly-report", async (req, res) => {
  // Authenticate via CRON_SECRET or Bearer JWT
  const authHeader = (req.headers.authorization || "").trim();
  const isCron = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;
  if (!isCron) {
    return res.status(401).json({ error: "לא מורשה" });
  }

  try {
    const { data: rows } = await supabaseAdmin
      .from("businesses")
      .select("id")
      .not("meta_access_token", "is", null);
    const ids = (rows || []).map((r) => r.id).filter(Boolean);

    let sent = 0;
    for (const bid of ids) {
      const report = await generateWeeklyReportForBusiness(bid);
      if (!report) continue;

      // Send email if Resend configured
      if (resend && report.userId) {
        try {
          const { data: auth } = await supabaseAdmin.auth.admin.getUserById(report.userId);
          const email = auth?.user?.email;
          if (email) {
            await resend.emails.send({
              from: FROM_EMAIL,
              to: email,
              subject: `סיכום שבועי — ${report.name} | Puls.`,
              html: `<div dir="rtl" style="font-family:system-ui,sans-serif"><h2>סיכום שבועי — ${report.name}</h2><p style="white-space:pre-wrap;line-height:1.8">${report.analysis}</p><hr style="border:none;border-top:1px solid #eee;margin:20px 0"><p style="color:#888;font-size:13px">נשלח אוטומטית מ-Puls.</p></div>`,
            });
            sent++;
          }
        } catch (emailErr) {
          console.warn("[weekly-report] email error:", emailErr instanceof Error ? emailErr.message : String(emailErr));
        }
      }
    }

    return res.json({ ok: true, businesses: ids.length, emails_sent: sent });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

function normalizeMetaAssetList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const it of raw) {
    if (it && typeof it === "object") {
      const id = String(it.id || it.value || "").trim();
      const name = String(it.name || it.label || id).trim();
      if (id) out.push({ id, name });
      continue;
    }
    const id = String(it || "").trim();
    if (id) out.push({ id, name: id });
  }
  // unique by id
  const seen = new Set();
  return out.filter((x) => {
    if (seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  });
}

app.get("/api/meta-assets", async (req, res) => {
  const businessId = req.query.business_id;
  const type = String(req.query.type || "").trim();
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר או לא תקין business_id (UUID)" });
  }
  if (!["adaccounts", "pages", "instagram"].includes(type)) {
    return res.status(400).json({ error: "type לא תקין" });
  }
  try {
    const bid = String(businessId);
    const { data: row, error } = await supabaseAdmin
      .from("businesses")
      .select("meta_ad_account_ids, meta_page_ids, meta_instagram_ids")
      .eq("id", bid)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!row) return res.status(404).json({ error: "עסק לא נמצא" });
    const list =
      type === "adaccounts"
        ? normalizeMetaAssetList(row.meta_ad_account_ids)
        : type === "pages"
          ? normalizeMetaAssetList(row.meta_page_ids)
          : normalizeMetaAssetList(row.meta_instagram_ids);
    return res.json({ assets: list });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.patch("/api/meta-selected-assets", async (req, res) => {
  const {
    business_id: businessId,
    selected_ad_account_id,
    selected_page_id,
    selected_instagram_id,
  } = req.body || {};
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר או לא תקין business_id" });
  }
  try {
    const bid = String(businessId);
    // invalidate meta cache (act may change)
    deleteCached(`meta-ctx:${bid}`);

    const patch = {
      selected_ad_account_id:
        selected_ad_account_id != null && String(selected_ad_account_id).trim()
          ? String(selected_ad_account_id).trim()
          : null,
      selected_page_id:
        selected_page_id != null && String(selected_page_id).trim()
          ? String(selected_page_id).trim()
          : null,
      selected_instagram_id:
        selected_instagram_id != null && String(selected_instagram_id).trim()
          ? String(selected_instagram_id).trim()
          : null,
    };

    const { error } = await supabaseAdmin.from("businesses").update(patch).eq("id", bid);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/alerts", async (req, res) => {
  const businessId = req.query.business_id;
  const limitRaw = parseInt(String(req.query.limit || "20"), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 20;

  if (!businessId || !isUuid(String(businessId))) {
    return res
      .status(400)
      .json({ error: "חסר או לא תקין business_id (UUID)" });
  }

  try {
    const bid = String(businessId);
    const cached = getCached(`alerts:${bid}`);
    if (cached && typeof cached === "object") return res.json(cached);
    const { data: unreadRows, error: ue } = await supabaseAdmin
      .from("alerts")
      .select("id")
      .eq("business_id", bid)
      .is("dismissed_at", null)
      .is("read_at", null);
    if (ue) return res.status(500).json({ error: ue.message });

    const unread_count = unreadRows?.length || 0;

    const { data: rows, error } = await supabaseAdmin
      .from("alerts")
      .select(
        "id,business_id,campaign_id,campaign_name,alert_type,severity,title,body,context_for_chat,created_at,read_at,dismissed_at",
      )
      .eq("business_id", bid)
      .is("dismissed_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });

    const payload = { unread_count, alerts: rows || [] };
    setCached(`alerts:${bid}`, payload, 30 * 60 * 1000);
    return res.json(payload);
  } catch (e) {
    console.error("[alerts] error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

/** cron: כל שעה — Authorization: Bearer $CRON_SECRET */
app.post("/api/check-alerts", async (req, res) => {
  if (!CRON_SECRET) {
    return res.status(503).json({
      error: "CRON_SECRET לא הוגדר בשרת",
    });
  }
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "לא מורשה" });
  }

  let businessIds = [];
  if (req.body?.business_id && isUuid(String(req.body.business_id))) {
    businessIds = [String(req.body.business_id)];
  } else {
    const { data: rows, error } = await supabaseAdmin
      .from("businesses")
      .select("id")
      .not("meta_access_token", "is", null);
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    businessIds = (rows || [])
      .map((r) => r.id)
      .filter(Boolean);
  }

  let alertsCreated = 0;
  const details = [];

  for (const bid of businessIds) {
    const { data: row, error: be } = await supabaseAdmin
      .from("businesses")
      .select("id, user_id, meta_access_token")
      .eq("id", bid)
      .maybeSingle();
    if (be || !row?.meta_access_token?.trim()) {
      details.push({ business_id: bid, alerts_created: 0, skipped: true });
      continue;
    }
    const access = await getBusinessMetaAccess(bid);
    if (!access) {
      details.push({ business_id: bid, alerts_created: 0, skipped: true });
      continue;
    }
    try {
      const n = await checkAlertsForBusiness(
        bid,
        row.user_id,
        access.accessToken,
        access.actId,
      );
      alertsCreated += n;
      details.push({ business_id: bid, alerts_created: n });
    } catch (e) {
      details.push({
        business_id: bid,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return res.json({
    ok: true,
    businesses_checked: businessIds.length,
    alerts_created: alertsCreated,
    details,
  });
});

async function runAlertsCheckForBusinesses(businessIds) {
  let alertsCreated = 0;
  const details = [];

  for (const bid of businessIds) {
    const { data: row, error: be } = await supabaseAdmin
      .from("businesses")
      .select("id, user_id, meta_access_token")
      .eq("id", bid)
      .maybeSingle();
    if (be || !row?.meta_access_token?.trim()) {
      details.push({ business_id: bid, alerts_created: 0, skipped: true });
      continue;
    }
    const access = await getBusinessMetaAccess(bid);
    if (!access) {
      details.push({ business_id: bid, alerts_created: 0, skipped: true });
      continue;
    }
    try {
      const n = await checkAlertsForBusiness(
        bid,
        row.user_id,
        access.accessToken,
        access.actId,
      );
      alertsCreated += n;
      details.push({ business_id: bid, alerts_created: n });
    } catch (e) {
      details.push({
        business_id: bid,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { businesses_checked: businessIds.length, alerts_created: alertsCreated, details };
}

/**
 * GET /api/meta-campaigns?business_id=UUID&force=1
 * Returns all campaigns with 7-day insights.
 * Cached in-memory for 5 minutes + persisted to Supabase campaign_snapshots.
 * Pass force=1 to bypass cache.
 */
/**
 * POST /api/ron-insights — Structured, actionable insights.
 * Returns JSON array of insights, each with an action the user can execute.
 * Cached 1 hour per business.
 */
app.post("/api/ron-insights", async (req, res) => {
  const businessId = req.body?.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר business_id" });
  }
  const bid = String(businessId);
  const cacheKey = `ron-insights:${bid}`;
  const forceRefresh = req.body?.force === true;

  if (!forceRefresh) {
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);
  }

  try {
    const { data: biz } = await supabaseAdmin
      .from("businesses").select("name, industry").eq("id", bid).maybeSingle();

    let metaCtx = getCached(`meta-ctx:${bid}`);
    if (!metaCtx) {
      metaCtx = await fetchMetaContextForBusiness(bid);
      setCached(`meta-ctx:${bid}`, metaCtx, 15 * 60 * 1000);
    }

    if (!metaCtx?.connected) {
      return res.json({ insights: [] });
    }

    // Get enriched campaign data with spend/clicks/leads per campaign
    let enriched = getCached(`meta-campaigns:${bid}:last_7d`);
    if (!enriched?.campaigns) {
      // Fetch it now — simulate what /api/meta-campaigns does
      try {
        const access = await getBusinessMetaAccess(bid);
        if (access) {
          const campaigns = await graphFetchEdgeList(
            buildGraphUrl(`/${access.actId}/campaigns`, access.accessToken, {
              fields: "id,name,status,daily_budget,lifetime_budget,objective",
              limit: "200",
            }),
            `${access.actId}/campaigns`,
          );
          const batchUrl = buildGraphUrl(`/${access.actId}/insights`, access.accessToken, {
            fields: "campaign_id,spend,clicks,impressions,cpc,ctr,actions",
            date_preset: "last_7d",
            level: "campaign",
            limit: "500",
          });
          const batchRes = await fetch(batchUrl);
          const batchJson = await batchRes.json().catch(() => ({}));
          const insMap = {};
          if (Array.isArray(batchJson.data)) {
            for (const row of batchJson.data) {
              if (!row.campaign_id) continue;
              if (!insMap[row.campaign_id]) insMap[row.campaign_id] = { spend: 0, clicks: 0, impressions: 0, cpc: 0, ctr: 0, leads: 0 };
              insMap[row.campaign_id].spend += parseFloat(row.spend || "0") || 0;
              insMap[row.campaign_id].clicks += parseInt(row.clicks || "0", 10) || 0;
              insMap[row.campaign_id].impressions += parseInt(row.impressions || "0", 10) || 0;
              insMap[row.campaign_id].cpc = parseFloat(row.cpc || "0") || 0;
              insMap[row.campaign_id].ctr = parseFloat(row.ctr || "0") || 0;
              if (Array.isArray(row.actions)) {
                for (const act of row.actions) {
                  if (act.action_type === "lead" || act.action_type === "onsite_conversion.lead_grouped" || act.action_type === "offsite_conversion.fb_pixel_lead") {
                    insMap[row.campaign_id].leads += parseInt(act.value || "0", 10) || 0;
                  }
                }
              }
            }
          }
          const enrichedCampaigns = campaigns.map((c) => {
            const ins = insMap[c.id] || { spend: 0, clicks: 0, impressions: 0, cpc: 0, ctr: 0, leads: 0 };
            return {
              id: c.id, name: c.name, status: c.status, objective: c.objective,
              daily_budget: c.daily_budget ? parseInt(c.daily_budget, 10) / 100 : 0,
              spend: ins.spend, clicks: ins.clicks, impressions: ins.impressions,
              cpc: ins.cpc, ctr: ins.ctr, leads: ins.leads,
              cpl: ins.leads > 0 ? ins.spend / ins.leads : 0,
            };
          });
          enriched = { campaigns: enrichedCampaigns };
        }
      } catch (e) {
        console.warn("[ron-insights] enriched fetch failed:", e instanceof Error ? e.message : e);
      }
    }
    if (enriched?.campaigns) metaCtx = { ...metaCtx, campaigns: enriched.campaigns };

    const metaBlock = buildMetaContextBlock(metaCtx);

    const systemPrompt = `${AGENT_PROMPTS.ron}

${metaBlock}

## הקשר עסק
שם: ${biz?.name || "—"} | תחום: ${biz?.industry || "לא צוין"}

## משימה
נתח את הנתונים והחזר JSON בלבד — מערך של 3-6 insights. כל insight הוא אובייקט עם:
- "icon": אימוג'י אחד שמייצג את הסוג (🔴/🟡/🟢/💡/⚡/📉/📈/🎯/💰/⏸️)
- "title": כותרת קצרה (עד 8 מילים) בעברית
- "body": הסבר של 1-2 משפטים בעברית
- "severity": "critical" | "warning" | "good" | "tip"
- "action_type": סוג הפעולה — "pause_campaign" | "increase_budget" | "decrease_budget" | "refresh_creative" | "expand_audience" | "chat_with_ron" | null
- "action_label": טקסט הכפתור בעברית (לדוגמה: "עצור קמפיין", "הגדל תקציב", "דבר עם רון") או null אם אין פעולה
- "campaign_id": מזהה הקמפיין הרלוונטי (אם יש) או null
- "campaign_name": שם הקמפיין (אם רלוונטי) או null
- "suggested_value": ערך מוצע (למשל תקציב חדש במספר) או null

דוגמה:
[
  {"icon":"🔴","title":"עלות לליד גבוהה מדי","body":"קמפיין X מייצר לידים ב-₪180 — פי 3 מהבנצ'מרק. מומלץ לעצור ולבדוק קריאייטיב.","severity":"critical","action_type":"pause_campaign","action_label":"עצור קמפיין","campaign_id":"123","campaign_name":"X","suggested_value":null},
  {"icon":"🟢","title":"קמפיין Y מוביל בביצועים","body":"CTR של 2.3% ועלות לליד ₪28 — מצוין. שווה להגדיל תקציב ב-20%.","severity":"good","action_type":"increase_budget","action_label":"הגדל תקציב 20%","campaign_id":"456","campaign_name":"Y","suggested_value":null}
]

החזר JSON בלבד, בלי markdown, בלי הסברים.`;

    const r = await callAnthropicApi(systemPrompt, [
      { role: "user", content: "תן insights על הקמפיינים שלי" },
    ]);

    if (!r.ok) {
      return res.status(502).json({ error: "שגיאה", details: r.errorText });
    }

    // Parse JSON from response
    let insights = [];
    try {
      const raw = String(r.text || "").trim();
      const jsonStart = raw.indexOf("[");
      const jsonEnd = raw.lastIndexOf("]");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        insights = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
      }
    } catch {
      // If parsing fails, return empty
      console.warn("[ron-insights] failed to parse JSON from Ron's response");
    }

    const payload = { insights, fetched_at: new Date().toISOString() };
    setCached(cacheKey, payload, 60 * 60 * 1000);
    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * POST /api/ron-analysis — Structured campaign health analysis from Ron.
 * Returns { summary, score, recommendations[], fetched_at }.
 * Cached 1 hour per business + saved to client_memory.
 */
app.post("/api/ron-analysis", async (req, res) => {
  const businessId = req.body?.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר business_id" });
  }
  const bid = String(businessId);
  const cacheKey = `ron-analysis:${bid}`;
  const forceRefresh = req.body?.force === true;

  if (!forceRefresh) {
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);
  }

  try {
    const { data: biz } = await supabaseAdmin
      .from("businesses").select("name, industry").eq("id", bid).maybeSingle();

    let metaCtx = getCached(`meta-ctx:${bid}`);
    if (!metaCtx) {
      metaCtx = await fetchMetaContextForBusiness(bid);
      setCached(`meta-ctx:${bid}`, metaCtx, 15 * 60 * 1000);
    }
    const enrichedKey = `meta-campaigns:${bid}:last_7d`;
    const enriched = getCached(enrichedKey);
    if (enriched?.campaigns) {
      metaCtx = { ...metaCtx, campaigns: enriched.campaigns };
    }

    if (!metaCtx?.connected) {
      return res.json({ summary: null, score: 0, recommendations: [], fetched_at: null });
    }

    const metaBlock = buildMetaContextBlock(metaCtx);
    const systemPrompt = `${AGENT_PROMPTS.ron}

${metaBlock}

## הקשר עסק
שם: ${biz?.name || "—"} | תחום: ${biz?.industry || "לא צוין"}

## משימה
נתח את כל נתוני הקמפיינים והחזר JSON בלבד (בלי markdown, בלי הסברים, בלי טקסט מסביב) בדיוק במבנה הזה:
{
  "summary": "משפט אחד בעברית על המצב הכללי",
  "score": <מספר 0-100 שמייצג את בריאות הקמפיינים הכוללת>,
  "recommendations": [
    {
      "id": "rec_1",
      "title": "כותרת קצרה בעברית",
      "description": "הסבר קצר מה הבעיה ולמה — עד 2 משפטים",
      "severity": "high" | "medium" | "low",
      "impact": "גבוהה" | "בינונית" | "נמוכה",
      "category": "creative" | "budget" | "audience" | "campaign" | "content",
      "action_prompt": "הפרומפט המדויק לשלוח לצ'אט כדי לבצע",
      "action_label": "טקסט הכפתור בעברית",
      "auto_executable": true/false,
      "campaign_id": "ID או null",
      "campaign_name": "שם או null"
    }
  ]
}

חובה 3-6 המלצות. score מבוסס על: CTR, CPC, CPL, תקציב מנוצל, מגוון קריאייטיב, וביצועים לעומת בנצ'מרק.
החזר JSON בלבד.`;

    const r = await callAnthropicApi(systemPrompt, [
      { role: "user", content: "נתח את כל הקמפיינים ותן ציון בריאות + המלצות מובנות" },
    ]);

    if (!r.ok) {
      return res.status(502).json({ error: "שגיאה בניתוח", details: r.errorText });
    }

    // Parse structured JSON
    let result = { summary: null, score: 0, recommendations: [] };
    try {
      const raw = String(r.text || "").trim();
      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
        if (parsed.summary) result.summary = String(parsed.summary);
        if (typeof parsed.score === "number") result.score = Math.max(0, Math.min(100, Math.round(parsed.score)));
        if (Array.isArray(parsed.recommendations)) {
          result.recommendations = parsed.recommendations.map((r, i) => ({
            id: r.id || `rec_${i + 1}`,
            title: String(r.title || ""),
            description: String(r.description || ""),
            severity: ["high", "medium", "low"].includes(r.severity) ? r.severity : "medium",
            impact: r.impact || "בינונית",
            category: ["creative", "budget", "audience", "campaign", "content"].includes(r.category) ? r.category : "campaign",
            action_prompt: r.action_prompt || null,
            action_label: r.action_label || null,
            auto_executable: Boolean(r.auto_executable),
            campaign_id: r.campaign_id || null,
            campaign_name: r.campaign_name || null,
          }));
        }
      }
    } catch {
      console.warn("[ron-analysis] failed to parse structured JSON");
    }

    const payload = { ...result, fetched_at: new Date().toISOString() };
    setCached(cacheKey, payload, 60 * 60 * 1000);

    // Save to client_memory
    await supabaseAdmin.from("client_memory").upsert(
      {
        business_id: bid,
        category: "insights",
        key: "ron_analysis",
        value: JSON.stringify(payload),
        source: "ron_agent",
        confidence: 90,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,category,key" },
    );

    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/meta-campaigns", async (req, res) => {
  const businessId = req.query.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר business_id" });
  }
  const bid = String(businessId);
  const forceRefresh = req.query.force === "1";

  // Date range: preset OR since/until (YYYY-MM-DD)
  const preset = String(req.query.preset || "").trim(); // today, yesterday, last_7d, last_30d, this_month
  const sinceDate = String(req.query.since || "").trim();
  const untilDate = String(req.query.until || "").trim();
  const hasCustomRange = /^\d{4}-\d{2}-\d{2}$/.test(sinceDate) && /^\d{4}-\d{2}-\d{2}$/.test(untilDate);
  const validPresets = ["today", "yesterday", "last_7d", "last_14d", "last_30d", "this_month", "last_month"];
  const datePreset = validPresets.includes(preset) ? preset : (hasCustomRange ? null : "last_7d");
  const rangeLabel = datePreset || `${sinceDate}_${untilDate}`;

  try {
    // 1) Check in-memory cache (5 min TTL, keyed by range)
    const cacheKey = `meta-campaigns:${bid}:${rangeLabel}`;
    if (!forceRefresh) {
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);
    }

    const access = await getBusinessMetaAccess(bid);
    if (!access) {
      return res.json({ connected: false, campaigns: [] });
    }
    const { accessToken, actId } = access;

    // 2) Fetch all campaigns
    const campaigns = await graphFetchEdgeList(
      buildGraphUrl(`/${actId}/campaigns`, accessToken, {
        fields: "id,name,status,daily_budget,lifetime_budget,objective,start_time,stop_time,created_time",
        limit: "200",
      }),
      `${actId}/campaigns`,
    );

    // 3) Compute previous period date range for comparison
    //    Meta doesn't support "previous_7d" etc. — we compute manually.
    function computePrevRange() {
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const dayMs = 24 * 60 * 60 * 1000;

      function fmt(d) { return d.toISOString().slice(0, 10); }
      function makeRange(since, until) {
        return { time_range: JSON.stringify({ since, until }) };
      }

      if (hasCustomRange) {
        const s = new Date(sinceDate + "T00:00:00");
        const u = new Date(untilDate + "T00:00:00");
        const days = Math.round((u - s) / dayMs) + 1;
        const prevEnd = new Date(s.getTime() - dayMs);
        const prevStart = new Date(prevEnd.getTime() - (days - 1) * dayMs);
        return makeRange(fmt(prevStart), fmt(prevEnd));
      }

      if (datePreset === "today") {
        // Compare today vs yesterday
        const y = new Date(now.getTime() - dayMs);
        return makeRange(fmt(y), fmt(y));
      }
      if (datePreset === "yesterday") {
        // Compare yesterday vs day before
        const d = new Date(now.getTime() - 2 * dayMs);
        return makeRange(fmt(d), fmt(d));
      }
      if (datePreset === "last_7d") {
        // last 7 days vs 7 days before that
        const end = new Date(now.getTime() - 8 * dayMs); // day before the 7d window
        const start = new Date(end.getTime() - 6 * dayMs);
        return makeRange(fmt(start), fmt(end));
      }
      if (datePreset === "last_14d") {
        const end = new Date(now.getTime() - 15 * dayMs);
        const start = new Date(end.getTime() - 13 * dayMs);
        return makeRange(fmt(start), fmt(end));
      }
      if (datePreset === "last_30d") {
        const end = new Date(now.getTime() - 31 * dayMs);
        const start = new Date(end.getTime() - 29 * dayMs);
        return makeRange(fmt(start), fmt(end));
      }
      if (datePreset === "this_month") {
        // Compare this month vs last month
        const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastMonthEnd = new Date(firstOfMonth.getTime() - dayMs);
        const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
        return makeRange(fmt(lastMonthStart), fmt(lastMonthEnd));
      }
      return null;
    }

    // 4) Fetch current + previous insights IN PARALLEL
    function parseInsightsRows(rows) {
      const map = {};
      for (const row of rows) {
        const cid = row.campaign_id;
        if (!cid) continue;
        if (!map[cid]) map[cid] = { spend: 0, clicks: 0, impressions: 0, cpc: 0, ctr: 0, leads: 0 };
        map[cid].spend += parseFloat(row.spend || "0") || 0;
        map[cid].clicks += parseInt(row.clicks || "0", 10) || 0;
        map[cid].impressions += parseInt(row.impressions || "0", 10) || 0;
        map[cid].cpc = parseFloat(row.cpc || "0") || 0;
        map[cid].ctr = parseFloat(row.ctr || "0") || 0;
        if (Array.isArray(row.actions)) {
          for (const act of row.actions) {
            if (act.action_type === "lead" || act.action_type === "onsite_conversion.lead_grouped" || act.action_type === "offsite_conversion.fb_pixel_lead") {
              map[cid].leads += parseInt(act.value || "0", 10) || 0;
            }
          }
        }
      }
      return map;
    }

    const baseFields = "campaign_id,campaign_name,spend,clicks,impressions,cpc,ctr,actions";
    const currentParams = { fields: baseFields, level: "campaign", limit: "500" };
    if (hasCustomRange) {
      currentParams.time_range = JSON.stringify({ since: sinceDate, until: untilDate });
    } else {
      currentParams.date_preset = datePreset;
    }

    const prevRangeParams = computePrevRange();

    const insightsMap = {};
    const prevInsightsMap = {};
    try {
      const currentPromise = fetch(buildGraphUrl(`/${actId}/insights`, accessToken, currentParams))
        .then(r => r.json().catch(() => ({})));

      const prevPromise = prevRangeParams
        ? fetch(buildGraphUrl(`/${actId}/insights`, accessToken, { fields: baseFields, level: "campaign", limit: "500", ...prevRangeParams }))
            .then(r => r.json().catch(() => ({})))
        : Promise.resolve({ data: [] });

      const [currentJson, prevJson] = await Promise.all([currentPromise, prevPromise]);

      if (Array.isArray(currentJson.data)) Object.assign(insightsMap, parseInsightsRows(currentJson.data));
      if (Array.isArray(prevJson.data)) Object.assign(prevInsightsMap, parseInsightsRows(prevJson.data));
    } catch (e) {
      console.warn("[meta-campaigns] batch insights failed:", e instanceof Error ? e.message : e);
    }

    // 5) Build result with deltas
    function pctDelta(curr, prev) {
      if (!Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return null;
      return Math.round(((curr - prev) / prev) * 100);
    }

    const result = campaigns.map((c) => {
      const ins = insightsMap[c.id] || { spend: 0, clicks: 0, impressions: 0, cpc: 0, ctr: 0, leads: 0 };
      const prev = prevInsightsMap[c.id] || { spend: 0, clicks: 0, impressions: 0, cpc: 0, ctr: 0, leads: 0 };
      const dailyBudget = c.daily_budget ? parseInt(c.daily_budget, 10) / 100 : 0;
      const lifetimeBudget = c.lifetime_budget ? parseInt(c.lifetime_budget, 10) / 100 : 0;
      const cpl = ins.leads > 0 ? ins.spend / ins.leads : 0;
      const prevCpl = prev.leads > 0 ? prev.spend / prev.leads : 0;
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        daily_budget: dailyBudget,
        lifetime_budget: lifetimeBudget,
        start_time: c.start_time || null,
        stop_time: c.stop_time || null,
        created_time: c.created_time || null,
        spend: ins.spend,
        clicks: ins.clicks,
        impressions: ins.impressions,
        cpc: ins.cpc,
        ctr: ins.ctr,
        leads: ins.leads,
        cpl: cpl,
        // Deltas vs previous period (null = no data)
        delta_spend: pctDelta(ins.spend, prev.spend),
        delta_clicks: pctDelta(ins.clicks, prev.clicks),
        delta_impressions: pctDelta(ins.impressions, prev.impressions),
        delta_leads: pctDelta(ins.leads, prev.leads),
        delta_cpl: pctDelta(cpl, prevCpl),
      };
    });

    const payload = { connected: true, campaigns: result, fetched_at: new Date().toISOString(), range: rangeLabel };

    // 5) Cache in memory (15 min to avoid rate limits)
    setCached(cacheKey, payload, 15 * 60 * 1000);

    // 6) Persist snapshot to Supabase (fire-and-forget for speed)
    void (async () => {
      try {
        for (const c of result) {
          await supabaseAdmin.from("campaign_snapshots").upsert(
            {
              campaign_id: c.id,
              business_id: bid,
              name: c.name,
              status: c.status,
              objective: c.objective,
              daily_budget: c.daily_budget,
              lifetime_budget: c.lifetime_budget,
              spend_7d: c.spend,
              clicks_7d: c.clicks,
              impressions_7d: c.impressions,
              cpc_7d: c.cpc,
              ctr_7d: c.ctr,
              snapshot_date: new Date().toISOString().slice(0, 10),
            },
            { onConflict: "campaign_id,snapshot_date" },
          );
        }
      } catch (e) {
        console.warn("[campaign_snapshots] persist failed:", e instanceof Error ? e.message : e);
      }
    })();

    return res.json(payload);
  } catch (e) {
    return res.status(500).json({
      error: "שגיאה בשליפת קמפיינים",
      details: e instanceof Error ? e.message : String(e),
    });
  }
});

/**
 * GET /api/meta-campaign/:campaignId/adsets?business_id=UUID
 * Returns ad sets (audiences) for a campaign. Cached 10 min.
 */
app.get("/api/meta-campaign/:campaignId/adsets", async (req, res) => {
  const businessId = req.query.business_id;
  if (!businessId || !isUuid(String(businessId))) return res.status(400).json({ error: "חסר business_id" });
  const cacheKey = `adsets:${req.params.campaignId}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);
  console.log("[adsets] cache miss, fetching from Meta...");

  try {
    const loaded = await loadCampaignForBusiness(String(businessId), req.params.campaignId);
    if (loaded.error) {
      console.log("[adsets] loadCampaign error:", loaded.error);
      return res.status(loaded.status || 400).json({ error: loaded.error });
    }
    const { accessToken } = loaded.access;
    console.log("[adsets] fetching adsets for campaign", loaded.graphId);
    // Direct fetch to detect errors properly
    const adsetsUrl = buildGraphUrl(`/${loaded.graphId}/adsets`, accessToken, {
      fields: "id,name,status,targeting,daily_budget,lifetime_budget,optimization_goal,bid_strategy",
    });
    const adsetsRes = await fetch(adsetsUrl);
    const adsetsJson = await adsetsRes.json().catch(() => ({}));
    if (!adsetsRes.ok) {
      const errMsg = adsetsJson.error?.error_user_msg || adsetsJson.error?.message || "שגיאה בשליפת קהלים";
      const isRateLimit = adsetsJson.error?.code === 17 || adsetsJson.error?.code === 32;
      console.log("[adsets] API error:", errMsg, "rate_limit:", isRateLimit);
      return res.status(isRateLimit ? 429 : 502).json({
        error: isRateLimit ? "חריגה ממגבלת קריאות Meta — נסה שוב בעוד דקה" : errMsg,
        rate_limited: isRateLimit,
      });
    }
    const adsets = Array.isArray(adsetsJson.data) ? adsetsJson.data : [];
    console.log("[adsets] found", adsets.length, "adsets");
    const result = adsets.map((as) => {
      const t = as.targeting || {};
      // Extract geo location names
      const geoLocs = t.geo_locations || {};
      const countries = (geoLocs.countries || []).map((c) => c);
      const cities = (geoLocs.cities || []).map((c) => c.name || c.key || "").filter(Boolean);
      const regions = (geoLocs.regions || []).map((r) => r.name || r.key || "").filter(Boolean);
      // Extract gender labels
      const genderMap = { 1: "גברים", 2: "נשים" };
      const genderLabels = (t.genders || []).map((g) => genderMap[g] || `${g}`);
      return {
        id: as.id,
        name: as.name,
        status: as.status,
        daily_budget: as.daily_budget ? parseInt(as.daily_budget, 10) / 100 : 0,
        optimization_goal: as.optimization_goal || null,
        bid_strategy: as.bid_strategy || null,
        targeting: {
          age_min: t.age_min || null,
          age_max: t.age_max || null,
          genders: genderLabels,
          countries,
          cities,
          regions,
          interests: (t.flexible_spec || []).flatMap((fs) => (fs.interests || []).map((i) => i.name)).filter(Boolean),
          custom_audiences: (t.custom_audiences || []).map((ca) => ca.name || ca.id).filter(Boolean),
          excluded_custom_audiences: (t.excluded_custom_audiences || []).map((ca) => ca.name || ca.id).filter(Boolean),
          publisher_platforms: t.publisher_platforms || [],
        },
      };
    });
    const payload = { adsets: result };
    setCached(cacheKey, payload, 10 * 60 * 1000);
    return res.json(payload);
  } catch (e) {
    console.error("[adsets] error:", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * GET /api/meta-campaign/:campaignId/ads?business_id=UUID
 * Returns ads with creative images. Cached 10 min.
 * Optimized: fetches images in parallel, skips slow preview iframe calls.
 */
app.get("/api/meta-campaign/:campaignId/ads", async (req, res) => {
  const businessId = req.query.business_id;
  if (!businessId || !isUuid(String(businessId))) return res.status(400).json({ error: "חסר business_id" });
  const cacheKey = `ads:${req.params.campaignId}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const loaded = await loadCampaignForBusiness(String(businessId), req.params.campaignId);
    if (loaded.error) return res.status(loaded.status || 400).json({ error: loaded.error });
    const { accessToken } = loaded.access;

    console.log("[ads] fetching ads for campaign", loaded.graphId);
    const adsUrl = buildGraphUrl(`/${loaded.graphId}/ads`, accessToken, {
      fields: "id,name,status,creative{id,title,body,image_url,thumbnail_url,effective_object_story_id,call_to_action_type,link_url,object_story_spec}",
    });
    const adsRes = await fetch(adsUrl);
    const adsJson = await adsRes.json().catch(() => ({}));
    if (!adsRes.ok) {
      const errMsg = adsJson.error?.error_user_msg || adsJson.error?.message || "שגיאה בשליפת מודעות";
      const isRateLimit = adsJson.error?.code === 17 || adsJson.error?.code === 32;
      return res.status(isRateLimit ? 429 : 502).json({
        error: isRateLimit ? "חריגה ממגבלת קריאות Meta — נסה שוב בעוד דקה" : errMsg,
        rate_limited: isRateLimit,
      });
    }
    const ads = Array.isArray(adsJson.data) ? adsJson.data : [];
    console.log("[ads] found", ads.length, "ads");

    // Fetch story images IN PARALLEL for ads that need it (much faster than sequential)
    const result = await Promise.all(ads.map(async (ad) => {
      const creative = ad.creative || {};
      let imageUrl = creative.image_url || creative.thumbnail_url || null;
      let storyText = null;

      // If no image, try the story post (parallel — no blocking)
      if (!imageUrl && creative.effective_object_story_id) {
        try {
          const storyRes = await fetch(
            buildGraphUrl(`/${creative.effective_object_story_id}`, accessToken, { fields: "full_picture,message" }),
          );
          const storyJson = await storyRes.json().catch(() => ({}));
          if (storyRes.ok) {
            if (storyJson.full_picture) imageUrl = storyJson.full_picture;
            if (storyJson.message) storyText = storyJson.message;
          }
        } catch { /* skip */ }
      }

      // Extract CTA
      const ctaType = creative.call_to_action_type ||
        creative.object_story_spec?.link_data?.call_to_action?.type ||
        creative.object_story_spec?.video_data?.call_to_action?.type || null;
      const linkUrl = creative.link_url ||
        creative.object_story_spec?.link_data?.link ||
        creative.object_story_spec?.video_data?.call_to_action?.value?.link || null;
      // Get body from story message if not from creative
      const bodyText = creative.body || storyText ||
        creative.object_story_spec?.link_data?.message ||
        creative.object_story_spec?.video_data?.message || null;
      // Get headline from link_data if not from title
      const headline = creative.title ||
        creative.object_story_spec?.link_data?.name || null;
      const description = creative.object_story_spec?.link_data?.description || null;

      return {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        headline: headline,
        body: bodyText,
        description: description,
        image_url: imageUrl,
        cta_type: ctaType,
        link_url: linkUrl,
      };
    }));

    const payload = { ads: result };
    setCached(cacheKey, payload, 10 * 60 * 1000);
    return res.json(payload);
  } catch (e) {
    console.error("[ads] error:", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get(
  "/api/meta-campaign/:campaignId",
  async (req, res) => {
  const businessId = req.query.business_id;
  const rangeRaw = parseInt(String(req.query.range || "7"), 10);
  const rangeDays = [7, 14, 30].includes(rangeRaw) ? rangeRaw : 7;

  if (!businessId || !isUuid(String(businessId))) {
    return res
      .status(400)
      .json({ error: "חסר או לא תקין business_id (UUID)" });
  }

  try {
    const loaded = await loadCampaignForBusiness(
      String(businessId),
      req.params.campaignId,
    );
    if (loaded.error) {
      return res.status(loaded.status || 400).json({ error: loaded.error });
    }

    const bundle = await fetchMetaCampaignInsightsBundle(
      loaded.access.accessToken,
      loaded.graphId,
      rangeDays,
    );

    return res.json({
      campaign: {
        id: loaded.campaign.id,
        name: loaded.campaign.name,
        status: loaded.campaign.status,
        daily_budget: loaded.campaign.daily_budget,
        lifetime_budget: loaded.campaign.lifetime_budget,
        objective: loaded.campaign.objective,
        start_time: loaded.campaign.start_time,
        stop_time: loaded.campaign.stop_time,
        created_time: loaded.campaign.created_time,
      },
      range_days: rangeDays,
      ...bundle,
    });
  } catch (e) {
    return res.status(500).json({
      error: "שגיאה בשליפת פרטי קמפיין",
      details: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post(
  "/api/meta-campaign/:campaignId/pause",
  async (req, res) => {
  const businessId = req.body?.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר או לא תקין business_id" });
  }
  try {
    const loaded = await loadCampaignForBusiness(
      String(businessId),
      req.params.campaignId,
    );
    if (loaded.error) {
      return res.status(loaded.status || 400).json({ error: loaded.error });
    }
    const { ok, json } = await metaGraphPost(
      loaded.graphId,
      loaded.access.accessToken,
      { status: "PAUSED" },
    );
    if (!ok) {
      return res.status(400).json({
        error: json.error?.message || "עצירה נכשלה",
        details: json,
      });
    }
    return res.json({ ok: true, id: json.id });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post(
  "/api/meta-campaign/:campaignId/activate",
  async (req, res) => {
  const businessId = req.body?.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר או לא תקין business_id" });
  }
  try {
    const loaded = await loadCampaignForBusiness(
      String(businessId),
      req.params.campaignId,
    );
    if (loaded.error) {
      return res.status(loaded.status || 400).json({ error: loaded.error });
    }
    const { ok, json } = await metaGraphPost(
      loaded.graphId,
      loaded.access.accessToken,
      { status: "ACTIVE" },
    );
    if (!ok) {
      return res.status(400).json({
        error: json.error?.message || "הפעלה נכשלה",
        details: json,
      });
    }
    return res.json({ ok: true, id: json.id });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post(
  "/api/meta-campaign/:campaignId/budget",
  async (req, res) => {
  const businessId = req.body?.business_id;
  const dailyIls = req.body?.daily_budget_ils;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר או לא תקין business_id" });
  }
  const n = Number(dailyIls);
  if (!Number.isFinite(n) || n <= 0) {
    return res.status(400).json({ error: "תקציב יומי לא תקין (שקלים)" });
  }
  const dailyBudgetMinor = Math.round(n * 100);
  try {
    const loaded = await loadCampaignForBusiness(
      String(businessId),
      req.params.campaignId,
    );
    if (loaded.error) {
      return res.status(loaded.status || 400).json({ error: loaded.error });
    }
    const { ok, json } = await metaGraphPost(
      loaded.graphId,
      loaded.access.accessToken,
      { daily_budget: String(dailyBudgetMinor) },
    );
    if (!ok) {
      return res.status(400).json({
        error: json.error?.message || "עדכון תקציב נכשל",
        details: json,
      });
    }
    return res.json({ ok: true, id: json.id, daily_budget: dailyBudgetMinor });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post(
  "/api/meta-campaign/:campaignId/duplicate",
  async (req, res) => {
  const businessId = req.body?.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר או לא תקין business_id" });
  }
  try {
    const loaded = await loadCampaignForBusiness(
      String(businessId),
      req.params.campaignId,
    );
    if (loaded.error) {
      return res.status(loaded.status || 400).json({ error: loaded.error });
    }
    const u = new URL(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${loaded.graphId}/copies`,
    );
    u.searchParams.set("access_token", loaded.access.accessToken);
    const r = await fetch(u.toString(), { method: "POST" });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(400).json({
        error: json.error?.message || "שכפול נכשל",
        details: json,
      });
    }
    return res.json({ ok: true, ...json });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

/**
 * POST /api/meta-execute-action — Execute a pending action from the chat agent.
 * Dispatcher for all Meta mutations: create/update/pause/activate campaigns and adsets.
 */
app.post("/api/meta-execute-action", requireBearerAuthorization, async (req, res) => {
  const { business_id: businessId, action } = req.body || {};
  if (!businessId || !isUuid(String(businessId))) return res.status(400).json({ error: "חסר business_id" });
  if (!action || !action.type) return res.status(400).json({ error: "חסר action" });

  try {
    const access = await getBusinessMetaAccess(String(businessId));
    if (!access) return res.status(400).json({ error: "אין חיבור Meta" });
    const { accessToken, actId } = access;
    const p = action.params || {};

    let result;
    switch (action.type) {
      case "pause_campaign": {
        if (!p.campaign_id) return res.status(400).json({ error: "חסר campaign_id" });
        const r = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${p.campaign_id}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ access_token: accessToken, status: "PAUSED" }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(502).json({ error: j.error?.message || "עצירה נכשלה" });
        result = { ok: true, message: `קמפיין "${p.campaign_name || p.campaign_id}" הושהה` };
        break;
      }
      case "activate_campaign": {
        if (!p.campaign_id) return res.status(400).json({ error: "חסר campaign_id" });
        const r = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${p.campaign_id}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ access_token: accessToken, status: "ACTIVE" }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(502).json({ error: j.error?.message || "הפעלה נכשלה" });
        result = { ok: true, message: `קמפיין "${p.campaign_name || p.campaign_id}" הופעל` };
        break;
      }
      case "update_budget": {
        if (!p.campaign_id || !p.daily_budget_ils) return res.status(400).json({ error: "חסר campaign_id או daily_budget_ils" });
        const budgetAgorot = Math.round(Number(p.daily_budget_ils) * 100);
        const r = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${p.campaign_id}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ access_token: accessToken, daily_budget: String(budgetAgorot) }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(502).json({ error: j.error?.message || "עדכון תקציב נכשל" });
        result = { ok: true, message: `תקציב עודכן ל-₪${p.daily_budget_ils}/יום` };
        break;
      }
      case "create_campaign": {
        const params = new URLSearchParams({
          access_token: accessToken,
          name: String(p.name || "קמפיין חדש"),
          objective: String(p.objective || "OUTCOME_LEADS"),
          status: "PAUSED",
          special_ad_categories: JSON.stringify(p.special_ad_categories || []),
        });
        if (p.daily_budget_ils) params.set("daily_budget", String(Math.round(Number(p.daily_budget_ils) * 100)));
        const r = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${actId}/campaigns`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(502).json({ error: j.error?.message || "יצירת קמפיין נכשלה" });
        result = { ok: true, message: `קמפיין "${p.name}" נוצר בהצלחה (מושהה)`, campaign_id: j.id };
        break;
      }
      case "create_adset": {
        if (!p.campaign_id) return res.status(400).json({ error: "חסר campaign_id" });
        const params = new URLSearchParams({
          access_token: accessToken,
          campaign_id: String(p.campaign_id),
          name: String(p.name || "קהל חדש"),
          billing_event: "IMPRESSIONS",
          optimization_goal: String(p.optimization_goal || "LEAD_GENERATION"),
          status: "PAUSED",
          targeting: JSON.stringify(p.targeting || { geo_locations: { countries: ["IL"] } }),
        });
        if (p.daily_budget_ils) params.set("daily_budget", String(Math.round(Number(p.daily_budget_ils) * 100)));
        if (p.start_time) params.set("start_time", p.start_time);
        if (p.end_time) params.set("end_time", p.end_time);
        const r = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${actId}/adsets`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(502).json({ error: j.error?.message || "יצירת קהל נכשלה" });
        result = { ok: true, message: `קהל "${p.name}" נוצר בהצלחה (מושהה)`, adset_id: j.id };
        break;
      }
      case "duplicate_campaign": {
        if (!p.campaign_id) return res.status(400).json({ error: "חסר campaign_id" });
        const r = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${p.campaign_id}/copies`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ access_token: accessToken, status_option: "PAUSED" }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(502).json({ error: j.error?.message || "שכפול נכשל" });
        result = { ok: true, message: `קמפיין "${p.campaign_name}" שוכפל`, new_campaign_id: j.copied_campaign_id };
        break;
      }
      default:
        return res.status(400).json({ error: `סוג פעולה לא מוכר: ${action.type}` });
    }

    // Invalidate caches
    deleteCachedByPrefix(`meta-campaigns:${businessId}`);
    deleteCachedByPrefix(`meta-ctx:${businessId}`);
    deleteCachedByPrefix(`ron-insights:${businessId}`);

    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * GET /api/meta-targeting/interests?business_id=UUID&q=fitness
 * Search for interest targeting options.
 */
app.get("/api/meta-targeting/interests", async (req, res) => {
  const businessId = req.query.business_id;
  const q = String(req.query.q || "").trim();
  if (!businessId || !isUuid(String(businessId))) return res.status(400).json({ error: "חסר business_id" });
  if (!q) return res.json({ data: [] });
  try {
    const access = await getBusinessMetaAccess(String(businessId));
    if (!access) return res.status(400).json({ error: "אין חיבור Meta" });
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/search?type=adinterest&q=${encodeURIComponent(q)}&access_token=${access.accessToken}&limit=25`;
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: j.error?.message || "חיפוש נכשל" });
    return res.json({ data: Array.isArray(j.data) ? j.data : [] });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/auth/meta", requireBearerAuthorization, async (req, res) => {
  const businessId = req.query.business_id;
  if (!businessId || !isUuid(businessId)) {
    return res.status(400).json({ error: "חסר business_id" });
  }

  const params = new URLSearchParams();
  params.set("client_id", META_APP_ID);
  params.set("redirect_uri", META_REDIRECT_URI);
  params.set("state", String(businessId));
  params.set("response_type", "code");

  // Business-type apps MUST use config_id — Facebook forces the
  // /dialog/oauth/business/ flow regardless. The redirect_uri must
  // also be registered in the Login Configuration in the Meta dashboard.
  if (META_CONFIG_ID) {
    params.set("config_id", META_CONFIG_ID);
  } else {
    params.set("scope", META_OAUTH_SCOPES);
  }

  const url = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
  console.log("[GET /auth/meta] OAuth URL:", url);
  return res.json({ url });
});

app.get("/auth/meta/callback", async (req, res) => {
  console.log("=== META CALLBACK ARRIVED ===");
  console.log("  full URL:", req.originalUrl);
  console.log("  query:", JSON.stringify(req.query));

  const { code, state, error, error_description: errDesc } = req.query;

  const cbHtml = (title, body, script) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:2rem;background:#0B0F17;color:#F3F6FF;">
<h1 style="font-size:1.25rem">${title}</h1>
<p style="opacity:.85">${body}</p>
${script || ""}
</body></html>`);
  };

  if (error) {
    return cbHtml("שגיאת Meta", String(errDesc || error), "<p>סגרו את החלון ונסו שוב.</p>");
  }

  if (!code || !state || !isUuid(state)) {
    return cbHtml("בקשה לא תקינה", "חסר code או state תקין.", "");
  }

  try {
    // cache invalidation (meta context depends on token)
    deleteCached(`meta-ctx:${String(state)}`);
    const tokenUrl = new URL(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`,
    );
    tokenUrl.searchParams.set("client_id", META_APP_ID);
    tokenUrl.searchParams.set("redirect_uri", META_REDIRECT_URI);
    tokenUrl.searchParams.set("client_secret", META_APP_SECRET);
    tokenUrl.searchParams.set("code", String(code));

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenJson = await tokenRes.json().catch(() => ({}));

    if (!tokenRes.ok || !tokenJson.access_token) {
      console.log("[auth/meta/callback] token exchange failed:", JSON.stringify(tokenJson).slice(0, 500));
      return cbHtml("החלפת קוד נכשלה", JSON.stringify(tokenJson).slice(0, 500), "");
    }

    let accessToken = tokenJson.access_token;
    let tokenExpiresAt = null;

    // Exchange for long-lived token (60 days)
    try {
      const llUrl = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`);
      llUrl.searchParams.set("grant_type", "fb_exchange_token");
      llUrl.searchParams.set("client_id", META_APP_ID);
      llUrl.searchParams.set("client_secret", META_APP_SECRET);
      llUrl.searchParams.set("fb_exchange_token", accessToken);
      const llRes = await fetch(llUrl.toString());
      const llJson = await llRes.json().catch(() => ({}));
      if (llRes.ok && llJson.access_token) {
        accessToken = llJson.access_token;
        const expiresIn = parseInt(llJson.expires_in, 10);
        if (Number.isFinite(expiresIn) && expiresIn > 0) {
          tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
        }
        console.log("[auth/meta/callback] exchanged for long-lived token, expires_in:", expiresIn);
      } else {
        console.log("[auth/meta/callback] long-lived token exchange failed, using short-lived:", JSON.stringify(llJson).slice(0, 300));
      }
    } catch (e) {
      console.log("[auth/meta/callback] long-lived token exchange error:", e instanceof Error ? e.message : String(e));
    }

    console.log("=== META ASSETS DEBUG ===");
    console.log(
      "access_token (first 20):",
      accessToken != null ? String(accessToken).substring(0, 20) : accessToken,
    );

    const meRes = await fetch(
      buildGraphUrl("/me", accessToken, { fields: "id,name" }),
    );
    const meData = await meRes.json().catch(() => ({}));
    console.log("=== ME DATA ===", JSON.stringify(meData));
    const metaUserId =
      meData && typeof meData.id === "string" ? meData.id : null;

    const adAccountsRaw = await graphFetchEdgeList(
      buildGraphUrl("/me/adaccounts", accessToken, {
        fields: "id,name,account_status",
      }),
      "me/adaccounts",
    );
    console.log("=== AD ACCOUNTS ===", JSON.stringify(adAccountsRaw));

    const pagesRaw = await graphFetchEdgeList(
      buildGraphUrl("/me/accounts", accessToken, {
        fields: "id,name,instagram_business_account",
      }),
      "me/accounts",
    );
    console.log("=== PAGES ===", JSON.stringify(pagesRaw));

    const instagramData = await graphFetchEdgeList(
      buildGraphUrl("/me/instagram_accounts", accessToken, {
        fields: "id,username",
      }),
      "me/instagram_accounts",
    );
    console.log("instagram raw:", JSON.stringify(instagramData, null, 2));

    // Store as objects with {id, name} so the assets endpoint can show names
    const seenAdAccounts = new Set();
    const meta_ad_account_ids = adAccountsRaw
      .filter((a) => a.id && !seenAdAccounts.has(a.id) && seenAdAccounts.add(a.id))
      .map((a) => ({ id: a.id, name: a.name || a.id }));

    const seenPages = new Set();
    const meta_page_ids = pagesRaw
      .filter((p) => p.id && !seenPages.has(p.id) && seenPages.add(p.id))
      .map((p) => ({ id: p.id, name: p.name || p.id }));

    const instagramMap = new Map();
    for (const ig of instagramData) {
      if (ig.id) instagramMap.set(ig.id, { id: ig.id, name: ig.username || ig.id });
    }
    for (const p of pagesRaw) {
      const iba = p.instagram_business_account;
      if (iba && typeof iba.id === "string" && !instagramMap.has(iba.id)) {
        instagramMap.set(iba.id, { id: iba.id, name: iba.username || iba.id });
      }
    }
    const meta_instagram_ids = [...instagramMap.values()];

    const pixelMap = new Map();
    for (const acc of adAccountsRaw) {
      const aid = acc.id;
      if (!aid) continue;
      const pixels = await graphFetchEdgeList(
        buildGraphUrl(`/${aid}/adspixels`, accessToken, {
          fields: "id,name",
        }),
        `${aid}/adspixels`,
      );
      for (const px of pixels) {
        if (px.id != null && !pixelMap.has(String(px.id))) {
          pixelMap.set(String(px.id), { id: String(px.id), name: px.name || String(px.id) });
        }
      }
    }
    const meta_pixel_ids = [...pixelMap.values()];

    const businessId = String(state);
    const userId = metaUserId;
    const adAccountIds = meta_ad_account_ids;
    const pageIds = meta_page_ids;
    const instagramIds = meta_instagram_ids;
    const pixelIds = meta_pixel_ids;

    const { error: updateError } = await supabaseAdmin
      .from("businesses")
      .update({
        meta_access_token: accessToken,
        meta_token_expires_at: tokenExpiresAt,
        meta_user_id: userId,
        meta_ad_account_ids: adAccountIds,
        meta_page_ids: pageIds,
        meta_instagram_ids: instagramIds,
        meta_pixel_ids: pixelIds,
      })
      .eq("id", businessId);

    if (updateError) {
      console.log("[auth/meta/callback] Supabase update error:", JSON.stringify(updateError));
      return cbHtml("שמירה נכשלה", updateError.message, "");
    }

    // Instead of redirecting to the Expo app (which needs to fully boot in
    // a popup), render a lightweight success page that posts a message back
    // to the opener window and closes itself.
    console.log("[auth/meta/callback] SUCCESS — saved token for business", businessId);
    console.log("  ad_accounts:", adAccountIds.length, "pages:", pageIds.length, "instagram:", instagramIds.length, "pixels:", pixelIds.length);
    return cbHtml(
      "✓ חיבור Meta הצליח!",
      `חשבונות מודעות: ${adAccountIds.length} · דפים: ${pageIds.length} · אינסטגרם: ${instagramIds.length}`,
      `<script>
        try {
          if (window.opener) {
            window.opener.postMessage({ type: "adchat-meta-oauth", ok: true }, "*");
            setTimeout(function() { window.close(); }, 1500);
          } else {
            setTimeout(function() {
              window.location.href = "${APP_WEB_ORIGIN}/(tabs)/settings";
            }, 1500);
          }
        } catch(e) {
          document.body.innerHTML += '<p><a href="${APP_WEB_ORIGIN}/(tabs)/settings">חזרו לאפליקציה</a></p>';
        }
      </script>
      <p style="margin-top:1.5rem;opacity:.6;font-size:0.85rem">החלון ייסגר אוטומטית…</p>`,
    );
  } catch (e) {
    console.error("[auth/meta/callback] UNCAUGHT ERROR:", e);
    return cbHtml("שגיאת שרת", e instanceof Error ? e.message : String(e), "");
  }
});

app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt, aspect_ratio, business_id } = req.body || {};
    if (prompt == null || String(prompt).trim() === "") {
      return res.status(400).json({ error: 'חסר "prompt".' });
    }
    const gen = await generateImageWithGeminiInternal({
      prompt: String(prompt).trim(),
      aspect_ratio: aspect_ratio || "1:1",
      business_id: business_id != null ? String(business_id) : "",
    });
    if (!gen.ok) {
      return res.status(502).json({
        error: "יצירת תמונה נכשלה",
        details: gen.error,
      });
    }
    return res.json({
      image_base64: gen.image_base64,
      mime_type: gen.mime_type,
      text: gen.text || "",
    });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/api/agent", async (req, res) => {
  try {
    const agentNorm = normalizeAgentKey(req.body?.agent);
    if (!agentNorm) {
      return res.status(400).json({
        error:
          'חסר או לא תקין agent — צפוי אחד מ: "dana"|"yoni"|"ron"|"maya"|"noa"',
      });
    }
    const result = await runAgentTurn({ ...req.body, agent: agentNorm });
    if (result.errorStatus) {
      const { httpStatus, json } = buildAnthropicProxyErrorResponse(result);
      return res.status(httpStatus).json(json);
    }
    const payload = await buildAgentHttpPayload(req.body, result);
    return res.json(payload);
  } catch (err) {
    const code = err.statusCode || 500;
    return res.status(code).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const body = req.body || {};
    const agentNorm = normalizeAgentKey(body.agent) || "dana";
    const result = await runAgentTurn({ ...body, agent: agentNorm });
    if (result.errorStatus) {
      const { httpStatus, json } = buildAnthropicProxyErrorResponse(result);
      return res.status(httpStatus).json(json);
    }
    const payload = await buildAgentHttpPayload(body, result);
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({
      error: "שגיאה בשרת proxy",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

// ========================================================
// ================= LEADS MANAGEMENT =====================
// ========================================================

async function getBusinessPageAccess(businessId) {
  const { data: row, error } = await supabaseAdmin
    .from("businesses")
    .select("meta_access_token, selected_page_id, meta_page_ids")
    .eq("id", businessId)
    .maybeSingle();
  if (error || !row?.meta_access_token) return null;
  const pageId =
    row.selected_page_id ||
    (Array.isArray(row.meta_page_ids) && row.meta_page_ids.length > 0
      ? typeof row.meta_page_ids[0] === "object"
        ? row.meta_page_ids[0].id
        : row.meta_page_ids[0]
      : null);
  if (!pageId) return null;
  return { accessToken: String(row.meta_access_token), pageId: String(pageId) };
}

async function syncLeadsForBusiness(biz) {
  const businessId = biz.id;
  const accessToken = biz.meta_access_token;
  const pageId = biz.selected_page_id;
  if (!accessToken || !pageId) return { synced: 0, new_leads: 0, by_campaign: {} };

  let totalSynced = 0;
  let newLeads = 0;
  const byCampaign = {};

  try {
    // Fetch lead forms for the page
    const formsUrl = buildGraphUrl(`/${pageId}/leadgen_forms`, accessToken, {
      fields: "id,name,status",
      limit: "100",
    });
    const forms = await graphFetchEdgeList(formsUrl, `${pageId}/leadgen_forms`);

    for (const form of forms) {
      if (!form.id) continue;

      // Fetch leads for this form
      const leadsUrl = buildGraphUrl(`/${form.id}/leads`, accessToken, {
        fields: "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name",
        limit: "500",
      });
      const metaLeads = await graphFetchEdgeList(leadsUrl, `${form.id}/leads`);

      for (const ml of metaLeads) {
        if (!ml.id) continue;

        // Parse field_data
        const fields = {};
        const customFields = {};
        if (Array.isArray(ml.field_data)) {
          for (const f of ml.field_data) {
            const name = String(f.name || "").toLowerCase();
            const val = Array.isArray(f.values) ? f.values[0] : "";
            if (name === "full_name") fields.full_name = val;
            else if (name === "first_name") fields.first_name = val;
            else if (name === "last_name") fields.last_name = val;
            else if (name === "email") fields.email = val;
            else if (name === "phone_number" || name === "phone") fields.phone = val;
            else if (name === "city") fields.city = val;
            else customFields[f.name] = val;
          }
        }

        // Build full_name if missing
        if (!fields.full_name && (fields.first_name || fields.last_name)) {
          fields.full_name = [fields.first_name, fields.last_name].filter(Boolean).join(" ");
        }

        // Fetch ad creative if ad_id present
        let adImageUrl = null;
        let adHeadline = null;
        let adBody = null;
        if (ml.ad_id) {
          try {
            const adUrl = buildGraphUrl(`/${ml.ad_id}`, accessToken, {
              fields: "creative{thumbnail_url,title,body}",
            });
            const adRes = await fetch(adUrl);
            const adJson = await adRes.json().catch(() => ({}));
            if (adJson.creative) {
              adImageUrl = adJson.creative.thumbnail_url || null;
              adHeadline = adJson.creative.title || null;
              adBody = adJson.creative.body || null;
            }
          } catch (e) {
            console.warn("[leads-sync] ad creative fetch:", e.message);
          }
        }

        // Track by campaign
        const campName = ml.campaign_name || "unknown";
        byCampaign[campName] = (byCampaign[campName] || 0) + 1;

        // Upsert lead
        const { data: existing } = await supabaseAdmin
          .from("leads")
          .select("id")
          .eq("lead_id", ml.id)
          .maybeSingle();

        if (existing) {
          totalSynced++;
          continue;
        }

        const { error: insertErr } = await supabaseAdmin.from("leads").insert({
          business_id: businessId,
          lead_id: ml.id,
          form_id: form.id,
          form_name: form.name || null,
          ad_id: ml.ad_id || null,
          ad_name: ml.ad_name || null,
          adset_id: ml.adset_id || null,
          adset_name: ml.adset_name || null,
          campaign_id: ml.campaign_id || null,
          campaign_name: ml.campaign_name || null,
          page_id: pageId,
          full_name: fields.full_name || null,
          first_name: fields.first_name || null,
          last_name: fields.last_name || null,
          email: fields.email || null,
          phone: fields.phone || null,
          city: fields.city || null,
          custom_fields: customFields,
          ad_image_url: adImageUrl,
          ad_headline: adHeadline,
          ad_body: adBody,
          meta_created_time: ml.created_time || null,
        });

        if (insertErr) {
          console.warn("[leads-sync] insert:", insertErr.message);
        } else {
          newLeads++;
        }
        totalSynced++;
      }
    }

    // Save sync result to client_memory
    await supabaseAdmin.from("client_memory").upsert(
      {
        business_id: businessId,
        category: "insights",
        key: "leads_last_sync",
        value: JSON.stringify({
          synced_at: new Date().toISOString(),
          total: totalSynced,
          new_leads: newLeads,
          by_campaign: byCampaign,
        }),
        source: "auto_sync",
        confidence: 95,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,category,key" },
    );

    // Update leads overview in client_memory
    await updateLeadsOverviewMemory(businessId);

    invalidateLeadsCache(businessId);
    leadsStatsCache.delete(businessId);

  } catch (err) {
    console.warn("[leads-sync] error:", err.message);
  }

  return { synced: totalSynced, new_leads: newLeads, by_campaign: byCampaign };
}

async function updateLeadsOverviewMemory(businessId) {
  try {
    const { data: allLeads } = await supabaseAdmin
      .from("leads")
      .select("id, status, campaign_name, created_at")
      .eq("business_id", businessId);
    const leads = allLeads || [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const newToday = leads.filter(
      (l) => l.status === "new" && new Date(l.created_at) >= todayStart
    ).length;
    const won = leads.filter((l) => l.status === "won").length;
    const conversionRate = leads.length > 0 ? Math.round((won / leads.length) * 100) : 0;

    // Campaign counts
    const campCounts = {};
    for (const l of leads) {
      const c = l.campaign_name || "unknown";
      campCounts[c] = (campCounts[c] || 0) + 1;
    }
    const topCampaign = Object.entries(campCounts).sort((a, b) => b[1] - a[1])[0];

    // Hot leads: new status, older than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const hotLeads = leads
      .filter((l) => l.status === "new" && new Date(l.created_at) < oneHourAgo)
      .map((l) => l.id);

    await supabaseAdmin.from("client_memory").upsert(
      {
        business_id: businessId,
        category: "insights",
        key: "leads_overview",
        value: JSON.stringify({
          total_leads: leads.length,
          new_leads_today: newToday,
          top_campaign: topCampaign ? topCampaign[0] : null,
          conversion_rate: `${conversionRate}%`,
          last_sync: new Date().toISOString(),
          hot_leads: hotLeads.slice(0, 10),
        }),
        source: "auto_sync",
        confidence: 95,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,category,key" },
    );
  } catch (err) {
    console.warn("[leads-overview] memory update:", err.message);
  }
}

// POST /api/leads/sync
app.post("/api/leads/sync", requireBearerAuthorization, async (req, res) => {
  const businessId = req.body?.business_id || req.query.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר או לא תקין business_id (UUID)" });
  }
  const bid = String(businessId);
  try {
    const { data: biz, error: be } = await supabaseAdmin
      .from("businesses")
      .select("id, meta_access_token, selected_page_id, meta_page_ids")
      .eq("id", bid)
      .maybeSingle();
    if (be || !biz) {
      return res.status(404).json({ error: "עסק לא נמצא" });
    }
    if (!biz.meta_access_token) {
      return res.status(400).json({ error: "Meta לא מחובר" });
    }
    const pageId =
      biz.selected_page_id ||
      (Array.isArray(biz.meta_page_ids) && biz.meta_page_ids.length > 0
        ? typeof biz.meta_page_ids[0] === "object"
          ? biz.meta_page_ids[0].id
          : biz.meta_page_ids[0]
        : null);
    if (!pageId) {
      return res.status(400).json({ error: "אין עמוד פייסבוק מחובר" });
    }
    const result = await syncLeadsForBusiness({
      id: bid,
      meta_access_token: biz.meta_access_token,
      selected_page_id: pageId,
    });
    return res.json(result);
  } catch (err) {
    console.error("[POST /api/leads/sync]", err);
    return res.status(500).json({ error: "שגיאה בסנכרון לידים" });
  }
});

// GET /api/leads
app.get("/api/leads", requireBearerAuthorization, async (req, res) => {
  const businessId = req.query.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר או לא תקין business_id (UUID)" });
  }
  const bid = String(businessId);
  const status = req.query.status || "";
  const search = req.query.search || "";
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "20", 10)));
  const offset = (page - 1) * limit;

  const filterKey = JSON.stringify({ status, search, page, limit });
  const cached = getLeadsCache(bid, filterKey);
  if (cached) return res.json(cached);

  try {
    let query = supabaseAdmin
      .from("leads")
      .select("*, lead_updates(count)", { count: "exact" })
      .eq("business_id", bid)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);
    if (search) {
      query = query.or(
        `full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,campaign_name.ilike.%${search}%`
      );
    }

    const { data, error, count } = await query;
    if (error) {
      console.warn("[GET /api/leads]", error.message);
      return res.status(500).json({ error: error.message });
    }

    const result = {
      leads: data || [],
      total: count || 0,
      pages: Math.ceil((count || 0) / limit),
    };
    setLeadsCache(bid, filterKey, result);
    return res.json(result);
  } catch (err) {
    console.error("[GET /api/leads]", err);
    return res.status(500).json({ error: "שגיאה בטעינת לידים" });
  }
});

// GET /api/leads/stats
app.get("/api/leads/stats", requireBearerAuthorization, async (req, res) => {
  const businessId = req.query.business_id;
  if (!businessId || !isUuid(String(businessId))) {
    return res.status(400).json({ error: "חסר או לא תקין business_id (UUID)" });
  }
  const bid = String(businessId);
  const cached = getLeadsStatsCache(bid);
  if (cached) return res.json(cached);

  try {
    const { data: leads, error } = await supabaseAdmin
      .from("leads")
      .select("id, status, campaign_name, created_at")
      .eq("business_id", bid);
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    const all = leads || [];
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);

    const byStatus = {};
    const byCampaign = {};
    let newToday = 0;
    let newThisWeek = 0;

    for (const l of all) {
      const s = l.status || "new";
      byStatus[s] = (byStatus[s] || 0) + 1;
      const c = l.campaign_name || "unknown";
      byCampaign[c] = (byCampaign[c] || 0) + 1;
      const created = new Date(l.created_at);
      if (created >= todayStart) newToday++;
      if (created >= weekStart) newThisWeek++;
    }

    const won = byStatus.won || 0;
    const conversionRate = all.length > 0 ? Math.round((won / all.length) * 100) : 0;
    const pendingCount = (byStatus.new || 0);

    const stats = {
      total: all.length,
      new_today: newToday,
      new_this_week: newThisWeek,
      by_status: byStatus,
      by_campaign: byCampaign,
      conversion_rate: conversionRate,
      pending: pendingCount,
    };

    setLeadsStatsCache(bid, stats);

    // Save to client_memory
    await supabaseAdmin.from("client_memory").upsert(
      {
        business_id: bid,
        category: "insights",
        key: "leads_stats",
        value: JSON.stringify(stats),
        source: "auto_sync",
        confidence: 95,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,category,key" },
    );

    return res.json(stats);
  } catch (err) {
    console.error("[GET /api/leads/stats]", err);
    return res.status(500).json({ error: "שגיאה בחישוב סטטיסטיקות" });
  }
});

// GET /api/leads/:id
app.get("/api/leads/:id", requireBearerAuthorization, async (req, res) => {
  const id = req.params.id;
  if (!id || !isUuid(String(id))) {
    return res.status(400).json({ error: "חסר או לא תקין lead id" });
  }
  try {
    const { data: lead, error } = await supabaseAdmin
      .from("leads")
      .select("*")
      .eq("id", String(id))
      .maybeSingle();
    if (error || !lead) {
      return res.status(404).json({ error: "ליד לא נמצא" });
    }
    const { data: updates } = await supabaseAdmin
      .from("lead_updates")
      .select("*")
      .eq("lead_id", String(id))
      .order("created_at", { ascending: false });
    return res.json({ lead, updates: updates || [] });
  } catch (err) {
    console.error("[GET /api/leads/:id]", err);
    return res.status(500).json({ error: "שגיאה בטעינת ליד" });
  }
});

// PATCH /api/leads/:id
app.patch("/api/leads/:id", requireBearerAuthorization, async (req, res) => {
  const id = req.params.id;
  if (!id || !isUuid(String(id))) {
    return res.status(400).json({ error: "חסר או לא תקין lead id" });
  }
  try {
    // Load existing to detect status change
    const { data: existing } = await supabaseAdmin
      .from("leads")
      .select("status, business_id")
      .eq("id", String(id))
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: "ליד לא נמצא" });

    const allowed = ["status", "notes", "next_follow_up", "deal_value", "assigned_to"];
    const patch = { updated_at: new Date().toISOString() };
    for (const k of allowed) {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

    const { data, error } = await supabaseAdmin
      .from("leads")
      .update(patch)
      .eq("id", String(id))
      .select("*")
      .single();
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Auto-create status_change update
    if (req.body.status && req.body.status !== existing.status) {
      const STATUS_HE = {
        new: "חדש",
        contacted: "יצר קשר",
        qualified: "מוסמך",
        proposal: "הצעה",
        won: "סגור",
        lost: "אבוד",
        not_relevant: "לא רלוונטי",
      };
      await supabaseAdmin.from("lead_updates").insert({
        lead_id: String(id),
        business_id: existing.business_id,
        content: `סטטוס שונה מ-${STATUS_HE[existing.status] || existing.status} ל-${STATUS_HE[req.body.status] || req.body.status}`,
        type: "status_change",
      });
    }

    invalidateLeadsCache(existing.business_id);
    leadsStatsCache.delete(existing.business_id);
    await updateLeadsOverviewMemory(existing.business_id);

    return res.json(data);
  } catch (err) {
    console.error("[PATCH /api/leads/:id]", err);
    return res.status(500).json({ error: "שגיאה בעדכון ליד" });
  }
});

// POST /api/leads/:id/updates
app.post("/api/leads/:id/updates", requireBearerAuthorization, async (req, res) => {
  const id = req.params.id;
  if (!id || !isUuid(String(id))) {
    return res.status(400).json({ error: "חסר או לא תקין lead id" });
  }
  const { content, type } = req.body || {};
  if (!content || !String(content).trim()) {
    return res.status(400).json({ error: "חסר תוכן" });
  }
  const validTypes = ["note", "call", "email", "whatsapp", "meeting", "status_change"];
  const updateType = validTypes.includes(type) ? type : "note";

  try {
    // Get business_id from lead
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("business_id")
      .eq("id", String(id))
      .maybeSingle();
    if (!lead) return res.status(404).json({ error: "ליד לא נמצא" });

    const { data, error } = await supabaseAdmin.from("lead_updates").insert({
      lead_id: String(id),
      business_id: lead.business_id,
      content: String(content).trim(),
      type: updateType,
    }).select("*").single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    invalidateLeadsCache(lead.business_id);
    return res.json(data);
  } catch (err) {
    console.error("[POST /api/leads/:id/updates]", err);
    return res.status(500).json({ error: "שגיאה בהוספת עדכון" });
  }
});

// Auto-sync leads every 30 minutes
setInterval(async () => {
  try {
    const { data: businesses } = await supabaseAdmin
      .from("businesses")
      .select("id, meta_access_token, selected_page_id")
      .not("meta_access_token", "is", null)
      .not("selected_page_id", "is", null);
    for (const biz of businesses || []) {
      await syncLeadsForBusiness(biz);
    }
    console.log(`[leads-auto-sync] synced ${(businesses || []).length} businesses`);
  } catch (err) {
    console.warn("[leads-auto-sync] error:", err.message);
  }
}, 30 * 60 * 1000);

function logRegisteredRoutes(expressApp) {
  const lines = [];
  if (expressApp._router && expressApp._router.stack) {
    expressApp._router.stack.forEach((layer) => {
      if (layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods)
          .filter((m) => layer.route.methods[m])
          .map((m) => m.toUpperCase())
          .join(", ");
        lines.push(`  ${methods} ${layer.route.path}`);
      }
    });
  }
  console.log("[Puls. server] נתיבים רשומים ב-express:");
  if (lines.length) {
    lines.forEach((l) => console.log(l));
  } else {
    console.log("  (לא נמצאו — בדוק גרסת express)");
  }
}

// --- Dual HTTP + HTTPS ---
// HTTP on PORT (3001) for normal API calls from the Expo app.
// HTTPS on PORT+1 (3002) for the Facebook OAuth callback only
// (Facebook requires "Enforce HTTPS" for redirect URIs).
const fs = require("fs");
const pathMod = require("path");
const certPath = pathMod.join(__dirname, "certs", "cert.pem");
const keyPath = pathMod.join(__dirname, "certs", "key.pem");
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);
const HTTPS_PORT = PORT + 1; // 3002

app.listen(PORT, () => {
  logRegisteredRoutes(app);
  console.log("META_OAUTH_SCOPES:", META_OAUTH_SCOPES);
  console.log(`Puls. server listening on port ${PORT}`);

  // Production safety check
  const isProd = process.env.NODE_ENV === "production";
  const origin = process.env.APP_WEB_ORIGIN || "";
  if (isProd && origin.includes("localhost")) {
    console.warn("⚠️  WARNING: APP_WEB_ORIGIN contains 'localhost' in production mode! Update it to your real domain.");
  }
  if (isProd && !RESEND_API_KEY) {
    console.warn("⚠️  WARNING: RESEND_API_KEY not set ��� email notifications disabled.");
  }

  // Cron פנימי: בדיקת התראות כל שעה (ללא תלות בשרת חיצוני).
  // אם תרצה להריץ רק דרך ספק cron חיצוני — קבע ENABLE_ALERTS_CRON=0.
  const cronEnabled =
    String(process.env.ENABLE_ALERTS_CRON ?? "1").trim() !== "0";
  if (!cronEnabled) return;

  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const { data: rows, error } = await supabaseAdmin
        .from("businesses")
        .select("id")
        .not("meta_access_token", "is", null);
      if (error) {
        console.warn("[alerts-cron] businesses:", error.message);
        return;
      }
      const ids = (rows || []).map((r) => r.id).filter(Boolean);
      const result = await runAlertsCheckForBusinesses(ids);
      console.log(
        "[alerts-cron]",
        JSON.stringify(
          {
            businesses_checked: result.businesses_checked,
            alerts_created: result.alerts_created,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      console.warn(
        "[alerts-cron] error:",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      inFlight = false;
    }
  };

  // להריץ פעם אחת אחרי עלייה, ואז כל שעה.
  setTimeout(() => void tick(), 10_000);
  setInterval(() => void tick(), 60 * 60 * 1000);

  // Weekly report cron: every Monday at 8:00 AM (check every hour)
  const weeklyReportEnabled = String(process.env.ENABLE_WEEKLY_REPORT ?? "1").trim() !== "0";
  if (weeklyReportEnabled) {
    let lastWeeklyRun = 0;
    const weeklyTick = async () => {
      const now = new Date();
      // Only run on Monday between 8:00-8:59
      if (now.getDay() !== 1 || now.getHours() !== 8) return;
      // Don't run more than once per day
      const dayKey = now.toISOString().slice(0, 10);
      if (lastWeeklyRun === dayKey) return;
      lastWeeklyRun = dayKey;
      console.log("[weekly-report-cron] running weekly report...");
      try {
        const { data: rows } = await supabaseAdmin
          .from("businesses")
          .select("id")
          .not("meta_access_token", "is", null);
        const ids = (rows || []).map((r) => r.id).filter(Boolean);
        let sent = 0;
        for (const bid of ids) {
          const report = await generateWeeklyReportForBusiness(bid);
          if (report && resend && report.userId) {
            try {
              const { data: auth } = await supabaseAdmin.auth.admin.getUserById(report.userId);
              const email = auth?.user?.email;
              if (email) {
                await resend.emails.send({
                  from: FROM_EMAIL,
                  to: email,
                  subject: `סיכום שבועי — ${report.name} | Puls.`,
                  html: `<div dir="rtl" style="font-family:system-ui,sans-serif"><h2>סיכום שבועי — ${report.name}</h2><p style="white-space:pre-wrap;line-height:1.8">${report.analysis}</p><hr style="border:none;border-top:1px solid #eee;margin:20px 0"><p style="color:#888;font-size:13px">נשלח אוטומטית מ-Puls.</p></div>`,
                });
                sent++;
              }
            } catch { /* ignore individual email errors */ }
          }
        }
        console.log(`[weekly-report-cron] done. businesses: ${ids.length}, emails: ${sent}`);
      } catch (e) {
        console.warn("[weekly-report-cron] error:", e instanceof Error ? e.message : String(e));
      }
    };
    setInterval(() => void weeklyTick(), 60 * 60 * 1000);
  }

  // Creative fatigue cron: check every 6 hours for images older than 21 days
  const FATIGUE_DAYS = 21;
  let lastFatigueRun = "";
  const fatigueTick = async () => {
    const dayKey = new Date().toISOString().slice(0, 10);
    if (lastFatigueRun === dayKey) return;
    lastFatigueRun = dayKey;
    try {
      const cutoff = new Date(Date.now() - FATIGUE_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data: staleImages } = await supabaseAdmin
        .from("media_library")
        .select("id,business_id,prompt,created_at")
        .eq("agent", "maya")
        .lt("created_at", cutoff)
        .is("fatigue_alert_sent", null)
        .limit(50);
      if (!staleImages?.length) return;
      const grouped = {};
      for (const img of staleImages) {
        if (!grouped[img.business_id]) grouped[img.business_id] = [];
        grouped[img.business_id].push(img);
      }
      let alertsCreated = 0;
      for (const [bid, images] of Object.entries(grouped)) {
        try {
          await supabaseAdmin.from("proactive_messages").insert({
            business_id: bid,
            type: "creative_fatigue",
            title: "הגיע הזמן לרענן את הקריאייטיב",
            body: `${images.length} גרפיקות פעילות כבר ${FATIGUE_DAYS} יום — רענון הקריאייטיב ישפר את הביצועים. שאלי את מאיה ליצור גרפיקות חדשות בסגנון עדכני.`,
            meta: JSON.stringify({ image_count: images.length, oldest: images[0].created_at }),
          });
          const ids = images.map((i) => i.id);
          await supabaseAdmin
            .from("media_library")
            .update({ fatigue_alert_sent: true })
            .in("id", ids);
          alertsCreated++;
        } catch (e) {
          console.warn("[fatigue-cron] biz error:", e instanceof Error ? e.message : String(e));
        }
      }
      console.log(`[fatigue-cron] done. alerts: ${alertsCreated}`);
    } catch (e) {
      console.warn("[fatigue-cron] error:", e instanceof Error ? e.message : String(e));
    }
  };
  setTimeout(() => void fatigueTick(), 30_000);
  setInterval(() => void fatigueTick(), 6 * 60 * 60 * 1000);
});

// HTTPS server for Facebook OAuth callback
if (hasCerts) {
  require("https")
    .createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
    .listen(HTTPS_PORT, () => {
      console.log(`HTTPS server for OAuth callback on https://localhost:${HTTPS_PORT}`);
    });
}
