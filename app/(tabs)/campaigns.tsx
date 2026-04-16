import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useRouter } from "expo-router";
import { useBusiness } from "../../contexts/business-context";
import { useTheme } from "../../contexts/theme-context";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { fetchAdchatApi } from "../../lib/fetch-adchat-api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Shimmer } from "../../components/Shimmer";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

type MetaCampaign = {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  daily_budget: number;
  lifetime_budget: number;
  start_time: string | null;
  stop_time: string | null;
  created_time: string | null;
  spend: number;
  clicks: number;
  impressions: number;
  cpc: number;
  ctr: number;
  leads: number;
  cpl: number;
  spent_last_24h: number;
  delta_spend: number | null;
  delta_clicks: number | null;
  delta_impressions: number | null;
  delta_leads: number | null;
  delta_cpl: number | null;
};

type StatusFilter = "ALL" | "ACTIVE" | "PAUSED" | "ARCHIVED" | "SPENDING";

type DatePreset = "today" | "yesterday" | "last_7d" | "this_month" | "last_30d";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "הכל" },
  { key: "SPENDING", label: "הוציאו תקציב" },
  { key: "ACTIVE", label: "פעילים" },
  { key: "PAUSED", label: "מושהים" },
  { key: "ARCHIVED", label: "ארכיון" },
];

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "היום" },
  { key: "yesterday", label: "אתמול" },
  { key: "last_7d", label: "7 ימים" },
  { key: "this_month", label: "החודש" },
  { key: "last_30d", label: "30 יום" },
];

function statusLabel(s: string): string {
  const u = (s || "").toUpperCase();
  if (u === "ACTIVE") return "פעיל";
  if (u === "PAUSED") return "מושהה";
  if (u === "ARCHIVED") return "ארכיון";
  if (u === "DELETED") return "נמחק";
  return s;
}

function statusColor(s: string, spentLast24h = 0) {
  const u = (s || "").toUpperCase();
  if (u === "ACTIVE" && spentLast24h > 0)
    return { bg: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.3)", text: "#4ADE80", dot: "#22C55E" };
  if (u === "ACTIVE")
    return { bg: "rgba(234,179,8,0.14)", border: "rgba(234,179,8,0.3)", text: "#FDE047", dot: "#EAB308" };
  if (u === "PAUSED")
    return { bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.22)", text: "#CBD5E1", dot: "#94A3B8" };
  return { bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.22)", text: "#CBD5E1", dot: "#94A3B8" };
}

