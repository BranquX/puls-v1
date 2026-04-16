import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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

type Campaign = {
  id: string;
  name: string;
  status: string;
  spend: number;
  clicks: number;
  impressions: number;
  leads: number;
  cpc: number;
  ctr: number;
  cpl: number;
  delta_spend: number | null;
  delta_clicks: number | null;
  delta_leads: number | null;
};

type DatePreset = "last_7d" | "last_14d" | "last_30d";

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "last_7d", label: "7 ימים" },
  { key: "last_14d", label: "14 ימים" },
  { key: "last_30d", label: "30 יום" },
];

type Recommendation = {
  id: string;
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
  impact: string;
  category: "creative" | "budget" | "audience" | "campaign" | "content";
  action_prompt: string | null;
  action_label: string | null;
  auto_executable: boolean;
  campaign_id: string | null;
  campaign_name: string | null;
};

type RonAnalysis = {
  summary: string | null;
  score: number;
  recommendations: Recommendation[];
  fetched_at: string | null;
};

// Keep old Insight type for backwards compat with insights endpoint
type Insight = {
  icon: string;
  title: string;
  body: string;
  severity: "critical" | "warning" | "good" | "tip";
  action_type: "pause_campaign" | "increase_budget" | "decrease_budget" | "refresh_creative" | "expand_audience" | "chat_with_ron" | null;
  action_label: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  suggested_value: number | null;
};

const SEVERITY_COLORS: Record<string, { dot: string; bg: string; border: string }> = {
  high: { dot: "#EF4444", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.25)" },
  medium: { dot: "#EAB308", bg: "rgba(234,179,8,0.08)", border: "rgba(234,179,8,0.25)" },
  low: { dot: "#22C55E", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.25)" },
};

const SEVERITY_STYLES: Record<string, { bg: string; border: string }> = {
  critical: { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.25)" },
  warning: { bg: "rgba(234,179,8,0.08)", border: "rgba(234,179,8,0.25)" },
  good: { bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.25)" },
  tip: { bg: "rgba(79,110,247,0.08)", border: "rgba(79,110,247,0.25)" },
};

function ScoreCircle({ score, size = 80 }: { score: number; size?: number }) {
  const color = score >= 70 ? "#22C55E" : score >= 40 ? "#EAB308" : "#EF4444";

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* Background circle via View border */}
      <View
        style={{
          position: "absolute",
          width: size - 8,
          height: size - 8,
          borderRadius: (size - 8) / 2,
          borderWidth: 6,
          borderColor: "rgba(148,163,184,0.15)",
        }}
      />
      {/* Progress arc — approximate with a colored border + rotation trick */}
      <View
        style={{
          position: "absolute",
          width: size - 8,
          height: size - 8,
          borderRadius: (size - 8) / 2,
          borderWidth: 6,
          borderColor: color,
          borderTopColor: score >= 25 ? color : "transparent",
          borderRightColor: score >= 50 ? color : "transparent",
          borderBottomColor: score >= 75 ? color : "transparent",
          borderLeftColor: score >= 100 ? color : "transparent",
          transform: [{ rotate: "-90deg" }],
        }}
      />
      <Text style={{ fontSize: size * 0.28, fontWeight: "900", color }}>{score}</Text>
    </View>
  );
}

