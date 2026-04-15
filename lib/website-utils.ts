/** Normalize a user-entered website URL to a full https:// URL. Returns "" if invalid. */
export function normalizeWebsiteUrl(s: string): string {
  const t = String(s || "").trim();
  if (!t || /^אין$/i.test(t)) return "";
  const u = t.includes("://") ? t : `https://${t}`;
  try {
    new URL(u);
    return u;
  } catch {
    return "";
  }
}

/** Format scrape result data into a readable Hebrew summary string. */
export function formatScrapeSummary(data: Record<string, unknown>): string {
  const social = data.social_links;
  let socialBits = "—";
  if (social && typeof social === "object") {
    const parts = Object.entries(social as Record<string, unknown>)
      .map(([k, v]) => (String(v || "").trim() ? `${k}: ${v}` : ""))
      .filter(Boolean);
    socialBits = parts.length ? parts.join(" · ") : "—";
  }
  const colors = Array.isArray(data.brand_colors)
    ? (data.brand_colors as unknown[]).map((x) => String(x)).join(", ")
    : "—";
  return (
    `🏢 שם עסק: ${String(data.business_name || "—")} | ${String(data.industry || "—")}\n` +
    `💡 מה שמייחד אותך: ${String(data.unique_value || "—")}\n` +
    `👥 קהל יעד: ${String(data.target_audience || "—")}\n` +
    `🎯 קריאה לפעולה: ${String(data.main_cta || "—")}\n` +
    `🎨 צבעי מותג: ${colors}\n` +
    `📱 רשתות חברתיות: ${socialBits}`
  );
}
