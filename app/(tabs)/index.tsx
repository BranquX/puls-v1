import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBusiness } from "../../contexts/business-context";
import { useTheme } from "../../contexts/theme-context";
import { fetchAdchatApi } from "../../lib/fetch-adchat-api";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { Shimmer } from "../../components/Shimmer";

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

type MetaToday = { spend: number; clicks: number; leads: number };

type SpendDay = { date_start: string; date_stop?: string; spend: number };

type MetaCampaign = {
  id?: string;
  name?: string;
  status?: string;
  daily_budget?: string | number;
  lifetime_budget?: string | number;
  objective?: string;
};

type MetaContextPayload = {
  connected: boolean;
  reason?: string | null;
  today: MetaToday;
  active_campaigns_count: number;
  campaigns: MetaCampaign[];
  spend_last_7_days: SpendDay[];
  graph_error?: string | null;
  token_expiry_warning?: { days_left: number; expires_at: string } | null;
};

type AlertRow = {
  id: string;
  title: string;
  body: string;
  severity: string;
  campaign_id: string;
  context_for_chat: string | null;
  read_at: string | null;
  created_at: string;
};

type AlertsApiPayload = {
  unread_count?: number;
  alerts?: AlertRow[];
};

type DanaReco = { title: string; body: string; action: string; icon: string };
type DanaRecoPayload = { recommendations: DanaReco[] };

type MarketingEvent = { name: string; emoji: string; date: string };

type AgentKey = "dana" | "yoni" | "ron" | "maya" | "noa";

type ChatSession = {
  id: string;
  title: string | null;
  agent: AgentKey | string | null;
  updated_at: string;
  created_at: string;
  messages?: unknown;
};

const AGENTS: Record<AgentKey, { name: string; emoji: string; color: string; avatar: string }> =
  {
    dana: { name: "דנה", emoji: "👩‍💼", color: "#4F6EF7", avatar: "https://i.pravatar.cc/150?img=47" },
    yoni: { name: "יוני", emoji: "✍️", color: "#7C3AED", avatar: "https://i.pravatar.cc/150?img=33" },
    ron: { name: "רון", emoji: "📊", color: "#22C55E", avatar: "https://i.pravatar.cc/150?img=12" },
    maya: { name: "מאיה", emoji: "🎨", color: "#F97316", avatar: "https://i.pravatar.cc/150?img=45" },
    noa: { name: "נועה", emoji: "📱", color: "#EC4899", avatar: "https://i.pravatar.cc/150?img=44" },
  };

function formatHebDate(now: Date): string {
  return now.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function daysUntil(iso: string, now: Date): number {
  const d = new Date(iso + "T12:00:00");
  const diff = d.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function relativeTimeHe(iso: string): string {
  const d = new Date(String(iso || ""));
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.max(0, Math.round(diffMs / 60000));
  if (mins < 2) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דקות`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.round(hours / 24);
  return `לפני ${days} ימים`;
}

function lastMessageExcerpt(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const last = [...messages]
    .reverse()
    .find((m) => m && typeof m === "object" && (m as any).text);
  const t = last ? String((last as any).text || "") : "";
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

function pctChange(today: number, prev: number): number | null {
  if (!Number.isFinite(today) || !Number.isFinite(prev)) return null;
  if (prev <= 0) return null;
  return ((today - prev) / prev) * 100;
}

const MARKETING_EVENTS: MarketingEvent[] = [
  { name: "ראש השנה", emoji: "🍎", date: "2026-09-22" },
  { name: "יום כיפור", emoji: "🕍", date: "2026-10-01" },
  { name: "סוכות", emoji: "🌿", date: "2026-10-06" },
  { name: "חנוכה", emoji: "🕎", date: "2026-12-14" },
  { name: "ט״ו בשבט", emoji: "🌳", date: "2027-02-01" },
  { name: "פורים", emoji: "🎭", date: "2027-03-13" },
  { name: "פסח", emoji: "🫓", date: "2027-04-01" },
  { name: "יום העצמאות", emoji: "🇮🇱", date: "2027-04-23" },
  { name: "ל״ג בעומר", emoji: "🔥", date: "2027-05-19" },
  { name: "שבועות", emoji: "📜", date: "2027-05-22" },
  { name: "יום האהבה", emoji: "❤️", date: "2027-02-14" },
  { name: "יום האם", emoji: "🌸", date: "2027-05-10" },
  { name: "יום האב", emoji: "👨", date: "2027-06-21" },
  { name: "קיץ", emoji: "☀️", date: "2026-06-21" },
  { name: "חזרה לבית ספר", emoji: "🎒", date: "2026-09-01" },
  { name: "יום הרווקים הסיני", emoji: "🛍️", date: "2026-11-11" },
  { name: "בלאק פריידי", emoji: "🖤", date: "2026-11-27" },
  { name: "סייבר מאנדיי", emoji: "💻", date: "2026-11-30" },
  { name: "חורף", emoji: "❄️", date: "2026-12-21" },
];
function formatIls(amount: number): string {
  return `₪ ${amount.toLocaleString("he-IL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatDayLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return iso.slice(5, 10);
  return d.toLocaleDateString("he-IL", { weekday: "short", day: "numeric" });
}

function statusHeuristic(status: string | undefined): "green" | "yellow" | "muted" {
  const u = String(status || "").toUpperCase();
  if (u === "ACTIVE") return "green";
  if (u === "PAUSED" || u === "ARCHIVED" || u === "DELETED") return "yellow";
  return "muted";
}

function formatBudgetMinorUnits(v: string | number | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? parseInt(v, 10) : v;
  if (!Number.isFinite(n)) return "—";
  return formatIls(n / 100);
}

function DashboardSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <View style={styles.statsCard}>
        <Shimmer width={120} height={14} />
        <View style={styles.statsRow}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.statItem}>
              <Shimmer width={60} height={28} borderRadius={6} />
              <Shimmer width={50} height={10} />
            </View>
          ))}
        </View>
      </View>

      <Shimmer width={120} height={14} />
      <View style={styles.chartSkeleton}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <View key={i} style={styles.chartBarWrap}>
            <Shimmer width={18} height={40 + (i % 3) * 20} borderRadius={4} />
            <Shimmer width={24} height={8} style={{ marginTop: 4 }} />
          </View>
        ))}
      </View>

      <Shimmer width={120} height={14} style={{ marginTop: 20 }} />
      <View style={styles.listCard}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[styles.campaignRow, i < 2 && styles.campaignRowDivider]}
          >
            <View style={{ flex: 1, gap: 8 }}>
              <Shimmer width="70%" height={14} />
              <Shimmer width="40%" height={10} />
            </View>
            <Shimmer width={56} height={24} borderRadius={12} />
          </View>
        ))}
      </View>
    </View>
  );
}