function formatIls(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—";
  return `₪${n.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
function formatNum(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  return n.toLocaleString("he-IL");
}
function formatPct(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0%";
  // Meta returns CTR already as percentage (e.g. 1.5 = 1.5%)
  return `${n.toFixed(2)}%`;
}

function SpendBar({ series, maxSpend, colors }: { series: { date: string; spend: number }[]; maxSpend: number; colors: any }) {
  const h = 100;
  return (
    <View style={styles.chartRow}>
      {series.map((d) => {
        const ratio = maxSpend > 0 ? d.spend / maxSpend : 0;
        const barH = Math.max(4, Math.round(ratio * h));
        return (
          <View key={d.date} style={styles.chartBarWrap}>
            <View style={[styles.chartBarTrack, { backgroundColor: colors.inputBg, height: h }]}>
              <View style={[styles.chartBarFill, { height: barH }]} />
            </View>
            <Text style={[styles.chartDayLabel, { color: colors.textMuted }]} numberOfLines={1}>
              {d.date.slice(5)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function CtrIndicator({ ctr }: { ctr: number }) {
  const v = ctr * 100;
  const color = v >= 1.0 ? "#22C55E" : v >= 0.5 ? "#EAB308" : "#EF4444";
  return <View style={[styles.ctrDot, { backgroundColor: color }]} />;
}

export default function AnalyticsScreen() {
  const router = useRouter();
  const { business, loading: businessLoading } = useBusiness();
  const { isDesktop } = useResponsiveLayout();
  const rawTabBarHeight = useBottomTabBarHeight();
  const tabBarHeight = isDesktop ? 0 : rawTabBarHeight;
  const { colors } = useTheme();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connected, setConnected] = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>("last_7d");
  const [spendSeries, setSpendSeries] = useState<{ date: string; spend: number }[]>([]);

  const [ronAnalysis, setRonAnalysis] = useState<RonAnalysis>({ summary: null, score: 0, recommendations: [], fetched_at: null });
  const [ronLoading, setRonLoading] = useState(false);
  const [completedRecs, setCompletedRecs] = useState<Set<string>>(new Set());

  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsBusy, setInsightsBusy] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<"spend" | "clicks" | "ctr">("spend");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (businessLoading && !business) return;
    if (!business) router.replace("/onboarding");
  }, [businessLoading, business, router]);

  const loadData = useCallback(async (preset?: DatePreset, force = false) => {
    const p = preset || datePreset;
    if (!business?.id) return;
    setError(null);
    try {
      const url = `${API_BASE}/api/meta-campaigns?business_id=${encodeURIComponent(business.id)}&preset=${p}${force ? "&force=1" : ""}`;
      const res = await fetchAdchatApi(url);
      if (res.status === 401) { router.replace("/auth"); return; }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || "משהו השתבש. נסה שוב."); return; }
      setConnected(json.connected !== false);
      setCampaigns(Array.isArray(json.campaigns) ? json.campaigns : []);
    } catch { setError("אין חיבור לאינטרנט. בדוק את החיבור ונסה שוב."); }
    // Also fetch spend series from meta-context
    try {
      const ctxRes = await fetchAdchatApi(`${API_BASE}/api/meta-context?business_id=${encodeURIComponent(business.id)}`);
      const ctxJson = await ctxRes.json().catch(() => ({}));
      if (ctxRes.ok && Array.isArray(ctxJson.spend_last_7_days)) {
        setSpendSeries(ctxJson.spend_last_7_days.map((d: any) => ({ date: d.date_start, spend: d.spend })));
      }
    } catch { /* */ }
  }, [business?.id, datePreset, router]);

  useEffect(() => {
    if (businessLoading || !business?.id) { setLoading(false); return; }
    let c = false;
    (async () => { setLoading(true); await loadData(); if (!c) setLoading(false); })();
    return () => { c = true; };
  }, [loadData, businessLoading, business?.id]);

  // Load cached Ron analysis + completed recs
  useEffect(() => {
    if (!business?.id) return;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(`ron-analysis:${business.id}`);
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached.summary || cached.recommendations) {
            setRonAnalysis({
              summary: cached.summary || null,
              score: cached.score || 0,
              recommendations: Array.isArray(cached.recommendations) ? cached.recommendations : [],
              fetched_at: cached.fetched_at || null,
            });
          }
        }
        const doneRaw = await AsyncStorage.getItem(`ron-completed:${business.id}`);
        if (doneRaw) {
          const arr = JSON.parse(doneRaw);
          if (Array.isArray(arr)) setCompletedRecs(new Set(arr));
        }
      } catch { /* */ }
    })();
  }, [business?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData(undefined, true);
    setRefreshing(false);
  }, [loadData]);

  const onDateChange = useCallback((p: DatePreset) => {
    setDatePreset(p);
    setLoading(true);
    void (async () => { await loadData(p); setLoading(false); })();
  }, [loadData]);

  const fetchRonAnalysis = useCallback(async (force = false) => {
    if (!business?.id) return;
    setRonLoading(true);
    try {
      const res = await fetchAdchatApi(`${API_BASE}/api/ron-analysis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ business_id: business.id, force }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && (json.summary || json.recommendations)) {
        const analysis: RonAnalysis = {
          summary: json.summary || null,
          score: json.score || 0,
          recommendations: Array.isArray(json.recommendations) ? json.recommendations : [],
          fetched_at: json.fetched_at || null,
        };
        setRonAnalysis(analysis);
        if (force) { setCompletedRecs(new Set()); void AsyncStorage.removeItem(`ron-completed:${business.id}`); }
        void AsyncStorage.setItem(`ron-analysis:${business.id}`, JSON.stringify(json));
      }
    } catch { /* */ }
    setRonLoading(false);
  }, [business?.id]);

  const toggleRecCompleted = useCallback((recId: string) => {
    setCompletedRecs((prev) => {
      const next = new Set(prev);
      if (next.has(recId)) next.delete(recId); else next.add(recId);
      if (business?.id) void AsyncStorage.setItem(`ron-completed:${business.id}`, JSON.stringify([...next]));
      return next;
    });
  }, [business?.id]);

  const fetchInsights = useCallback(async (force = false) => {
    if (!business?.id) return;
    setInsightsLoading(true);
    try {
      const res = await fetchAdchatApi(`${API_BASE}/api/ron-insights`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ business_id: business.id, force }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(json.insights)) {
        setInsights(json.insights);
        void AsyncStorage.setItem(`ron-insights:${business.id}`, JSON.stringify(json));
      }
    } catch { /* */ }
    setInsightsLoading(false);
  }, [business?.id]);

  // Load cached insights on mount
  useEffect(() => {
    if (!business?.id) return;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(`ron-insights:${business.id}`);
        if (raw) {
          const cached = JSON.parse(raw);
          if (Array.isArray(cached.insights)) setInsights(cached.insights);
        }
      } catch { /* */ }
    })();
  }, [business?.id]);

  // Auto-fetch insights on first load if empty
  useEffect(() => {
    if (!loading && connected && campaigns.length > 0 && insights.length === 0 && !insightsLoading) {
      void fetchInsights();
    }
  }, [loading, connected, campaigns.length, insights.length, insightsLoading, fetchInsights]);

  const executeAction = useCallback(async (insight: Insight) => {
    if (!business?.id || !insight.action_type) return;

    if (insight.action_type === "chat_with_ron") {
      const seed = insight.campaign_name
        ? `נתח לי את הקמפיין "${insight.campaign_name}" ותן המלצות ספציפיות`
        : "נתח לי את כל הקמפיינים ותגיד מה לשפר";
      router.push({ pathname: "/(tabs)/chat", params: { seedMessage: seed } });
      return;
    }

    if (!insight.campaign_id) return;
    setInsightsBusy(insight.campaign_id);

    try {
      if (insight.action_type === "pause_campaign") {
        await fetchAdchatApi(`${API_BASE}/api/meta-campaign/${insight.campaign_id}/pause`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ business_id: business.id }),
        });
      } else if (insight.action_type === "increase_budget") {
        // Navigate to campaign detail for budget change
        router.push(`/campaign/${insight.campaign_id}` as any);
        setInsightsBusy(null);
        return;
      } else if (insight.action_type === "decrease_budget") {
        router.push(`/campaign/${insight.campaign_id}` as any);
        setInsightsBusy(null);
        return;
      } else if (insight.action_type === "refresh_creative" || insight.action_type === "expand_audience") {
        const seed = `אני רוצה ${insight.action_type === "refresh_creative" ? "לרענן קריאייטיבים" : "להרחיב קהל"} בקמפיין "${insight.campaign_name}"`;
        router.push({ pathname: "/(tabs)/chat", params: { seedMessage: seed } });
        setInsightsBusy(null);
        return;
      }

      // After action, remove the insight from the list
      setInsights((prev) => prev.filter((i) => i !== insight));
      // Refresh data
      void loadData(undefined, true);
    } catch { /* */ }
    setInsightsBusy(null);
  }, [business?.id, router, loadData]);

  // Computed totals
  const totals = useMemo(() => {
    let spend = 0, clicks = 0, impressions = 0, leads = 0;
    for (const c of campaigns) {
      spend += c.spend || 0;
      clicks += c.clicks || 0;
      impressions += c.impressions || 0;
      leads += c.leads || 0;
    }
    const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE");
    const avgCtr = activeCampaigns.length > 0 ? activeCampaigns.reduce((s, c) => s + (c.ctr || 0), 0) / activeCampaigns.length : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const cpl = leads > 0 ? spend / leads : 0;
    return { spend, clicks, impressions, leads, avgCtr, cpc, cpm, cpl };
  }, [campaigns]);

  const sorted = useMemo(() => {
    return [...campaigns].filter((c) => c.spend > 0 || c.clicks > 0).sort((a, b) => {
      if (sortKey === "spend") return (b.spend || 0) - (a.spend || 0);
      if (sortKey === "clicks") return (b.clicks || 0) - (a.clicks || 0);
      return (b.ctr || 0) - (a.ctr || 0);
    });
  }, [campaigns, sortKey]);

  const maxSpend = useMemo(() => Math.max(1, ...spendSeries.map((d) => d.spend)), [spendSeries]);

  const completedCount = ronAnalysis.recommendations.filter((r) => completedRecs.has(r.id)).length;
  const totalRecs = ronAnalysis.recommendations.length;

  // Sort recs: uncompleted first, then completed
  const sortedRecs = useMemo(() => {
    return [...ronAnalysis.recommendations].sort((a, b) => {
      const aDone = completedRecs.has(a.id) ? 1 : 0;
      const bDone = completedRecs.has(b.id) ? 1 : 0;
      return aDone - bDone;
    });
  }, [ronAnalysis.recommendations, completedRecs]);

  if (loading || businessLoading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={colors.statusBar as any} />
        <View style={[styles.header, { borderBottomColor: colors.separator, paddingHorizontal: isDesktop ? "5%" : 16 }]}>
          <Shimmer width={140} height={20} style={{ alignSelf: "flex-end" }} />
        </View>
        <View style={{ padding: 14, gap: 16, paddingHorizontal: isDesktop ? "5%" : 14 }}>
          <View style={{ flexDirection: "row-reverse", gap: 8 }}>
            {[0, 1, 2].map((i) => <Shimmer key={i} width={70} height={32} borderRadius={16} />)}
          </View>
          <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 10 }}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <View key={i} style={[styles.statCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
                <Shimmer width={24} height={24} borderRadius={12} />
                <Shimmer width={50} height={18} />
                <Shimmer width={40} height={10} />
              </View>
            ))}
          </View>
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.cardBg, padding: 16 }}>
            <Shimmer width={100} height={14} style={{ marginBottom: 12 }} />
            <View style={{ flexDirection: "row-reverse", alignItems: "flex-end", justifyContent: "space-between", gap: 4 }}>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <Shimmer key={i} width={18} height={30 + (i % 3) * 25} borderRadius={4} />
              ))}
            </View>
          </View>
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
          <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>חבר את חשבון הפייסבוק בהגדרות.</Text>
          <Pressable style={styles.connectBtn} onPress={() => router.push("/(tabs)/settings")}>
            <Text style={styles.connectBtnText}>פתח הגדרות</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const statsSection = (
    <>
      {/* Date toggle */}
      <View style={styles.dateRow}>
        {DATE_PRESETS.map((d) => {
          const on = datePreset === d.key;
          return (
            <Pressable key={d.key} onPress={() => onDateChange(d.key)}
              style={[styles.dateChip, { backgroundColor: on ? "#4F6EF7" : colors.inputBg, borderColor: on ? "#4F6EF7" : colors.cardBorder }]}>
              <Text style={[styles.dateChipText, { color: on ? "#FFF" : colors.textMuted }]}>{d.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Stat cards */}
      <View style={styles.statsGrid}>
        {[
          { label: "הוצאה", value: formatIls(totals.spend), emoji: "💰" },
          { label: "לידים", value: formatNum(totals.leads), emoji: "🎯" },
          { label: "קליקים", value: formatNum(totals.clicks), emoji: "👆" },
          { label: "חשיפות", value: formatNum(totals.impressions), emoji: "👁" },
          { label: "עלות לליד", value: formatIls(totals.cpl), emoji: "💵" },
          { label: "CTR ממוצע", value: formatPct(totals.avgCtr), emoji: "📈" },
          { label: "CPC ממוצע", value: formatIls(totals.cpc), emoji: "🖱" },
          { label: "CPM", value: formatIls(totals.cpm), emoji: "📊" },
        ].map((s) => (
          <View key={s.label} style={[styles.statCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
            <Text style={styles.statEmoji}>{s.emoji}</Text>
            <Text style={[styles.statValue, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{s.value}</Text>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Spend chart */}
      {spendSeries.length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>הוצאה יומית</Text>
          <SpendBar series={spendSeries} maxSpend={maxSpend} colors={colors} />
        </View>
      )}

      {/* Campaign breakdown */}
      <View style={[styles.section, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>פירוט קמפיינים</Text>
          <View style={styles.sortRow}>
            {(["spend", "clicks", "ctr"] as const).map((k) => {
              const on = sortKey === k;
              const label = k === "spend" ? "הוצאה" : k === "clicks" ? "קליקים" : "CTR";
              return (
                <Pressable key={k} onPress={() => setSortKey(k)}
                  style={[styles.sortChip, on && { backgroundColor: "rgba(79,110,247,0.12)" }]}>
                  <Text style={[styles.sortText, { color: on ? "#4F6EF7" : colors.textMuted }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {sorted.length === 0 ? (
          <Text style={[styles.emptyBody, { color: colors.textMuted, textAlign: "center", paddingVertical: 20 }]}>אין נתונים לתקופה זו</Text>
        ) : (
          sorted.map((c) => (
            <Pressable key={c.id} onPress={() => router.push(`/campaign/${c.id}` as any)}
              style={[styles.tableRow, { borderBottomColor: colors.separator }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.tableNameRow}>
                  <CtrIndicator ctr={c.ctr} />
                  <Text style={[styles.tableName, { color: colors.text }]} numberOfLines={1}>{c.name}</Text>
                </View>
                <Text style={[styles.tableMeta, { color: colors.textMuted }]}>
                  {formatIls(c.spend)} · {formatNum(c.clicks)} קליקים · CTR {formatPct(c.ctr)}{c.leads > 0 ? ` · ${c.leads} לידים` : ""}
                </Text>
              </View>
              <Text style={[styles.tableChevron, { color: colors.textMuted }]}>◂</Text>
            </Pressable>
          ))
        )}
      </View>
    </>
  );

  const ronSection = (
    <View style={{ gap: 16 }}>
      {/* Score + Summary card */}
      <View style={[styles.ronCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
        <View style={styles.ronHeader}>
          <Text style={[styles.ronTitle, { color: colors.text }]}>בריאות קמפיינים</Text>
          <Pressable onPress={() => void fetchRonAnalysis(true)} hitSlop={12}>
            <Text style={[styles.refreshLink, { color: "#4F6EF7" }]}>{ronLoading ? "מנתח…" : "רענן"}</Text>
          </Pressable>
        </View>

        {ronLoading && !ronAnalysis.summary ? (
          <View style={{ alignItems: "center", paddingVertical: 24 }}>
            <ActivityIndicator color="#5B8CFF" />
            <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>רון מנתח את הקמפיינים…</Text>
          </View>
        ) : ronAnalysis.summary ? (
          <View style={styles.scoreSection}>
            <ScoreCircle score={ronAnalysis.score} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[styles.scoreSummary, { color: colors.text }]}>{ronAnalysis.summary}</Text>
              {ronAnalysis.fetched_at ? (
                <Text style={[styles.ronTime, { color: colors.textMuted }]}>
                  {new Date(ronAnalysis.fetched_at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={{ alignItems: "center", paddingVertical: 20 }}>
            <Text style={[styles.ronEmpty, { color: colors.textMuted }]}>לחץ לקבלת ניתוח מרון</Text>
            <Pressable
              onPress={() => void fetchRonAnalysis(true)}
              style={({ pressed }) => [styles.ronBtn, { marginTop: 12 }, pressed && { opacity: 0.85 }]}
              disabled={ronLoading}
            >
              {ronLoading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.ronBtnText}>קבל ניתוח</Text>
              )}
            </Pressable>
          </View>
        )}
      </View>

      {/* Recommendations */}
      {totalRecs > 0 ? (
        <View style={[styles.ronCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
          <View style={styles.ronHeader}>
            <Text style={[styles.ronTitle, { color: colors.text }]}>המלצות</Text>
            <Text style={[styles.recProgress, { color: colors.textMuted }]}>
              {completedCount} מתוך {totalRecs} בוצעו
            </Text>
          </View>

          {/* Progress bar */}
          <View style={[styles.progressTrack, { backgroundColor: colors.inputBg }]}>
            <View
              style={[
                styles.progressFill,
                { width: totalRecs > 0 ? `${Math.round((completedCount / totalRecs) * 100)}%` as any : 0 },
              ]}
            />
          </View>

          <View style={{ gap: 10, marginTop: 12 }}>
            {sortedRecs.map((rec) => {
              const done = completedRecs.has(rec.id);
              const sev = SEVERITY_COLORS[rec.severity] || SEVERITY_COLORS.medium;
              return (
                <View
                  key={rec.id}
                  style={[
                    styles.recCard,
                    {
                      backgroundColor: done ? "transparent" : sev.bg,
                      borderColor: done ? colors.cardBorder : sev.border,
                      opacity: done ? 0.6 : 1,
                    },
                  ]}
                >
                  <View style={styles.recTop}>
                    {/* Checkbox */}
                    <Pressable onPress={() => toggleRecCompleted(rec.id)} style={styles.recCheckbox} hitSlop={8}>
                      <View
                        style={[
                          styles.recCheckboxInner,
                          {
                            backgroundColor: done ? "#22C55E" : "transparent",
                            borderColor: done ? "#22C55E" : colors.textMuted,
                          },
                        ]}
                      >
                        {done ? <Text style={styles.recCheckmark}>✓</Text> : null}
                      </View>
                    </Pressable>

                    {/* Severity dot */}
                    <View style={[styles.recSevDot, { backgroundColor: sev.dot }]} />

                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={styles.recTitleRow}>
                        <Text
                          style={[
                            styles.recTitle,
                            { color: colors.text },
                            done && { textDecorationLine: "line-through" },
                          ]}
                          numberOfLines={1}
                        >
                          {rec.title}
                        </Text>
                        <View style={[styles.impactBadge, { backgroundColor: sev.bg, borderColor: sev.border }]}>
                          <Text style={[styles.impactText, { color: sev.dot }]}>{rec.impact}</Text>
                        </View>
                      </View>
                      <Text
                        style={[styles.recDesc, { color: colors.textSecondary }]}
                        numberOfLines={2}
                      >
                        {rec.description}
                      </Text>
                    </View>
                  </View>

                  {/* Action button */}
                  {!done && rec.action_label && rec.action_prompt ? (
                    <Pressable
                      onPress={() => {
                        router.push({
                          pathname: "/(tabs)/chat",
                          params: { seedMessage: rec.action_prompt! },
                        });
                      }}
                      style={({ pressed }) => [
                        styles.recActionBtn,
                        {
                          backgroundColor: rec.severity === "high" ? "#DC2626" : "#4F6EF7",
                        },
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={styles.recActionText}>{rec.action_label}</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Legacy insights (from /api/ron-insights) */}
      {insights.length > 0 ? (
        <View style={[styles.ronCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
          <View style={styles.ronHeader}>
            <Text style={[styles.ronTitle, { color: colors.text }]}>תובנות נוספות</Text>
            <Pressable onPress={() => void fetchInsights(true)} hitSlop={12}>
              <Text style={[styles.refreshLink, { color: "#4F6EF7" }]}>{insightsLoading ? "טוען…" : "רענן"}</Text>
            </Pressable>
          </View>
          <View style={{ gap: 10 }}>
            {insights.map((insight, idx) => {
              const sev = SEVERITY_STYLES[insight.severity] || SEVERITY_STYLES.tip;
              const busy = insightsBusy != null && insightsBusy === insight.campaign_id;
              return (
                <View key={idx} style={[styles.insightCard, { backgroundColor: sev.bg, borderColor: sev.border }]}>
                  <View style={styles.insightTop}>
                    <Text style={styles.insightIcon}>{insight.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.insightTitle, { color: colors.text }]}>{insight.title}</Text>
                      <Text style={[styles.insightBody, { color: colors.textSecondary }]}>{insight.body}</Text>
                    </View>
                  </View>
                  {insight.action_label && insight.action_type ? (
                    <Pressable
                      onPress={() => void executeAction(insight)}
                      disabled={busy}
                      style={({ pressed }) => [
                        styles.insightBtn,
                        insight.severity === "critical" ? { backgroundColor: "#DC2626" }
                          : insight.severity === "good" ? { backgroundColor: "#22C55E" }
                          : { backgroundColor: "#4F6EF7" },
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      {busy ? (
                        <ActivityIndicator color="#FFF" size="small" />
                      ) : (
                        <Text style={styles.insightBtnText}>{insight.action_label}</Text>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={colors.statusBar as any} />
      <View style={{ flex: 1 }}>
        <View style={[styles.header, { borderBottomColor: colors.separator, paddingHorizontal: isDesktop ? "5%" : 16 }]}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>ניתוח ביצועים</Text>
        </View>

        {!business?.selected_ad_account_id && business?.meta_user_id ? (
          <Pressable
            style={styles.warnBanner}
            onPress={() => router.push("/(tabs)/settings" as any)}
          >
            <Text style={styles.warnText}>לא נבחר חשבון פרסום — עבור להגדרות לבחור</Text>
            <Text style={styles.warnArrow}>←</Text>
          </Pressable>
        ) : null}

        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: tabBarHeight + 60, paddingHorizontal: isDesktop ? "5%" : 14 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#5B8CFF" />}
        >
          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable style={styles.connectBtn} onPress={() => void loadData(undefined, true)}>
                <Text style={styles.connectBtnText}>נסה שוב</Text>
              </Pressable>
            </View>
          ) : isDesktop ? (
            <View style={styles.desktopLayout}>
              <View style={styles.desktopLeft}>{statsSection}</View>
              <View style={styles.desktopRight}>{ronSection}</View>
            </View>
          ) : (
            <>
              {statsSection}
              {ronSection}
            </>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  warnBanner: {
    flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, paddingHorizontal: 16, marginHorizontal: 14, marginTop: 8,
    borderRadius: 10, borderWidth: 1, backgroundColor: "rgba(234,179,8,0.08)", borderColor: "rgba(234,179,8,0.25)",
  },
  warnText: { color: "#EAB308", fontSize: 13, fontWeight: "700", writingDirection: "rtl", flex: 1 },
  warnArrow: { color: "#EAB308", fontSize: 16, fontWeight: "700", marginStart: 8 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  hint: { fontSize: 14, writingDirection: "rtl" },
  header: { paddingTop: 14, paddingBottom: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: "800", writingDirection: "rtl", textAlign: "right" },
  scrollContent: { paddingTop: 16, gap: 16 },
  dateRow: { flexDirection: "row-reverse", gap: 8, marginBottom: 4 },
  dateChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  dateChipText: { fontSize: 13, fontWeight: "700" },

  statsGrid: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 10 },
  statCard: {
    flexGrow: 1,
    flexBasis: "22%",
    minWidth: 80,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    gap: 4,
  },
  statEmoji: { fontSize: 18 },
  statValue: { fontSize: 18, fontWeight: "800" },
  statLabel: { fontSize: 10, fontWeight: "600", writingDirection: "rtl" },
  delta: { fontSize: 10, fontWeight: "800" },

  section: { borderRadius: 16, borderWidth: 1, padding: 16 },
  sectionHeader: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: "800", writingDirection: "rtl", textAlign: "right", marginBottom: 12 },
  sortRow: { flexDirection: "row-reverse", gap: 4 },
  sortChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  sortText: { fontSize: 11, fontWeight: "700" },

  chartRow: { flexDirection: "row-reverse", alignItems: "flex-end", justifyContent: "space-between", gap: 4, minHeight: 120 },
  chartBarWrap: { flex: 1, alignItems: "center", maxWidth: 40 },
  chartBarTrack: { width: "70%", maxWidth: 24, justifyContent: "flex-end", borderRadius: 6, overflow: "hidden" },
  chartBarFill: { width: "100%", borderRadius: 6, backgroundColor: "rgba(79,110,247,0.7)", minHeight: 4 },
  chartDayLabel: { marginTop: 4, fontSize: 8, textAlign: "center" },

  tableRow: { flexDirection: "row-reverse", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, gap: 10 },
  tableNameRow: { flexDirection: "row-reverse", alignItems: "center", gap: 6 },
  tableName: { fontSize: 13, fontWeight: "700", writingDirection: "rtl", flex: 1 },
  tableMeta: { fontSize: 11, fontWeight: "500", writingDirection: "rtl" },
  tableChevron: { fontSize: 14 },
  ctrDot: { width: 8, height: 8, borderRadius: 4 },

  insightCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  insightTop: { flexDirection: "row-reverse", gap: 10, alignItems: "flex-start" },
  insightIcon: { fontSize: 22, marginTop: 2 },
  insightTitle: { fontSize: 14, fontWeight: "800", writingDirection: "rtl", textAlign: "right" },
  insightBody: { fontSize: 12, fontWeight: "500", lineHeight: 18, writingDirection: "rtl", textAlign: "right", marginTop: 2 },
  insightBtn: { marginTop: 10, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 16 },
  insightBtnText: { color: "#FFF", fontSize: 13, fontWeight: "800" },
  refreshLink: { fontSize: 13, fontWeight: "700" },

  ronCard: { borderRadius: 16, borderWidth: 1, padding: 16 },
  ronHeader: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  ronTitle: { fontSize: 16, fontWeight: "800", writingDirection: "rtl" },
  ronTime: { fontSize: 11, fontWeight: "600", writingDirection: "rtl", textAlign: "right" },
  ronEmpty: { fontSize: 13, fontWeight: "600", writingDirection: "rtl", textAlign: "center", paddingVertical: 8 },
  ronBtn: { height: 44, borderRadius: 12, backgroundColor: "#4F6EF7", alignItems: "center", justifyContent: "center" },
  ronBtnText: { color: "#FFF", fontSize: 14, fontWeight: "800" },

  // Score section
  scoreSection: { flexDirection: "row-reverse", alignItems: "center", gap: 16, paddingBottom: 4 },
  scoreSummary: { fontSize: 14, fontWeight: "600", lineHeight: 22, writingDirection: "rtl", textAlign: "right" },

  // Recommendations
  recProgress: { fontSize: 12, fontWeight: "700", writingDirection: "rtl" },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3, backgroundColor: "#22C55E" },
  recCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  recTop: { flexDirection: "row-reverse", gap: 10, alignItems: "flex-start" },
  recCheckbox: { paddingTop: 2 },
  recCheckboxInner: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  recCheckmark: { color: "#FFF", fontSize: 13, fontWeight: "800", marginTop: -1 },
  recSevDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  recTitleRow: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  recTitle: { fontSize: 14, fontWeight: "800", writingDirection: "rtl", textAlign: "right", flex: 1 },
  impactBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  impactText: { fontSize: 10, fontWeight: "800" },
  recDesc: { fontSize: 12, fontWeight: "500", lineHeight: 18, writingDirection: "rtl", textAlign: "right", marginTop: 2 },
  recActionBtn: { marginTop: 10, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 16 },
  recActionText: { color: "#FFF", fontSize: 13, fontWeight: "800" },

  desktopLayout: { flexDirection: "row-reverse", gap: 24, alignItems: "flex-start" },
  desktopLeft: { flex: 3, gap: 16 },
  desktopRight: { flex: 2, position: "sticky" as any, top: 16 },

  emptyTitle: { fontSize: 16, fontWeight: "800", writingDirection: "rtl" },
  emptyBody: { fontSize: 13, fontWeight: "600", writingDirection: "rtl", textAlign: "center", lineHeight: 20 },
  connectBtn: { marginTop: 12, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: "#4F6EF7" },
  connectBtnText: { color: "#FFF", fontSize: 14, fontWeight: "800" },
  errorCard: { borderRadius: 14, padding: 20, alignItems: "center", gap: 10, backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1, borderColor: "rgba(239,68,68,0.25)" },
  errorText: { color: "#FCA5A5", fontSize: 14, writingDirection: "rtl", textAlign: "center" },
});