function formatIls(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatNum(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString("he-IL");
}

function objectiveLabel(o: string | null): string {
  if (!o) return "";
  const map: Record<string, string> = {
    OUTCOME_TRAFFIC: "תנועה", OUTCOME_ENGAGEMENT: "מעורבות", OUTCOME_LEADS: "לידים",
    OUTCOME_SALES: "מכירות", OUTCOME_AWARENESS: "מודעות", LINK_CLICKS: "קליקים",
    CONVERSIONS: "המרות", REACH: "חשיפה", LEAD_GENERATION: "לידים", MESSAGES: "הודעות",
  };
  return map[o] || o.replace(/^OUTCOME_/, "").replace(/_/g, " ").toLowerCase();
}

export default function CampaignsScreen() {
  const router = useRouter();
  const { business, loading: businessLoading } = useBusiness();
  const { isDesktop } = useResponsiveLayout();
  const rawTabBarHeight = useBottomTabBarHeight();
  const tabBarHeight = isDesktop ? 0 : rawTabBarHeight;
  const { colors } = useTheme();

  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [datePreset, setDatePreset] = useState<DatePreset>("last_7d");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const didLoadCache = useRef(false);

  useEffect(() => {
    if (businessLoading) return;
    if (!business) router.replace("/onboarding");
  }, [businessLoading, business, router]);

  // Load from AsyncStorage cache first
  useEffect(() => {
    if (!business?.id || didLoadCache.current) return;
    didLoadCache.current = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(`campaigns:${business.id}:${datePreset}`);
        if (!raw) return;
        const cached = JSON.parse(raw);
        if (Array.isArray(cached.campaigns) && cached.campaigns.length > 0) {
          // Skip stale cache without delta fields
          const hasDeltas = cached.campaigns[0]?.delta_spend !== undefined;
          if (hasDeltas) {
            setCampaigns(cached.campaigns);
            setConnected(cached.connected !== false);
            setFetchedAt(cached.fetched_at || null);
          }
        }
      } catch { /* ignore */ }
    })();
  }, [business?.id, datePreset]);

  const loadCampaigns = useCallback(async (force = false, preset?: DatePreset) => {
    setError(null);
    const p = preset || datePreset;
    if (!business?.id) { setCampaigns([]); return; }
    try {
      const url = `${API_BASE}/api/meta-campaigns?business_id=${encodeURIComponent(business.id)}&preset=${p}${force ? "&force=1" : ""}`;
      const res = await fetchAdchatApi(url);
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) { router.replace("/auth"); return; }
      if (!res.ok) { setError(json.error || "משהו השתבש. נסה שוב."); return; }
      setConnected(json.connected !== false);
      setFetchedAt(json.fetched_at || null);
      const list = Array.isArray(json.campaigns) ? json.campaigns : [];
      setCampaigns(list);
      void AsyncStorage.setItem(`campaigns:${business.id}:${p}`, JSON.stringify(json));
    } catch { setError("אין חיבור לאינטרנט. בדוק את החיבור ונסה שוב."); }
  }, [business?.id, datePreset]);

  useEffect(() => {
    if (businessLoading || !business?.id) { setLoading(false); return; }
    let c = false;
    (async () => { setLoading(true); await loadCampaigns(); if (!c) setLoading(false); })();
    return () => { c = true; };
  }, [loadCampaigns, businessLoading, business?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadCampaigns(true);
    setRefreshing(false);
  }, [loadCampaigns]);

  const onDateChange = useCallback((p: DatePreset) => {
    setDatePreset(p);
    setLoading(true);
    void (async () => {
      await loadCampaigns(false, p);
      setLoading(false);
    })();
  }, [loadCampaigns]);

  const filtered = useMemo(() => {
    if (statusFilter === "ALL") return campaigns;
    if (statusFilter === "SPENDING") return campaigns.filter((c) => (c.status || "").toUpperCase() === "ACTIVE" && (c.spent_last_24h || 0) > 0);
    return campaigns.filter((c) => (c.status || "").toUpperCase() === statusFilter);
  }, [campaigns, statusFilter]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { ALL: campaigns.length };
    let spending = 0;
    for (const c of campaigns) {
      const s = (c.status || "").toUpperCase();
      m[s] = (m[s] || 0) + 1;
      if (s === "ACTIVE" && (c.spent_last_24h || 0) > 0) spending++;
    }
    m.SPENDING = spending;
    return m;
  }, [campaigns]);

  // Summary totals with weighted average deltas
  const totals = useMemo(() => {
    let spend = 0, clicks = 0, impressions = 0, leads = 0;
    let dSpendSum = 0, dSpendN = 0, dClicksSum = 0, dClicksN = 0;
    let dImpSum = 0, dImpN = 0, dLeadsSum = 0, dLeadsN = 0;
    for (const c of filtered) {
      spend += c.spend || 0;
      clicks += c.clicks || 0;
      impressions += c.impressions || 0;
      leads += c.leads || 0;
      if (c.delta_spend != null) { dSpendSum += c.delta_spend; dSpendN++; }
      if (c.delta_clicks != null) { dClicksSum += c.delta_clicks; dClicksN++; }
      if (c.delta_impressions != null) { dImpSum += c.delta_impressions; dImpN++; }
      if (c.delta_leads != null) { dLeadsSum += c.delta_leads; dLeadsN++; }
    }
    const cpl = leads > 0 ? spend / leads : 0;
    return {
      spend, clicks, impressions, leads, cpl,
      delta_spend: dSpendN > 0 ? Math.round(dSpendSum / dSpendN) : null,
      delta_clicks: dClicksN > 0 ? Math.round(dClicksSum / dClicksN) : null,
      delta_impressions: dImpN > 0 ? Math.round(dImpSum / dImpN) : null,
      delta_leads: dLeadsN > 0 ? Math.round(dLeadsSum / dLeadsN) : null,
    };
  }, [filtered]);

  if (loading || businessLoading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={colors.statusBar as any} />
        <View style={[styles.header, { borderBottomColor: colors.separator, paddingHorizontal: isDesktop ? "5%" : 16 }]}>
          <Shimmer width={120} height={20} style={{ alignSelf: "flex-end" }} />
          <View style={{ flexDirection: "row-reverse", gap: 6, marginTop: 12 }}>
            {[0, 1, 2].map((i) => <Shimmer key={i} width={70} height={32} borderRadius={16} />)}
          </View>
        </View>
        <View style={{ padding: 14, gap: 12, paddingHorizontal: isDesktop ? "5%" : 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
              <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" }}>
                <Shimmer width="60%" height={16} />
                <Shimmer width={64} height={26} borderRadius={13} />
              </View>
              <View style={{ flexDirection: "row-reverse", gap: 8, marginTop: 14 }}>
                {[0, 1, 2, 3].map((j) => (
                  <View key={j} style={{ flex: 1, alignItems: "center", gap: 6 }}>
                    <Shimmer width={50} height={16} />
                    <Shimmer width={36} height={10} />
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (!connected) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={colors.statusBar as any} />
        <View style={styles.centered}>
          <Text style={{ fontSize: 40 }}>📊</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Meta לא מחובר</Text>
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>חבר את חשבון הפייסבוק בהגדרות כדי לראות קמפיינים.</Text>
          <Pressable style={styles.connectBtn} onPress={() => router.push("/(tabs)/settings")}>
            <Text style={styles.connectBtnText}>פתח הגדרות</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={colors.statusBar as any} />
      <View style={{ flex: 1 }}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.separator, paddingHorizontal: isDesktop ? "5%" : 16 }]}>
          <View style={styles.headerTop}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>קמפיינים</Text>
            <Text style={[styles.headerMeta, { color: colors.textMuted }]}>
              {campaigns.length} קמפיינים{fetchedAt ? ` · ${new Date(fetchedAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}` : ""}
            </Text>
          </View>

          {/* Date presets */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {DATE_PRESETS.map((d) => {
              const on = datePreset === d.key;
              return (
                <Pressable
                  key={d.key}
                  onPress={() => onDateChange(d.key)}
                  style={[styles.dateChip, { backgroundColor: on ? "#4F6EF7" : colors.inputBg, borderColor: on ? "#4F6EF7" : colors.cardBorder }]}
                >
                  <Text style={[styles.dateChipText, { color: on ? "#FFF" : colors.textMuted }]}>{d.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Status filters */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipRow, { paddingBottom: 12 }]}>
            {STATUS_FILTERS.map((f) => {
              const on = statusFilter === f.key;
              const count = counts[f.key] || 0;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setStatusFilter(f.key)}
                  style={[styles.statusChip, { backgroundColor: on ? "rgba(79,110,247,0.12)" : "transparent", borderColor: on ? "#4F6EF7" : colors.cardBorder }]}
                >
                  <Text style={[styles.statusChipText, { color: on ? "#4F6EF7" : colors.textMuted }]}>{f.label}</Text>
                  {count > 0 && (
                    <View style={[styles.chipBadge, { backgroundColor: on ? "#4F6EF7" : colors.pillBg }]}>
                      <Text style={[styles.chipBadgeText, { color: on ? "#FFF" : colors.textMuted }]}>{count}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {!business?.selected_ad_account_id && connected ? (
          <Pressable
            style={[styles.warnBanner, { backgroundColor: "rgba(234,179,8,0.08)", borderColor: "rgba(234,179,8,0.25)" }]}
            onPress={() => router.push("/(tabs)/settings" as any)}
          >
            <Text style={styles.warnText}>לא נבחר חשבון פרסום — עבור להגדרות לבחור</Text>
            <Text style={styles.warnArrow}>←</Text>
          </Pressable>
        ) : null}

        {/* Summary bar */}
        {filtered.length > 0 && (
          <View style={[styles.summaryBar, { borderBottomColor: colors.separator, paddingHorizontal: isDesktop ? "5%" : 16 }]}>
            {[
              { label: "הוצאה", value: formatIls(totals.spend), delta: totals.delta_spend, invert: true },
              { label: "חשיפות", value: formatNum(totals.impressions), delta: totals.delta_impressions },
              { label: "קליקים", value: formatNum(totals.clicks), delta: totals.delta_clicks },
              { label: "לידים", value: formatNum(totals.leads), delta: totals.delta_leads, blue: true },
              { label: "עלות לליד", value: totals.leads > 0 ? formatIls(totals.cpl) : "—", delta: null, blue: true },
            ].map((item, idx) => {
              const dv = typeof item.delta === "number" ? item.delta : null;
              const isPositiveGood = !item.invert;
              const dc = dv === null ? null : dv > 0 ? (isPositiveGood ? "#22C55E" : "#EF4444") : dv < 0 ? (isPositiveGood ? "#EF4444" : "#22C55E") : colors.textMuted;
              return (
                <React.Fragment key={item.label}>
                  {idx > 0 && <View style={[styles.summaryDivider, { backgroundColor: colors.separator }]} />}
                  <View style={styles.summaryItem}>
                    <Text style={[styles.summaryValue, { color: item.blue ? "#4F6EF7" : colors.text }]}>{item.value}</Text>
                    {dv !== null && dc ? (
                      <Text style={[styles.summaryDelta, { color: dc }]}>
                        {dv > 0 ? "▲" : dv < 0 ? "▼" : "–"} {Math.abs(dv)}%
                      </Text>
                    ) : null}
                    <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>{item.label}</Text>
                  </View>
                </React.Fragment>
              );
            })}
          </View>
        )}

        {/* Campaign list */}
        <ScrollView
          contentContainerStyle={[styles.listContent, { paddingBottom: tabBarHeight + 80, paddingHorizontal: isDesktop ? "5%" : 14 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#5B8CFF" />}
        >
          {error ? (
            <View style={[styles.errorCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable style={styles.retryBtn} onPress={() => void loadCampaigns(true)}>
                <Text style={styles.retryBtnText}>נסה שוב</Text>
              </Pressable>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={{ fontSize: 40 }}>📭</Text>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {statusFilter === "ALL" ? "עדיין אין קמפיינים" : `אין קמפיינים ${STATUS_FILTERS.find((f) => f.key === statusFilter)?.label || ""}`}
              </Text>
              {statusFilter === "ALL" && (
                <>
                  <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                    רוצה שדנה תעזור לך ליצור את הראשון?
                  </Text>
                  <Pressable
                    style={styles.connectBtn}
                    onPress={() => router.push({ pathname: "/(tabs)/chat", params: { seedMessage: "אני רוצה ליצור קמפיין חדש" } })}
                  >
                    <Text style={styles.connectBtnText}>בואו נתחיל</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : (
            filtered.map((c) => {
              const isActive = (c.status || "").toUpperCase() === "ACTIVE";
              const isSpending = isActive && (c.spent_last_24h || 0) > 0;
              const isActiveNoSpend = isActive && !isSpending;
              const sc = statusColor(c.status, c.spent_last_24h || 0);
              return (
                <Pressable
                  key={c.id}
                  style={({ pressed }) => [styles.card, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }, pressed && { opacity: 0.9 }]}
                  onPress={() => router.push(`/campaign/${c.id}` as any)}
                >
                  {/* Name + Status */}
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={[styles.campaignName, { color: colors.text }]} numberOfLines={1}>{c.name}</Text>
                      {c.objective ? (
                        <Text style={[styles.objective, { color: colors.textMuted }]}>
                          {objectiveLabel(c.objective)}{c.daily_budget > 0 ? ` · תקציב ${formatIls(c.daily_budget)}/יום` : ""}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                      <View style={[styles.statusDot, { backgroundColor: sc.dot }]} />
                      <Text style={[styles.statusText, { color: sc.text }]}>{statusLabel(c.status)}</Text>
                    </View>
                  </View>
                  {isActiveNoSpend ? (
                    <View style={styles.noSpendBadge}>
                      <Text style={styles.noSpendText}>פעיל ללא הוצאה ב-24 שעות</Text>
                    </View>
                  ) : null}

                  {/* Metrics */}
                  <View style={styles.metricsRow}>
                    {[
                      { label: "הוצאה", value: formatIls(c.spend), delta: c.delta_spend, invertColor: true },
                      { label: "חשיפות", value: formatNum(c.impressions), delta: c.delta_impressions },
                      { label: "קליקים", value: formatNum(c.clicks), delta: c.delta_clicks },
                      { label: "לידים", value: formatNum(c.leads), delta: c.delta_leads, highlight: true },
                      { label: "עלות לליד", value: c.leads > 0 ? formatIls(c.cpl) : "—", delta: c.delta_cpl, highlight: true, invertColor: true },
                    ].map((m: any) => {
                      const deltaVal = typeof m.delta === "number" ? m.delta : null;
                      // For spend/cpl: increase is bad (red), decrease is good (green)
                      // For clicks/impressions/leads: increase is good (green)
                      const isPositiveGood = !m.invertColor;
                      const deltaColor = deltaVal === null ? null
                        : deltaVal > 0 ? (isPositiveGood ? "#22C55E" : "#EF4444")
                        : deltaVal < 0 ? (isPositiveGood ? "#EF4444" : "#22C55E")
                        : colors.textMuted;
                      return (
                        <View key={m.label} style={[styles.metricBox, { backgroundColor: m.highlight ? "rgba(79,110,247,0.06)" : colors.bg, borderColor: m.highlight ? "rgba(79,110,247,0.2)" : colors.separator }]}>
                          <Text style={[styles.metricValue, { color: m.highlight ? "#4F6EF7" : colors.text }]}>{m.value}</Text>
                          {deltaVal !== null && deltaColor ? (
                            <View style={styles.deltaRow}>
                              <Text style={[styles.deltaText, { color: deltaColor }]}>
                                {deltaVal > 0 ? "▲" : deltaVal < 0 ? "▼" : "–"} {Math.abs(deltaVal)}%
                              </Text>
                            </View>
                          ) : null}
                          <Text style={[styles.metricLabel, { color: colors.textMuted }]}>{m.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  hint: { fontSize: 14, writingDirection: "rtl" },
  header: { paddingTop: 14 },
  headerTop: {
    flexDirection: "row-reverse",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  headerTitle: { fontSize: 20, fontWeight: "800", writingDirection: "rtl", textAlign: "right" },
  headerMeta: { fontSize: 12, fontWeight: "600", writingDirection: "rtl" },
  chipRow: { flexDirection: "row-reverse", gap: 6, paddingBottom: 8 },
  dateChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  dateChipText: { fontSize: 13, fontWeight: "700", writingDirection: "rtl" },
  statusChip: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
  },
  statusChipText: { fontSize: 12, fontWeight: "700", writingDirection: "rtl" },
  chipBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  chipBadgeText: { fontSize: 10, fontWeight: "800" },
  summaryBar: {
    flexDirection: "row-reverse",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 0,
  },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryValue: { fontSize: 16, fontWeight: "800" },
  summaryDelta: { fontSize: 10, fontWeight: "800", marginTop: 1 },
  summaryLabel: { fontSize: 10, fontWeight: "600", marginTop: 2, writingDirection: "rtl" },
  summaryDivider: { width: 1, height: 28 },
  listContent: { paddingTop: 14, gap: 12 },
  card: { borderRadius: 16, padding: 16, borderWidth: 1 },
  cardTop: { flexDirection: "row-reverse", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  campaignName: { fontSize: 15, fontWeight: "800", writingDirection: "rtl", textAlign: "right" },
  objective: { fontSize: 12, fontWeight: "600", writingDirection: "rtl", textAlign: "right" },
  statusPill: { flexDirection: "row-reverse", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  warnBanner: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  warnText: {
    color: "#EAB308",
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
    flex: 1,
  },
  warnArrow: {
    color: "#EAB308",
    fontSize: 16,
    fontWeight: "700",
    marginStart: 8,
  },
  noSpendBadge: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(234,179,8,0.1)",
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginTop: 6,
    alignSelf: "flex-end",
  },
  noSpendText: {
    color: "#EAB308",
    fontSize: 11,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  statusText: { fontSize: 12, fontWeight: "800", writingDirection: "rtl" },
  metricsRow: { marginTop: 14, flexDirection: "row-reverse", gap: 8 },
  metricBox: { flex: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 6, borderWidth: 1, alignItems: "center" },
  metricValue: { fontSize: 14, fontWeight: "800" },
  deltaRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 2 },
  deltaText: { fontSize: 10, fontWeight: "800" },
  metricLabel: { fontSize: 10, fontWeight: "600", marginTop: 2, writingDirection: "rtl" },
  errorCard: { borderRadius: 14, padding: 20, borderWidth: 1, alignItems: "center", gap: 10 },
  errorText: { color: "#FCA5A5", fontSize: 14, writingDirection: "rtl", textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: "#2F6BFF" },
  retryBtnText: { color: "#FFF", fontWeight: "800", fontSize: 14 },
  emptyState: { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "800", writingDirection: "rtl" },
  emptyBody: { fontSize: 13, fontWeight: "600", writingDirection: "rtl", textAlign: "center", lineHeight: 20 },
  connectBtn: { marginTop: 12, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: "#4F6EF7" },
  connectBtnText: { color: "#FFF", fontSize: 14, fontWeight: "800" },
});