function SpendChart({ series, themeColors }: { series: SpendDay[]; themeColors?: any }) {
  const maxSpend = useMemo(() => {
    const m = Math.max(0, ...series.map((d) => d.spend));
    return m > 0 ? m : 1;
  }, [series]);

  const chartHeight = 80;

  if (series.length === 0) {
    return (
      <Text style={[styles.chartEmpty, themeColors && { color: themeColors.textMuted }]}>אין נתוני הוצאה ל־7 הימים האחרונים</Text>
    );
  }

  return (
    <View style={styles.chartRow} accessibilityLabel="גרף הוצאה שבועי">
      {series.map((d) => {
        const ratio = d.spend / maxSpend;
        const barH = Math.max(6, Math.round(ratio * chartHeight));
        return (
          <View key={d.date_start} style={styles.chartBarWrap}>
            <View style={[styles.chartBarTrack, themeColors && { backgroundColor: themeColors.inputBg }]}>
              <View style={[styles.chartBarFill, { height: barH }]} />
            </View>
            <Text style={[styles.chartDayLabel, themeColors && { color: themeColors.textMuted }]} numberOfLines={1}>
              {formatDayLabel(d.date_start)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function Index() {
  const router = useRouter();
  const { business, loading } = useBusiness();
  const { colors, mode } = useTheme();
  const rawTabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { isDesktop, contentWidth, width: screenWidth } = useResponsiveLayout();
  const tabBarHeight = isDesktop ? 0 : rawTabBarHeight;

  const [metaLoading, setMetaLoading] = useState(true);
  const [metaCtx, setMetaCtx] = useState<MetaContextPayload | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [recoLoading, setRecoLoading] = useState(false);
  const [reco, setReco] = useState<DanaReco[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [seasonalIdeas, setSeasonalIdeas] = useState<Record<string, string>>({});
  const [seasonalIdeasBusy, setSeasonalIdeasBusy] = useState(false);
  const [recentSessions, setRecentSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const upcomingMarketingEvents = useMemo(() => {
    const now = new Date();
    return MARKETING_EVENTS
      .map((e) => ({ ...e, days: daysUntil(e.date, now) }))
      .filter((e) => new Date(e.date + "T12:00:00").getTime() > now.getTime())
      .sort((a, b) => a.days - b.days)
      .slice(0, 3);
  }, []);

  const closestEvent = upcomingMarketingEvents[0] || null;

  const seasonalIdeasRef = useRef<Record<string, string>>({});
  useEffect(() => {
    seasonalIdeasRef.current = seasonalIdeas;
  }, [seasonalIdeas]);

  const loadMeta = useCallback(async () => {
    if (!business?.id) {
      setMetaCtx(null);
      setMetaLoading(false);
      return;
    }
    setMetaLoading(true);
    try {
      const res = await fetchAdchatApi(
        `${API_BASE}/api/meta-context?business_id=${encodeURIComponent(business.id)}`,
      );
      if (res.status === 401) { router.replace("/auth"); return; }
      const json = (await res.json()) as MetaContextPayload & { error?: string };
      if (!res.ok) {
        setMetaCtx({
          connected: false,
          reason: json.error || "לא ניתן לטעון נתוני Meta",
          today: { spend: 0, clicks: 0, leads: 0 },
          active_campaigns_count: 0,
          campaigns: [],
          spend_last_7_days: [],
        });
        return;
      }
      setMetaCtx(json);
    } catch {
      setFetchError("אין חיבור לאינטרנט. בדוק את החיבור ונסה שוב.");
      setMetaCtx({
        connected: false,
        reason: "שגיאת רשת",
        today: { spend: 0, clicks: 0, leads: 0 },
        active_campaigns_count: 0,
        campaigns: [],
        spend_last_7_days: [],
      });
    } finally {
      setMetaLoading(false);
    }
  }, [business?.id]);

  const loadAlerts = useCallback(async () => {
    if (!business?.id) {
      setAlerts([]);
      return;
    }
    setAlertsLoading(true);
    try {
      const res = await fetchAdchatApi(
        `${API_BASE}/api/alerts?business_id=${encodeURIComponent(business.id)}&limit=25`,
      );
      const json = (await res.json().catch(() => ({}))) as AlertsApiPayload & {
        error?: string;
      };
      if (!res.ok) {
        setAlerts([]);
        return;
      }
      setAlerts(Array.isArray(json.alerts) ? json.alerts : []);
    } catch {
      setAlerts([]);
    } finally {
      setAlertsLoading(false);
    }
  }, [business?.id]);

  const loadDanaRecommendations = useCallback(async () => {
    if (!business?.id) {
      setReco([]);
      return;
    }
    const bid = String(business.id);
    const cacheKey = `dana-rec:${bid}`;
    const now = Date.now();
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts?: number; recommendations?: DanaReco[] };
        if (parsed && Array.isArray(parsed.recommendations)) {
          setReco(parsed.recommendations.slice(0, 3));
          const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
          if (ts && now - ts < 6 * 60 * 60 * 1000) return;
        }
      }
    } catch {
      // ignore
    }
    setRecoLoading(true);
    try {
      const res = await fetchAdchatApi(
        `${API_BASE}/api/dana-recommendations?business_id=${encodeURIComponent(business.id)}`,
      );
      const json = (await res.json().catch(() => ({}))) as DanaRecoPayload & { error?: string };
      if (!res.ok) {
        setReco([]);
        return;
      }
      const list = Array.isArray(json.recommendations)
        ? json.recommendations.slice(0, 3)
        : [];
      setReco(list);
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), recommendations: list }));
    } catch {
      setReco([]);
    } finally {
      setRecoLoading(false);
    }
  }, [business?.id]);

  const ensureSeasonalIdeas = useCallback(async () => {
    if (!business?.id) return;
    if (upcomingMarketingEvents.length === 0) return;
    setSeasonalIdeasBusy(true);
    try {
      const baseId = String(business.id);
      const initial: Record<string, string> = {};
      for (const e of upcomingMarketingEvents) {
        const k = `seasonalIdea:${baseId}:${e.name}:${e.date}`;
        const v = await AsyncStorage.getItem(k);
        if (!v) continue;
        try {
          const o = JSON.parse(v) as { idea?: string; ts?: number };
          const ts = typeof o.ts === "number" ? o.ts : 0;
          const idea = typeof o.idea === "string" ? o.idea.trim() : "";
          if (!idea) continue;
          if (ts && Date.now() - ts > 24 * 60 * 60 * 1000) continue;
          initial[`${e.name}|${e.date}`] = idea;
        } catch {
          initial[`${e.name}|${e.date}`] = String(v).trim();
        }
      }
      if (Object.keys(initial).length) {
        setSeasonalIdeas((prev) => ({ ...prev, ...initial }));
      }
      const current = seasonalIdeasRef.current || {};
      const missing = upcomingMarketingEvents.filter(
        (e) => !(initial[`${e.name}|${e.date}`] || current[`${e.name}|${e.date}`]),
      );
      for (const e of missing) {
        try {
          const res = await fetchAdchatApi(`${API_BASE}/api/seasonal-campaign-idea`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ business_id: baseId, event_name: e.name, event_date: e.date }),
          });
          const json = (await res.json().catch(() => ({}))) as { idea?: string };
          if (!res.ok) continue;
          const idea = typeof json.idea === "string" ? json.idea.trim() : "";
          if (!idea) continue;
          const key = `${e.name}|${e.date}`;
          setSeasonalIdeas((prev) => ({ ...prev, [key]: idea }));
          await AsyncStorage.setItem(
            `seasonalIdea:${baseId}:${e.name}:${e.date}`,
            JSON.stringify({ idea, ts: Date.now() }),
          );
        } catch {
          // ignore
        }
      }
    } finally {
      setSeasonalIdeasBusy(false);
    }
  }, [business?.id, upcomingMarketingEvents]);

  const loadRecentSessions = useCallback(async () => {
    if (!business?.id) {
      setRecentSessions([]);
      return;
    }
    setSessionsLoading(true);
    try {
      const res = await fetchAdchatApi(
        `${API_BASE}/api/chat-sessions?business_id=${encodeURIComponent(business.id)}`,
      );
      const json = (await res.json().catch(() => ({}))) as { sessions?: ChatSession[] };
      if (!res.ok) {
        setRecentSessions([]);
        return;
      }
      setRecentSessions(Array.isArray(json.sessions) ? json.sessions.slice(0, 3) : []);
    } catch {
      setRecentSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [business?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadMeta();
      void loadAlerts();
      void loadDanaRecommendations();
      void ensureSeasonalIdeas();
      void loadRecentSessions();
    }, [loadMeta, loadAlerts, loadDanaRecommendations, ensureSeasonalIdeas, loadRecentSessions]),
  );

  const onRefresh = useCallback(() => {
    setFetchError(null);
    setRefreshing(true);
    void (async () => {
      try {
        await Promise.all([
          loadMeta(),
          loadAlerts(),
          loadDanaRecommendations(),
          ensureSeasonalIdeas(),
          loadRecentSessions(),
        ]);
      } finally {
        setRefreshing(false);
      }
    })();
  }, [loadMeta, loadAlerts, loadDanaRecommendations, ensureSeasonalIdeas, loadRecentSessions]);

  useEffect(() => {
    if (loading) return;
    if (!business) {
      router.replace("/onboarding");
    }
  }, [loading, business, router]);

  const statsCards = useMemo(() => {
    if (!metaCtx?.connected) return null;
    const series = Array.isArray(metaCtx.spend_last_7_days) ? metaCtx.spend_last_7_days : [];
    const lastTwo = [...series].slice(-2);
    const yesterdaySpend = lastTwo.length >= 2 ? Number(lastTwo[0].spend) : NaN;
    const spendDelta = pctChange(metaCtx.today.spend, yesterdaySpend);
    return [
      { key: "spend", emoji: "💰", label: "הוצאה היום", value: formatIls(metaCtx.today.spend), deltaPct: spendDelta },
      { key: "clicks", emoji: "👆", label: "קליקים היום", value: String(metaCtx.today.clicks), deltaPct: null },
      { key: "leads", emoji: "🎯", label: "לידים היום", value: String(metaCtx.today.leads ?? 0), deltaPct: null },
      { key: "campaigns", emoji: "📢", label: "קמפיינים פעילים", value: String(metaCtx.active_campaigns_count), deltaPct: null },
    ] as const;
  }, [metaCtx]);

  const isLight = mode === "light";
  const themed = useMemo(() => ({
    card: { backgroundColor: colors.cardBg, borderColor: colors.cardBorder },
    text: { color: colors.text },
    textSec: { color: colors.textSecondary },
    textMuted: { color: colors.textMuted },
  }), [colors]);

  const danaDaily = reco[0] || null;

  const unreadAlertCount = useMemo(
    () => alerts.filter((a) => !a.read_at).length,
    [alerts],
  );

  if (loading || !business) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.centered, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={colors.statusBar} />
        <ActivityIndicator color="#5B8CFF" size="large" />
        <Text style={[styles.loadingHint, { color: colors.textMuted }]}>
          {loading ? "טוען…" : "מעביר להגדרת עסק…"}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={colors.statusBar} />

      <View style={[styles.container, { backgroundColor: colors.bg }]} accessibilityLanguage="he">
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: 16,
              paddingBottom: Math.max(100, 32 + tabBarHeight + Math.max(insets.bottom, 0)),
              paddingHorizontal: isDesktop ? "5%" : 16,
            },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#5B8CFF"
            />
          }
        >
          {/* 1) Header */}
          <View style={styles.heroHeader}>
            <View style={styles.heroInner}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.heroHello, { color: colors.text, fontSize: isDesktop ? 28 : 22 }]} accessibilityRole="header" numberOfLines={1}>
                  שלום {business.name} 👋
                </Text>
                <Text style={[styles.heroDate, { color: colors.textMuted }]}>{formatHebDate(new Date())}</Text>
              </View>
              <View style={styles.heroAvatarWrap}>
                {business.brand_logo ? (
                  <Image source={{ uri: business.brand_logo }} style={styles.heroAvatar} />
                ) : (
                  <View style={[styles.heroAvatarFallback, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}>
                    <Text style={[styles.heroAvatarFallbackText, { color: colors.text }]}>
                      {String(business.name || "A").trim().slice(0, 1)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Error banner */}
          {fetchError && (
            <View style={[styles.errorBanner, { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.25)" }]}>
              <Text style={styles.errorBannerText}>{fetchError}</Text>
              <Pressable style={styles.errorRetryBtn} onPress={onRefresh}>
                <Text style={styles.errorRetryBtnText}>נסה שוב</Text>
              </Pressable>
            </View>
          )}

          {/* Desktop grid wrapper */}
          <View style={isDesktop ? { flexDirection: "row-reverse", flexWrap: "wrap", gap: 20 } : undefined}>

          {/* 2) Stats (no horizontal scroll) */}
          <View style={[styles.sectionBlockNew, isDesktop && { width: "100%" }]}>
            <View style={styles.statsGrid}>
              {metaLoading ? (
                [0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={[
                      styles.glassCard,
                      styles.statCard,
                      styles.statCardSkeleton,
                      themed.card,
                    ]}
                  >
                    <Shimmer width={24} height={24} borderRadius={12} />
                    <View style={{ flex: 1, gap: 6 }}>
                      <Shimmer width={60} height={16} />
                      <Shimmer width={80} height={10} />
                    </View>
                  </View>
                ))
              ) : !metaCtx?.connected ? (
                <LinearGradient
                  colors={["rgba(24,119,242,0.15)", "rgba(79,110,247,0.08)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.connectMetaCard, { width: "100%", borderColor: "rgba(79,110,247,0.25)" }]}
                >
                  <Text style={{ fontSize: 28, textAlign: "center", marginBottom: 8 }}>📊</Text>
                  <Text style={[styles.connectMetaTitle, themed.text]}>חבר את חשבון Meta</Text>
                  <Text style={[styles.connectMetaBody, themed.textSec]} numberOfLines={2}>
                    כדי לראות הוצאות, קליקים, קמפיינים ולידים בזמן אמת.
                  </Text>
                  <Pressable onPress={() => router.push("/(tabs)/settings")} style={styles.connectMetaBtn}>
                    <Text style={styles.connectMetaBtnText}>חבר עכשיו</Text>
                  </Pressable>
                </LinearGradient>
              ) : (
                statsCards?.map((c) => (
                  <View
                    key={c.key}
                    style={[styles.glassCard, styles.statCard, themed.card]}
                  >
                    <Text style={styles.statEmoji}>{c.emoji}</Text>
                    <View style={styles.statTextWrap}>
                      <Text
                        style={[styles.statBig, themed.text]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {c.value}
                      </Text>
                      <Text style={[styles.statLabelNew, themed.textMuted]} numberOfLines={1} adjustsFontSizeToFit>
                        {c.label}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>

          {/* 3) פעולות מהירות */}
          <View style={[styles.sectionBlockNew, isDesktop && { width: "100%" }]}>
            <Text style={[styles.sectionTitleNew, { color: colors.text }]}>פעולות מהירות</Text>
            <View style={styles.quickRow}>
              {[
                { key: "c", emoji: "🚀", label: "קמפיין חדש", seed: "אני רוצה קמפיין חדש" },
                { key: "g", emoji: "🎨", label: "צור גרפיקה", seed: "צרי לי גרפיקה" },
                { key: "y", emoji: "✍️", label: "כתוב קופי", seed: "כתוב לי קופי" },
                { key: "r", emoji: "📊", label: "נתח ביצועים", seed: "נתח את הביצועים שלי" },
              ].map((a) => (
                <Pressable
                  key={a.key}
                  onPress={() =>
                    router.push({ pathname: "/(tabs)/chat", params: { seedMessage: a.seed } })
                  }
                  style={({ pressed }) => [
                    styles.quickBtn,
                    themed.card,
                    pressed && styles.quickBtnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={a.label}
                  hitSlop={6}
                >
                  <Text style={styles.quickEmoji}>{a.emoji}</Text>
                  <Text style={[styles.quickLabel, themed.text]} numberOfLines={1}>
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 4) התראות (רק אם יש) */}
          {alertsLoading ? null : (() => {
            const top = alerts[0];
            if (!top) return null;
            const urgent = String(top.severity || "") === "urgent";
            return (
              <LinearGradient
                colors={
                  urgent
                    ? ["rgba(239,68,68,0.28)", "rgba(245,158,11,0.16)"]
                    : ["rgba(245,158,11,0.22)", "rgba(255,255,255,0.04)"]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.alertBanner, { borderColor: colors.cardBorder }, isDesktop && { width: "100%" }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.alertBannerTitle, { color: colors.text }]}>
                    {urgent ? "🔴" : "🟡"} {top.title}
                  </Text>
                  <Text style={[styles.alertBannerBody, { color: colors.textSecondary }]} numberOfLines={1}>
                    {top.body}
                  </Text>
                </View>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/chat",
                      params: {
                        seedMessage: top.context_for_chat || top.body || top.title,
                      },
                    })
                  }
                  style={[styles.alertBannerBtn, { backgroundColor: colors.pillBg, borderColor: colors.pillBorder }]}
                >
                  <Text style={[styles.alertBannerBtnText, { color: colors.text }]}>פרטים</Text>
                </Pressable>
              </LinearGradient>
            );
          })()}

          {/* 5) האירוע הקרוב */}
          <View style={[styles.sectionBlockNew, isDesktop && { width: "48%", flexShrink: 0 }]}>
            <Text style={[styles.sectionTitleNew, { color: colors.text }]}>האירוע הקרוב</Text>
            {closestEvent ? (() => {
              const ideaKey = `${closestEvent.name}|${closestEvent.date}`;
              const idea = seasonalIdeas[ideaKey] || "";
              const progress = clamp01(1 - closestEvent.days / 60);
              return (
                <LinearGradient
                  colors={["rgba(79,110,247,0.38)", "rgba(124,58,237,0.28)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.eventHeroCard, { borderColor: colors.cardBorder }]}
                >
                  <View style={styles.eventHeroTop}>
                    <Text style={styles.eventHeroTitle}>
                      {closestEvent.emoji} {closestEvent.name}
                    </Text>
                    <View style={[styles.countdownBadge, { backgroundColor: colors.pillBg }]}>
                      <Text style={styles.countdownBadgeText}>
                        בעוד {closestEvent.days} ימים
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.eventHeroIdea} numberOfLines={2}>
                    {idea || (seasonalIdeasBusy ? "טוען רעיון…" : "רעיון יופיע כאן")}
                  </Text>
                  <View style={[styles.eventHeroProgressTrack, { backgroundColor: colors.pillBg }]}>
                    <View
                      style={[
                        styles.eventHeroProgressFill,
                        { width: `${Math.round(progress * 100)}%` },
                      ]}
                    />
                  </View>
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/chat",
                        params: {
                          seedMessage: `אני רוצה לבנות קמפיין ל${closestEvent.name} — ${idea || ""}`.trim(),
                        },
                      })
                    }
                    style={[styles.eventHeroBtn, { backgroundColor: colors.pillBg, borderColor: colors.pillBorder }]}
                  >
                    <Text style={styles.eventHeroBtnText}>התחל עכשיו</Text>
                  </Pressable>
                </LinearGradient>
              );
            })() : (
              <View style={[styles.glassCard, styles.eventHeroCard]} />
            )}
          </View>

          {/* 6) המלצת דנה */}
          <View style={[styles.sectionBlockNew, isDesktop && { width: "48%", flexShrink: 0 }]}>
            <Text style={[styles.sectionTitleNew, { color: colors.text }]}>המלצת דנה</Text>
            {recoLoading ? (
              <View style={[styles.glassCard, styles.danaCard]} />
            ) : danaDaily ? (
              <View style={[styles.danaCard, themed.card]}>
                <Image source={{ uri: AGENTS.dana.avatar }} style={styles.danaAvatar} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.danaTitle, themed.text]}>{danaDaily.title}</Text>
                  <Text style={[styles.danaBody, themed.textSec]} numberOfLines={2}>
                    {danaDaily.body}
                  </Text>
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/chat",
                        params: { seedMessage: danaDaily.action },
                      })
                    }
                    style={styles.danaBtn}
                  >
                    <Text style={styles.danaBtnText}>בוא נעשה את זה</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={[styles.glassCard, styles.danaCard]} />
            )}
          </View>

          {/* 7) שיחות אחרונות */}
          <View style={[styles.sectionBlockNew, isDesktop && { width: "48%", flexShrink: 0 }]}>
            <Text style={[styles.sectionTitleNew, { color: colors.text }]}>שיחות אחרונות</Text>
            {sessionsLoading ? (
              <View style={{ gap: 12 }}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={[styles.glassCard, styles.recentRowSkeleton, { flexDirection: "row-reverse", alignItems: "center", padding: 12, gap: 10 }]}>
                    <Shimmer width={40} height={40} borderRadius={20} />
                    <View style={{ flex: 1, gap: 6 }}>
                      <Shimmer width="50%" height={14} />
                      <Shimmer width="80%" height={10} />
                    </View>
                  </View>
                ))}
              </View>
            ) : recentSessions.length === 0 ? (
              <View style={[styles.glassCard, themed.card, { padding: 20, alignItems: "center" }]}>
                <Text style={[{ color: colors.textMuted, fontSize: 13, writingDirection: "rtl" }]}>עדיין אין שיחות. התחל שיחה חדשה בצ'אט!</Text>
              </View>
            ) : (
              <View style={[styles.glassCard, themed.card, { overflow: "hidden" }]}>
                {recentSessions.slice(0, 3).map((s, idx) => {
                  const aRaw =
                    typeof s.agent === "string" ? s.agent.trim().toLowerCase() : "";
                  const aKey =
                    (aRaw as AgentKey) && (AGENTS as any)[aRaw]
                      ? (aRaw as AgentKey)
                      : "dana";
                  const agent = AGENTS[aKey];
                  const excerpt = lastMessageExcerpt(s.messages);
                  return (
                    <View key={s.id}>
                      {idx > 0 ? <View style={[styles.recentSeparator, { backgroundColor: colors.separator }]} /> : null}
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: "/(tabs)/chat",
                            params: { sessionId: s.id },
                          } as any)
                        }
                        style={styles.recentRow}
                        hitSlop={6}
                      >
                        <Image
                          source={{ uri: agent.avatar }}
                          style={[
                            styles.recentAvatar,
                            { borderColor: agent.color, borderWidth: 2 },
                          ]}
                        />
                        <View style={{ flex: 1 }}>
                          <View style={styles.recentTop}>
                            <Text style={[styles.recentAgentName, themed.text]}>
                              {agent.name}
                            </Text>
                            <Text style={[styles.recentTime, themed.textMuted]}>
                              {relativeTimeHe(s.updated_at)}
                            </Text>
                          </View>
                          <Text style={[styles.recentExcerpt, themed.textMuted]} numberOfLines={1}>
                            {excerpt || s.title || "שיחה"}
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* 8) גרף הוצאה שבועי */}
          {metaCtx?.connected && Array.isArray(metaCtx.spend_last_7_days) && metaCtx.spend_last_7_days.length > 0 && (
            <View style={[styles.sectionBlockNew, isDesktop && { width: "48%", flexShrink: 0 }]}>
              <Text style={[styles.sectionTitleNew, { color: colors.text }]}>הוצאה שבועית</Text>
              <View style={[styles.glassCard, themed.card, { paddingVertical: 16, paddingHorizontal: 12 }]}>
                <SpendChart series={metaCtx.spend_last_7_days} themeColors={colors} />
              </View>
            </View>
          )}

          {/* 9) קמפיינים */}
          {metaCtx?.connected && Array.isArray(metaCtx.campaigns) && metaCtx.campaigns.length > 0 && (
            <View style={[styles.sectionBlockNew, isDesktop && { width: "100%" }]}>
              <Text style={[styles.sectionTitleNew, { color: colors.text }]}>קמפיינים</Text>
              <View style={[styles.listCard, themed.card]}>
                {metaCtx.campaigns.slice(0, 5).map((c, idx) => {
                  const heuristic = statusHeuristic(c.status);
                  return (
                    <Pressable
                      key={c.id || idx}
                      onPress={() => c.id && router.push(`/campaign/${c.id}` as any)}
                      style={({ pressed }) => [
                        styles.campaignRow,
                        idx < Math.min(metaCtx!.campaigns.length, 5) - 1 && [styles.campaignRowDivider, { borderBottomColor: colors.separator }],
                        pressed && styles.campaignRowPressed,
                      ]}
                    >
                      <View style={styles.campaignMain}>
                        <Text style={[styles.campaignName, themed.text]} numberOfLines={1}>{c.name || "קמפיין"}</Text>
                        <Text style={[styles.campaignMeta, themed.textMuted]} numberOfLines={1}>
                          {c.objective || ""}{c.daily_budget ? ` · ${formatBudgetMinorUnits(c.daily_budget)}/יום` : ""}
                        </Text>
                      </View>
                      <View style={[styles.statusPill, styles[`statusPill${heuristic === "green" ? "Green" : heuristic === "yellow" ? "Yellow" : "Muted"}` as keyof typeof styles]]}>
                        <View style={[styles.statusDot, styles[`statusDot${heuristic === "green" ? "Green" : heuristic === "yellow" ? "Yellow" : "Muted"}` as keyof typeof styles]]} />
                        <Text style={[styles.statusText, styles[`statusText${heuristic === "green" ? "Green" : heuristic === "yellow" ? "Yellow" : "Muted"}` as keyof typeof styles]]}>
                          {c.status === "ACTIVE" ? "פעיל" : c.status === "PAUSED" ? "מושהה" : c.status || "—"}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          </View>{/* end desktop grid wrapper */}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingHint: {
    color: "rgba(243, 246, 255, 0.65)",
    fontSize: 14,
    writingDirection: "rtl",
  },
  container: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },
  scrollContent: {},
  errorBanner: { borderRadius: 14, padding: 16, borderWidth: 1, alignItems: "center", gap: 8, marginBottom: 16 },
  errorBannerText: { color: "#FCA5A5", fontSize: 14, writingDirection: "rtl", textAlign: "center", fontWeight: "600" },
  errorRetryBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 10, backgroundColor: "#EF4444" },
  errorRetryBtnText: { color: "#FFF", fontWeight: "800", fontSize: 13 },
  sectionBlockNew: { marginBottom: 24 },
  sectionTitleNew: {
    color: "#F3F6FF",
    fontSize: 16,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
    marginBottom: 12,
  },
  heroHeader: {
    minHeight: 72,
    paddingBottom: 12,
  },
  heroInner: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  heroTopRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  heroHello: {
    color: "#F3F6FF",
    fontSize: 22,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
  },
  heroDate: {
    marginTop: 4,
    color: "rgba(243,246,255,0.50)",
    fontSize: 13,
    fontWeight: "600",
    writingDirection: "rtl",
    textAlign: "right",
  },
  heroAvatarWrap: { width: 44, height: 44, borderRadius: 22 },
  heroAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "rgba(79,110,247,0.3)",
  },
  heroAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroAvatarFallbackText: { color: "#F3F6FF", fontSize: 16, fontWeight: "800" },

  glassCard: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
  },
  statsGrid: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 10,
  },
  statCard: {
    flex: 1,
    minWidth: 140,
    flexDirection: "row-reverse",
    alignItems: "center",
    padding: 12,
    gap: 8,
  },
  statCardSkeleton: { minHeight: 56, flex: 1, minWidth: 140 },
  statEmoji: { fontSize: 20 },
  statTextWrap: { flex: 1 },
  statBig: {
    color: "#F3F6FF",
    fontSize: 18,
    fontWeight: "800",
    writingDirection: "rtl",
    textAlign: "right",
  },
  statLabelNew: {
    marginTop: 2,
    color: "rgba(243,246,255,0.60)",
    fontSize: 11,
    fontWeight: "600",
    writingDirection: "rtl",
    textAlign: "right",
  },
  connectMetaCard: { minHeight: 100, padding: 20, borderRadius: 18, borderWidth: 1, alignItems: "center" },
  connectMetaTitle: {
    color: "#F3F6FF",
    fontSize: 17,
    fontWeight: "900",
    writingDirection: "rtl",
    textAlign: "center",
  },
  connectMetaBody: {
    marginTop: 6,
    color: "rgba(243,246,255,0.70)",
    fontSize: 13,
    lineHeight: 19,
    writingDirection: "rtl",
    textAlign: "center",
  },
  connectMetaBtn: {
    marginTop: 12,
    height: 40,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: "#4F6EF7",
    alignItems: "center",
    justifyContent: "center",
  },
  connectMetaBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },

  // Quick actions (in-flow)
  quickRow: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 10 },
  quickBtn: {
    flexGrow: 1,
    flexBasis: "22%",
    minWidth: 72,
    minHeight: 56,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  quickBtnPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  quickEmoji: { fontSize: 24 },
  quickLabel: {
    color: "rgba(243,246,255,0.85)",
    fontSize: 11,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "center",
  },

  alertBanner: {
    marginBottom: 24,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
  },
  alertBannerTitle: {
    color: "#F3F6FF",
    fontSize: 14,
    fontWeight: "900",
    writingDirection: "rtl",
    textAlign: "right",
  },
  alertBannerBody: {
    marginTop: 4,
    color: "rgba(243,246,255,0.70)",
    fontSize: 12,
    fontWeight: "800",
    writingDirection: "rtl",
    textAlign: "right",
  },
  alertBannerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  alertBannerBtnText: { color: "#F3F6FF", fontSize: 12, fontWeight: "900" },

  eventHeroCard: {
    minHeight: 160,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  eventHeroTop: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  eventHeroTitle: {
    color: "#F3F6FF",
    fontSize: 16,
    fontWeight: "900",
    writingDirection: "rtl",
    textAlign: "right",
  },
  countdownBadge: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  countdownBadgeText: {
    color: "rgba(243,246,255,0.90)",
    fontSize: 12,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  eventHeroIdea: {
    marginTop: 10,
    color: "rgba(243,246,255,0.80)",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
    writingDirection: "rtl",
    textAlign: "right",
  },
  eventHeroProgressTrack: {
    marginTop: 12,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
  },
  eventHeroProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.60)",
  },
  eventHeroBtn: {
    marginTop: 14,
    height: 46,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  eventHeroBtnText: { color: "#F3F6FF", fontSize: 14, fontWeight: "900" },

  danaCard: {
    minHeight: 120,
    flexDirection: "row-reverse",
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderLeftWidth: 3,
    borderLeftColor: "#4F6EF7",
  },
  danaAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "#4F6EF7",
  },
  danaTitle: {
    color: "#F3F6FF",
    fontSize: 14,
    fontWeight: "900",
    writingDirection: "rtl",
    textAlign: "right",
  },
  danaBody: {
    marginTop: 6,
    color: "rgba(243,246,255,0.70)",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "800",
    writingDirection: "rtl",
    textAlign: "right",
  },
  danaBtn: {
    marginTop: 10,
    height: 38,
    borderRadius: 14,
    backgroundColor: "#4F6EF7",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 14,
  },
  danaBtnText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },

  recentRow: {
    minHeight: 64,
    flexDirection: "row-reverse",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  recentRowSkeleton: { minHeight: 64 },
  recentSeparator: { height: 1, backgroundColor: "rgba(255,255,255,0.05)" },
  recentAvatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  recentAvatarEmoji: { fontSize: 18 },
  recentTop: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  recentAgentName: {
    color: "#F3F6FF",
    fontSize: 14,
    fontWeight: "600",
    writingDirection: "rtl",
  },
  recentTime: {
    color: "rgba(243,246,255,0.50)",
    fontSize: 11,
    fontWeight: "600",
    writingDirection: "rtl",
  },
  recentExcerpt: {
    marginTop: 4,
    color: "rgba(243,246,255,0.50)",
    fontSize: 12,
    fontWeight: "600",
    writingDirection: "rtl",
    textAlign: "right",
  },
  // legacy styles below (kept only if referenced elsewhere)
  alertBadge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 12,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
  },
  alertBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
  },
  alertsBlock: {
    marginBottom: 8,
  },
  alertsBlockTitle: {
    color: "#FECACA",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 10,
    textAlign: "right",
    writingDirection: "rtl",
  },
  alertCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    backgroundColor: "rgba(220, 38, 38, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(220, 38, 38, 0.28)",
  },
  alertCardUrgent: {
    backgroundColor: "rgba(220, 38, 38, 0.14)",
    borderColor: "rgba(220, 38, 38, 0.45)",
  },
  alertCardUnread: {
    borderRightWidth: 4,
    borderRightColor: "#EF4444",
  },
  alertCardTop: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },
  alertCardTitle: {
    flex: 1,
    color: "#FEF2F2",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  alertPillUnread: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
  },
  alertCardBody: {
    color: "rgba(254, 242, 242, 0.85)",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "right",
    writingDirection: "rtl",
    marginBottom: 12,
  },
  alertCardActions: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 16,
    alignItems: "center",
  },
  alertActionText: {
    color: "#93C5FD",
    fontSize: 14,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  alertActionSecondary: {
    color: "rgba(243, 246, 255, 0.65)",
    fontSize: 14,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  brandTitle: {
    color: "#F3F6FF",
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: 0.2,
    textAlign: "right",
    writingDirection: "rtl",
  },
  businessName: {
    marginTop: 6,
    color: "#A8B8F5",
    fontSize: 17,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  brandSubtitle: {
    marginTop: 8,
    color: "rgba(243, 246, 255, 0.75)",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "right",
    writingDirection: "rtl",
  },
  sectionHeaderRow: {
    marginTop: 16,
    marginBottom: 10,
    flexDirection: "row-reverse",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: "#EAF0FF",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  sectionHint: {
    color: "rgba(234, 240, 255, 0.6)",
    fontSize: 12,
    textAlign: "left",
    writingDirection: "rtl",
  },
  statsCard: {
    marginTop: 10,
    borderRadius: 18,
    padding: 16,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  graphErrorHint: {
    marginTop: 10,
    color: "rgba(251, 191, 36, 0.9)",
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl",
  },
  statsRow: {
    marginTop: 12,
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    gap: 10,
  },
  statItem: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: "rgba(11, 15, 23, 0.6)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  statValue: {
    color: "#F3F6FF",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  statLabel: {
    marginTop: 6,
    color: "rgba(243, 246, 255, 0.7)",
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl",
  },
  chartCard: {
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  chartRow: {
    flexDirection: "row-reverse",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 6,
    minHeight: 110,
  },
  chartBarWrap: {
    flex: 1,
    alignItems: "center",
    maxWidth: 48,
  },
  chartBarTrack: {
    width: "70%",
    maxWidth: 28,
    height: 80,
    justifyContent: "flex-end",
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  chartBarFill: {
    width: "100%",
    borderRadius: 8,
    backgroundColor: "rgba(91, 140, 255, 0.85)",
    minHeight: 4,
  },
  chartDayLabel: {
    marginTop: 6,
    fontSize: 9,
    color: "rgba(243, 246, 255, 0.55)",
    textAlign: "center",
    writingDirection: "rtl",
  },
  chartEmpty: {
    color: "rgba(243, 246, 255, 0.55)",
    fontSize: 14,
    textAlign: "right",
    writingDirection: "rtl",
  },
  listCard: {
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    overflow: "hidden",
  },
  emptyCampaigns: {
    padding: 20,
    color: "rgba(243, 246, 255, 0.55)",
    fontSize: 14,
    textAlign: "right",
    writingDirection: "rtl",
  },
  campaignRow: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  campaignRowPressed: {
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  campaignRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.06)",
  },
  campaignMain: {
    flex: 1,
  },
  campaignName: {
    color: "#F3F6FF",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  campaignMeta: {
    marginTop: 4,
    color: "rgba(243, 246, 255, 0.65)",
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl",
  },
  statusPill: {
    flexDirection: "row-reverse",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    gap: 6,
    minWidth: 78,
    justifyContent: "center",
  },
  statusPillGreen: {
    backgroundColor: "rgba(34, 197, 94, 0.12)",
    borderColor: "rgba(34, 197, 94, 0.25)",
  },
  statusPillYellow: {
    backgroundColor: "rgba(234, 179, 8, 0.12)",
    borderColor: "rgba(234, 179, 8, 0.25)",
  },
  statusPillMuted: {
    backgroundColor: "rgba(148, 163, 184, 0.1)",
    borderColor: "rgba(148, 163, 184, 0.2)",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  statusDotGreen: {
    backgroundColor: "#22C55E",
  },
  statusDotYellow: {
    backgroundColor: "#EAB308",
  },
  statusDotMuted: {
    backgroundColor: "#94A3B8",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  statusTextGreen: {
    color: "#67E8A4",
  },
  statusTextYellow: {
    color: "#FDE047",
  },
  statusTextMuted: {
    color: "#CBD5E1",
  },
  connectCard: {
    marginTop: 12,
    borderRadius: 18,
    padding: 20,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  connectTitle: {
    color: "#F3F6FF",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  connectBody: {
    marginTop: 10,
    color: "rgba(243, 246, 255, 0.7)",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "right",
    writingDirection: "rtl",
  },
  connectBtn: {
    marginTop: 18,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(24, 119, 242, 0.25)",
    borderWidth: 1,
    borderColor: "rgba(24, 119, 242, 0.4)",
  },
  connectBtnPressed: {
    opacity: 0.88,
  },
  connectBtnText: {
    color: "#F3F6FF",
    fontSize: 15,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  skeletonWrap: {
    marginTop: 6,
  },
  skeletonLineShort: {
    height: 14,
    width: "40%",
    alignSelf: "flex-end",
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  skeletonLineMd: {
    height: 12,
    width: "75%",
    alignSelf: "flex-end",
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  skeletonLineSm: {
    height: 10,
    width: "50%",
    alignSelf: "flex-end",
    marginTop: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  skeletonLineXs: {
    height: 8,
    width: "60%",
    marginTop: 6,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  skeletonBlockLg: {
    height: 22,
    width: "70%",
    alignSelf: "flex-end",
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  skeletonBar: {
    width: 14,
    height: 56,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  skeletonPill: {
    width: 72,
    height: 30,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  chartSkeleton: {
    flexDirection: "row-reverse",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
    minHeight: 100,
  },
  // legacy styles (no absolute positioning on home)
  bottomCtaWrapper: {},
  ctaButton: {
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2F6BFF",
    shadowColor: "#2F6BFF",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  ctaButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    writingDirection: "rtl",
  },
});
