import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useBusiness } from "../../contexts/business-context";
import { useTheme } from "../../contexts/theme-context";
import { fetchAdchatApi } from "../../lib/fetch-adchat-api";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

type InsightSummary = {
  spend: number;
  clicks: number;
  impressions: number;
  cpc: number;
  ctr: number;
  reach: number;
  frequency: number;
};

type SeriesRow = {
  date_start: string;
  date_stop?: string;
  spend: number;
  clicks: number;
  impressions: number;
  reach: number;
  ctr: number;
};

type AgeGenderRow = {
  age?: string;
  gender?: string;
  spend: number;
  clicks: number;
  impressions: number;
  reach: number;
};

type CountryRow = {
  country?: string;
  spend: number;
  clicks: number;
  impressions: number;
};

type CampaignDetailResponse = {
  error?: string;
  campaign?: {
    id: string;
    name?: string;
    status?: string;
    daily_budget?: string | number;
    objective?: string;
  };
  range_days?: number;
  summary?: InsightSummary | null;
  series?: SeriesRow[];
  breakdown_age_gender?: AgeGenderRow[];
  breakdown_country?: CountryRow[];
  graph_error?: string | null;
};

type AdSet = {
  id: string;
  name: string;
  status: string;
  targeting: {
    age_min?: number;
    age_max?: number;
    genders?: number[];
    geo_locations?: { countries?: string[]; cities?: { name: string }[] };
    interests?: { id: string; name: string }[];
    custom_audiences?: { id: string; name: string }[];
  };
  optimization_goal?: string;
};

type Ad = {
  id: string;
  name: string;
  status: string;
  headline?: string;
  body?: string;
  description?: string;
  image_url?: string;
  cta_type?: string;
  link_url?: string;
};

const CTA_LABELS: Record<string, string> = {
  LEARN_MORE: "מידע נוסף",
  SHOP_NOW: "קנה עכשיו",
  SIGN_UP: "הירשם",
  BOOK_TRAVEL: "הזמן",
  CONTACT_US: "צור קשר",
  DOWNLOAD: "הורד",
  GET_OFFER: "קבל הצעה",
  GET_QUOTE: "קבל הצעת מחיר",
  SUBSCRIBE: "הירשם",
  SEND_MESSAGE: "שלח הודעה",
  APPLY_NOW: "הגש מועמדות",
  WATCH_MORE: "צפה עוד",
  CALL_NOW: "התקשר",
  WHATSAPP_MESSAGE: "WhatsApp",
  ORDER_NOW: "הזמן עכשיו",
  BUY_NOW: "קנה עכשיו",
};

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
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "short" });
}

function genderHe(g: string | undefined): string {
  const u = String(g || "").toLowerCase();
  if (u === "male") return "גברים";
  if (u === "female") return "נשים";
  if (u === "unknown") return "לא ידוע";
  return g || "—";
}

function PerformanceChart({ series }: { series: SeriesRow[] }) {
  const { colors } = useTheme();
  const maxSpend = useMemo(() => {
    const m = Math.max(0, ...series.map((d) => d.spend));
    return m > 0 ? m : 1;
  }, [series]);
  const h = 88;

  if (series.length === 0) {
    return (
      <Text style={[styles.chartEmpty, { color: colors.textMuted }]}>אין נתוני סדרה לתקופה</Text>
    );
  }

  return (
    <View style={styles.chartRow}>
      {series.map((d) => {
        const ratio = d.spend / maxSpend;
        const barH = Math.max(6, Math.round(ratio * h));
        return (
          <View key={d.date_start} style={styles.chartBarWrap}>
            <View style={[styles.chartBarTrack, { backgroundColor: colors.inputBg }]}>
              <View style={[styles.chartBarFill, { height: barH }]} />
            </View>
            <Text style={[styles.chartDayLabel, { color: colors.textMuted }]} numberOfLines={1}>
              {formatDayLabel(d.date_start)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function CampaignDetailScreen() {
  const router = useRouter();
  const { id: campaignId } = useLocalSearchParams<{ id: string }>();
  const { business, loading: businessLoading } = useBusiness();
  const { colors } = useTheme();
  const { isDesktop } = useResponsiveLayout();

  const [activeTab, setActiveTab] = useState<"performance" | "audiences" | "ads">("performance");
  const [rangeDays, setRangeDays] = useState<7 | 14 | 30>(7);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CampaignDetailResponse | null>(null);
  const [budgetModal, setBudgetModal] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const [adsets, setAdsets] = useState<AdSet[]>([]);
  const [adsetsLoading, setAdsetsLoading] = useState(false);

  const [ads, setAds] = useState<Ad[]>([]);
  const [adsLoading, setAdsLoading] = useState(false);

  const cid = typeof campaignId === "string" ? campaignId : "";

  const load = useCallback(async () => {
    if (!business?.id || !cid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchAdchatApi(
        `${API_BASE}/api/meta-campaign/${encodeURIComponent(cid)}?business_id=${encodeURIComponent(business.id)}&range=${rangeDays}`,
      );
      const json = (await res.json()) as CampaignDetailResponse;
      if (!res.ok) {
        setData({ error: json.error || "שגיאת טעינה" });
        return;
      }
      setData(json);
    } catch {
      setData({ error: "שגיאת רשת" });
    } finally {
      setLoading(false);
    }
  }, [business?.id, cid, rangeDays]);

  useEffect(() => {
    void load();
  }, [load]);

  const [adsetsError, setAdsetsError] = useState<string | null>(null);
  const [adsError, setAdsError] = useState<string | null>(null);

  const loadAdsets = useCallback(async () => {
    if (!business?.id || !cid) return;
    if (adsets.length > 0) return;
    setAdsetsLoading(true);
    setAdsetsError(null);
    try {
      const res = await fetchAdchatApi(
        `${API_BASE}/api/meta-campaign/${encodeURIComponent(cid)}/adsets?business_id=${encodeURIComponent(business.id)}`,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAdsetsError(json.error || "שגיאה בטעינת קהלים");
        return;
      }
      if (Array.isArray(json.adsets)) {
        setAdsets(json.adsets);
      }
    } catch {
      setAdsetsError("שגיאת רשת");
    } finally {
      setAdsetsLoading(false);
    }
  }, [business?.id, cid, adsets.length]);

  const loadAds = useCallback(async () => {
    if (!business?.id || !cid) return;
    if (ads.length > 0) return;
    setAdsLoading(true);
    setAdsError(null);
    try {
      const res = await fetchAdchatApi(
        `${API_BASE}/api/meta-campaign/${encodeURIComponent(cid)}/ads?business_id=${encodeURIComponent(business.id)}`,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAdsError(json.error || "שגיאה בטעינת מודעות");
        return;
      }
      if (Array.isArray(json.ads)) {
        setAds(json.ads);
      }
    } catch {
      setAdsError("שגיאת רשת");
    } finally {
      setAdsLoading(false);
    }
  }, [business?.id, cid, ads.length]);

  useEffect(() => {
    if (activeTab === "audiences") void loadAdsets();
    if (activeTab === "ads") void loadAds();
  }, [activeTab, loadAdsets, loadAds]);

  const postAction = async (
    path: string,
    body?: Record<string, unknown>,
  ) => {
    if (!business?.id || !cid) return;
    setActionBusy(true);
    try {
      const res = await fetchAdchatApi(
        `${API_BASE}/api/meta-campaign/${encodeURIComponent(cid)}${path}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ business_id: business.id, ...body }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        Alert.alert("שגיאה", json.error || res.statusText);
        return;
      }
      if (path === "/duplicate") {
        Alert.alert("", "הקמפיין נשלח לשכפול. בדקו במנהל המודעות.");
      }
      void load();
    } catch (e) {
      Alert.alert(
        "שגיאה",
        e instanceof Error ? e.message : "לא ניתן להשלים",
      );
    } finally {
      setActionBusy(false);
    }
  };

  const openChatWithSeed = () => {
    const name = data?.campaign?.name || "זה";
    const seed = `נתח לי את הקמפיין "${name}" (מזהה ${cid})`;
    router.push({
      pathname: "/(tabs)/chat",
      params: { seedMessage: seed },
    });
  };

  const submitBudget = async () => {
    const n = parseFloat(budgetInput.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert("", "הזן תקציב יומי חיובי בשקלים");
      return;
    }
    setBudgetModal(false);
    setBudgetInput("");
    await postAction("/budget", { daily_budget_ils: n });
  };

  if (businessLoading || !business) {
    return (
      <SafeAreaView style={[styles.safe, styles.centered, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={colors.statusBar} />
        <ActivityIndicator color="#5B8CFF" size="large" />
      </SafeAreaView>
    );
  }

  if (!cid) {
    return (
      <SafeAreaView style={[styles.safe, styles.centered, { backgroundColor: colors.bg }]}>
        <StatusBar barStyle={colors.statusBar} />
        <Text style={styles.errText}>חסר מזהה קמפיין</Text>
        <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/(tabs)/campaigns"); } }}>
          <Text style={styles.link}>חזרה</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const summary = data?.summary;
  const series = data?.series ?? [];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={[styles.header, { borderBottomColor: colors.cardBorder }]}>
        <TouchableOpacity
          onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace("/(tabs)/campaigns"); } }}
          style={styles.backBtn}
          accessibilityLabel="חזרה"
        >
          <Text style={[styles.backIcon, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }, isDesktop && { fontSize: 22 }]} numberOfLines={1}>
          {data?.campaign?.name || "קמפיין"}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Tab bar */}
      <View style={[styles.tabBar, { borderBottomColor: colors.cardBorder }]}>
        {([
          { key: "performance" as const, label: "ביצועים" },
          { key: "audiences" as const, label: "קהלים" },
          { key: "ads" as const, label: "מודעות" },
        ]).map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.tabItem,
              activeTab === tab.key && styles.tabItemActive,
            ]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.tabText,
                { color: colors.textSecondary },
                activeTab === tab.key && { color: "#5B8CFF", fontWeight: "800" },
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && activeTab === "performance" ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#5B8CFF" size="large" />
          <Text style={[styles.loadingHint, { color: colors.textSecondary }]}>טוען נתוני קמפיין…</Text>
        </View>
      ) : data?.error && activeTab === "performance" ? (
        <View style={styles.centered}>
          <Text style={styles.errText}>{data.error}</Text>
          <TouchableOpacity onPress={() => void load()}>
            <Text style={styles.link}>נסה שוב</Text>
          </TouchableOpacity>
        </View>
      ) : activeTab === "performance" ? (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingHorizontal: isDesktop ? "5%" : 16 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.rangeRow}>
            {([7, 14, 30] as const).map((d) => (
              <Pressable
                key={d}
                style={[
                  styles.rangeChip,
                  { backgroundColor: colors.inputBg, borderColor: colors.pillBorder },
                  rangeDays === d && styles.rangeChipOn,
                ]}
                onPress={() => setRangeDays(d)}
              >
                <Text
                  style={[
                    styles.rangeChipText,
                    { color: colors.textSecondary },
                    rangeDays === d && [styles.rangeChipTextOn, { color: colors.text }],
                  ]}
                >
                  {d} ימים
                </Text>
              </Pressable>
            ))}
          </View>

          {data?.graph_error ? (
            <Text style={styles.warn}>{data.graph_error}</Text>
          ) : null}

          <View style={[styles.metricsGrid, isDesktop && { flexWrap: "nowrap" }]}>
            <MetricBox label="הוצאה" value={formatIls(summary?.spend ?? 0)} isDesktop={isDesktop} />
            <MetricBox
              label="קליקים"
              value={String(summary?.clicks ?? 0)}
              isDesktop={isDesktop}
            />
            <MetricBox
              label="חשיפות"
              value={String(summary?.impressions ?? 0)}
              isDesktop={isDesktop}
            />
            <MetricBox label="CPC" value={formatIls(summary?.cpc ?? 0)} isDesktop={isDesktop} />
            <MetricBox
              label="CTR %"
              value={`${((summary?.ctr ?? 0) * 100).toFixed(2)}%`}
              isDesktop={isDesktop}
            />
            <MetricBox
              label="Reach"
              value={String(summary?.reach ?? 0)}
              isDesktop={isDesktop}
            />
            <MetricBox
              label="תדירות"
              value={(summary?.frequency ?? 0).toFixed(2)}
              isDesktop={isDesktop}
            />
          </View>

          <View style={isDesktop ? { flexDirection: "row-reverse", flexWrap: "wrap", gap: 16 } : undefined}>
            <View style={isDesktop ? { flex: 1, minWidth: 280 } : undefined}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>ביצועים לפי יום</Text>
              <View style={[styles.chartCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
                <PerformanceChart series={series} />
              </View>
            </View>

            <View style={isDesktop ? { flex: 1, minWidth: 280 } : undefined}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>פילוח גיל ומין</Text>
              <View style={[styles.tableCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
                {(data?.breakdown_age_gender?.length ?? 0) === 0 ? (
                  <Text style={[styles.tableEmpty, { color: colors.textMuted }]}>אין נתונים או אין הרשאה</Text>
                ) : (
                  data?.breakdown_age_gender?.map((row, i) => (
                    <View
                      key={`${row.age}-${row.gender}-${i}`}
                      style={[
                        styles.tableRow,
                        i > 0 && [styles.tableRowBorder, { borderTopColor: colors.separator }],
                      ]}
                    >
                      <Text style={[styles.tableCellMain, { color: colors.text }]}>
                        גיל {row.age || "—"} · {genderHe(row.gender)}
                      </Text>
                      <Text style={[styles.tableCell, { color: colors.textSecondary }]}>
                        {formatIls(row.spend)} · {row.clicks} קליקים
                      </Text>
                    </View>
                  ))
                )}
              </View>

              <Text style={[styles.sectionTitle, { color: colors.text }]}>פילוח מיקום (מדינה)</Text>
              <View style={[styles.tableCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
                {(data?.breakdown_country?.length ?? 0) === 0 ? (
                  <Text style={[styles.tableEmpty, { color: colors.textMuted }]}>אין נתונים או אין הרשאה</Text>
                ) : (
                  data?.breakdown_country?.map((row, i) => (
                    <View
                      key={`${row.country}-${i}`}
                      style={[
                        styles.tableRow,
                        i > 0 && [styles.tableRowBorder, { borderTopColor: colors.separator }],
                      ]}
                    >
                      <Text style={[styles.tableCellMain, { color: colors.text }]}>
                        {row.country || "—"}
                      </Text>
                      <Text style={[styles.tableCell, { color: colors.textSecondary }]}>
                        {formatIls(row.spend)} · {row.clicks} קליקים
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={styles.agentBtn}
            onPress={openChatWithSeed}
            activeOpacity={0.9}
          >
            <Text style={styles.agentBtnText}>
              שאל את הסוכן על הקמפיין הזה
            </Text>
          </TouchableOpacity>

          <View style={[styles.actionsRow, isDesktop && { flexWrap: "nowrap", justifyContent: "center" }]}>
            <ActionChip
              label="עצור"
              disabled={actionBusy}
              onPress={() => {
                Alert.alert("עצירת קמפיין", "לעצור את הקמפיין?", [
                  { text: "ביטול", style: "cancel" },
                  {
                    text: "עצור",
                    style: "destructive",
                    onPress: () => void postAction("/pause"),
                  },
                ]);
              }}
            />
            <ActionChip
              label="הפעל"
              disabled={actionBusy}
              onPress={() => void postAction("/activate")}
            />
            <ActionChip
              label="שכפל"
              disabled={actionBusy}
              onPress={() => {
                Alert.alert("שכפול", "לשכפל קמפיין?", [
                  { text: "ביטול", style: "cancel" },
                  {
                    text: "שכפל",
                    onPress: () => void postAction("/duplicate"),
                  },
                ]);
              }}
            />
            <ActionChip
              label="תקציב"
              disabled={actionBusy}
              onPress={() => {
                setBudgetInput("");
                setBudgetModal(true);
              }}
            />
          </View>
          <View style={{ height: 32 }} />
        </ScrollView>
      ) : activeTab === "audiences" ? (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingHorizontal: isDesktop ? "5%" : 16 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {adsetsLoading ? (
            <View style={[styles.centered, { paddingVertical: 40 }]}>
              <ActivityIndicator color="#5B8CFF" size="large" />
              <Text style={[{ color: colors.textMuted, fontSize: 13, marginTop: 8 }]}>טוען קהלים…</Text>
            </View>
          ) : adsetsError ? (
            <View style={[styles.centered, { paddingVertical: 40, gap: 10 }]}>
              <Text style={{ color: "#FCA5A5", fontSize: 14, textAlign: "center", writingDirection: "rtl" }}>{adsetsError}</Text>
              <Pressable onPress={() => { setAdsets([]); void loadAdsets(); }} style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: "#4F6EF7" }}>
                <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 13 }}>נסה שוב</Text>
              </Pressable>
            </View>
          ) : adsets.length === 0 ? (
            <Text style={[styles.tableEmpty, { color: colors.textMuted, textAlign: "center", marginTop: 32 }]}>
              לא נמצאו קהלים לקמפיין זה
            </Text>
          ) : (
            adsets.map((adset) => (
              <View
                key={adset.id}
                style={[styles.adsetCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}
              >
                <View style={styles.adsetHeader}>
                  <Text style={[styles.adsetName, { color: colors.text }]}>{adset.name}</Text>
                  <StatusPill status={adset.status} />
                </View>

                <View style={styles.adsetDetails}>
                  {(adset.targeting.age_min || adset.targeting.age_max) && (
                    <Text style={[styles.adsetDetail, { color: colors.textSecondary }]}>
                      גילאי {adset.targeting.age_min ?? "—"} – {adset.targeting.age_max ?? "—"}
                    </Text>
                  )}
                  {adset.targeting.genders && adset.targeting.genders.length > 0 && (
                    <Text style={[styles.adsetDetail, { color: colors.textSecondary }]}>
                      מין: {adset.targeting.genders.map((g) => (g === 1 ? "גברים" : g === 2 ? "נשים" : "הכל")).join(", ")}
                    </Text>
                  )}
                  {adset.targeting.geo_locations?.countries && adset.targeting.geo_locations.countries.length > 0 && (
                    <Text style={[styles.adsetDetail, { color: colors.textSecondary }]}>
                      מיקומים: {adset.targeting.geo_locations.countries.join(", ")}
                    </Text>
                  )}
                  {adset.targeting.geo_locations?.cities && adset.targeting.geo_locations.cities.length > 0 && (
                    <Text style={[styles.adsetDetail, { color: colors.textSecondary }]}>
                      ערים: {adset.targeting.geo_locations.cities.map((c) => c.name).join(", ")}
                    </Text>
                  )}
                  {adset.targeting.interests && adset.targeting.interests.length > 0 && (
                    <Text style={[styles.adsetDetail, { color: colors.textSecondary }]}>
                      תחומי עניין: {adset.targeting.interests.map((i) => i.name).join(", ")}
                    </Text>
                  )}
                  {adset.targeting.custom_audiences && adset.targeting.custom_audiences.length > 0 && (
                    <Text style={[styles.adsetDetail, { color: colors.textSecondary }]}>
                      קהלים מותאמים: {adset.targeting.custom_audiences.map((ca) => ca.name).join(", ")}
                    </Text>
                  )}
                  {adset.optimization_goal && (
                    <Text style={[styles.adsetDetail, { color: colors.textSecondary }]}>
                      מטרת אופטימיזציה: {adset.optimization_goal}
                    </Text>
                  )}
                </View>
              </View>
            ))
          )}
          <View style={{ height: 32 }} />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingHorizontal: isDesktop ? "5%" : 16 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {adsLoading ? (
            <View style={[styles.centered, { paddingVertical: 40 }]}>
              <ActivityIndicator color="#5B8CFF" size="large" />
              <Text style={[{ color: colors.textMuted, fontSize: 13, marginTop: 8 }]}>טוען מודעות…</Text>
            </View>
          ) : adsError ? (
            <View style={[styles.centered, { paddingVertical: 40, gap: 10 }]}>
              <Text style={{ color: "#FCA5A5", fontSize: 14, textAlign: "center", writingDirection: "rtl" }}>{adsError}</Text>
              <Pressable onPress={() => { setAds([]); void loadAds(); }} style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: "#4F6EF7" }}>
                <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 13 }}>נסה שוב</Text>
              </Pressable>
            </View>
          ) : ads.length === 0 ? (
            <Text style={[styles.tableEmpty, { color: colors.textMuted, textAlign: "center", marginTop: 32 }]}>
              לא נמצאו מודעות לקמפיין זה
            </Text>
          ) : (
            <View style={[styles.adsGrid, isDesktop && { flexDirection: "row-reverse", flexWrap: "wrap", gap: 16 }]}>
              {ads.map((ad) => {
                const ctaLabel = ad.cta_type ? (CTA_LABELS[ad.cta_type] || ad.cta_type.replace(/_/g, " ")) : null;
                const pageName = data?.campaign?.name || "העמוד שלך";
                return (
                  <View
                    key={ad.id}
                    style={[
                      styles.fbAdCard,
                      { backgroundColor: colors.cardBg, borderColor: colors.cardBorder },
                      isDesktop && { width: "31%", minWidth: 280 },
                    ]}
                  >
                    {/* FB Header — page avatar + name + Sponsored */}
                    <View style={styles.fbAdHeader}>
                      <View style={[styles.fbPageAvatar, { backgroundColor: "#4F6EF7" }]}>
                        <Text style={styles.fbPageAvatarText}>{String(pageName).charAt(0)}</Text>
                      </View>
                      <View>
                        <Text style={[styles.fbPageName, { color: colors.text }]} numberOfLines={1}>{pageName}</Text>
                        <Text style={[styles.fbSponsored, { color: colors.textMuted }]}>ממומן · 🌐</Text>
                      </View>
                    </View>

                    {/* Body text (post copy) */}
                    {ad.body ? (
                      <Text style={[styles.fbBody, { color: colors.text }]} numberOfLines={3}>{ad.body}</Text>
                    ) : null}

                    {/* Image */}
                    {ad.image_url ? (
                      <Image source={{ uri: ad.image_url }} style={styles.fbImage} resizeMode="cover" />
                    ) : (
                      <View style={[styles.fbImagePlaceholder, { backgroundColor: colors.inputBg }]}>
                        <Text style={{ fontSize: 28, opacity: 0.4 }}>🖼️</Text>
                      </View>
                    )}

                    {/* Headline + Description + CTA bar */}
                    <View style={[styles.fbLinkBar, { backgroundColor: colors.bgSecondary, borderTopColor: colors.separator }]}>
                      <View style={{ flex: 1 }}>
                        {ad.headline ? (
                          <Text style={[styles.fbHeadline, { color: colors.text }]} numberOfLines={1}>{ad.headline}</Text>
                        ) : null}
                        {ad.description ? (
                          <Text style={[styles.fbDescription, { color: colors.textMuted }]} numberOfLines={1}>{ad.description}</Text>
                        ) : null}
                      </View>
                      {ctaLabel ? (
                        <View style={styles.fbCtaBtn}>
                          <Text style={styles.fbCtaBtnText}>{ctaLabel}</Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Status badge */}
                    <View style={styles.fbStatusRow}>
                      <StatusPill status={ad.status} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      <Modal
        visible={budgetModal}
        transparent
        animationType="fade"
        onRequestClose={() => setBudgetModal(false)}
      >
        <Pressable
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
          onPress={() => setBudgetModal(false)}
        >
          <Pressable style={[styles.modalBox, { backgroundColor: colors.bgSecondary, borderColor: colors.pillBorder }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>תקציב יומי (₪)</Text>
            <TextInput
              value={budgetInput}
              onChangeText={setBudgetInput}
              keyboardType="decimal-pad"
              placeholder="למשל 120"
              placeholderTextColor={colors.textMuted}
              style={[styles.modalInput, { borderColor: colors.inputBorder, color: colors.text }]}
              textAlign="right"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setBudgetModal(false)}>
                <Text style={[styles.modalCancel, { color: colors.textSecondary }]}>ביטול</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => void submitBudget()}>
                <Text style={styles.modalOk}>שמור</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function MetricBox({ label, value, isDesktop }: { label: string; value: string; isDesktop?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.metricBox, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }, isDesktop && { width: "auto", minWidth: 0, flex: 1 }]}>
      <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const isActive = status === "ACTIVE";
  const isPaused = status === "PAUSED";
  const bgColor = isActive
    ? "rgba(34, 197, 94, 0.15)"
    : isPaused
      ? "rgba(251, 191, 36, 0.15)"
      : "rgba(255, 255, 255, 0.08)";
  const textColor = isActive ? "#22C55E" : isPaused ? "#FBBF24" : "#9CA3AF";
  return (
    <View style={[styles.statusPill, { backgroundColor: bgColor }]}>
      <Text style={[styles.statusPillText, { color: textColor }]}>{status}</Text>
    </View>
  );
}

function ActionChip({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.actionChip, { backgroundColor: colors.pillBg, borderColor: colors.pillBorder }, disabled && styles.actionChipDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <Text style={[styles.actionChipText, { color: colors.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F17" },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  backBtn: { padding: 10 },
  backIcon: { color: "#F3F6FF", fontSize: 22, fontWeight: "700" },
  headerTitle: {
    flex: 1,
    color: "#F3F6FF",
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
    writingDirection: "rtl",
  },
  headerSpacer: { width: 42 },
  scroll: { padding: 18, paddingBottom: 40 },
  loadingHint: {
    marginTop: 12,
    color: "rgba(243,246,255,0.6)",
    fontSize: 14,
    writingDirection: "rtl",
  },
  errText: {
    color: "#FCA5A5",
    fontSize: 15,
    textAlign: "center",
    writingDirection: "rtl",
    marginBottom: 12,
  },
  link: { color: "#5B8CFF", fontSize: 15, fontWeight: "700" },
  rangeRow: {
    flexDirection: "row-reverse",
    gap: 8,
    marginBottom: 16,
    justifyContent: "flex-end",
  },
  rangeChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  rangeChipOn: {
    backgroundColor: "rgba(47, 107, 255, 0.25)",
    borderColor: "rgba(91, 140, 255, 0.45)",
  },
  rangeChipText: {
    color: "rgba(243,246,255,0.75)",
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  rangeChipTextOn: { color: "#F3F6FF" },
  warn: {
    color: "rgba(251, 191, 36, 0.95)",
    fontSize: 12,
    marginBottom: 12,
    textAlign: "right",
    writingDirection: "rtl",
  },
  metricsGrid: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 20,
  },
  metricBox: {
    width: "31%",
    minWidth: 100,
    flexGrow: 1,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  metricValue: {
    color: "#F3F6FF",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  metricLabel: {
    marginTop: 4,
    color: "rgba(243,246,255,0.55)",
    fontSize: 11,
    textAlign: "right",
    writingDirection: "rtl",
  },
  sectionTitle: {
    color: "#EAF0FF",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 10,
    marginTop: 8,
    textAlign: "right",
    writingDirection: "rtl",
  },
  chartCard: {
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 8,
  },
  chartRow: {
    flexDirection: "row-reverse",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 4,
    minHeight: 118,
  },
  chartBarWrap: { flex: 1, alignItems: "center", maxWidth: 44 },
  chartBarTrack: {
    width: "75%",
    maxWidth: 22,
    height: 88,
    justifyContent: "flex-end",
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  chartBarFill: {
    width: "100%",
    borderRadius: 6,
    backgroundColor: "rgba(91, 140, 255, 0.88)",
    minHeight: 4,
  },
  chartDayLabel: {
    marginTop: 6,
    fontSize: 9,
    color: "rgba(243,246,255,0.5)",
    textAlign: "center",
  },
  chartEmpty: {
    color: "rgba(243,246,255,0.55)",
    fontSize: 14,
    textAlign: "right",
    writingDirection: "rtl",
  },
  tableCard: {
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingVertical: 4,
    marginBottom: 16,
  },
  tableEmpty: {
    padding: 16,
    color: "rgba(243,246,255,0.5)",
    fontSize: 14,
    textAlign: "right",
    writingDirection: "rtl",
  },
  tableRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  tableRowBorder: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  tableCellMain: {
    flex: 1,
    color: "#F3F6FF",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
    writingDirection: "rtl",
  },
  tableCell: {
    color: "rgba(243,246,255,0.65)",
    fontSize: 12,
    textAlign: "left",
    writingDirection: "rtl",
  },
  agentBtn: {
    marginTop: 8,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#2F6BFF",
    alignItems: "center",
    justifyContent: "center",
  },
  agentBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  actionsRow: {
    marginTop: 16,
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "flex-end",
  },
  actionChip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  actionChipDisabled: { opacity: 0.5 },
  actionChipText: {
    color: "#EAF0FF",
    fontSize: 14,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 24,
  },
  modalBox: {
    backgroundColor: "#151a26",
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  modalTitle: {
    color: "#F3F6FF",
    fontSize: 17,
    fontWeight: "800",
    textAlign: "right",
    marginBottom: 12,
    writingDirection: "rtl",
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    padding: 14,
    color: "#F3F6FF",
    fontSize: 17,
    marginBottom: 18,
  },
  modalActions: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
  },
  modalCancel: { color: "rgba(243,246,255,0.6)", fontSize: 16 },
  modalOk: { color: "#5B8CFF", fontSize: 16, fontWeight: "800" },
  tabBar: {
    flexDirection: "row-reverse",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  tabItemActive: {
    borderBottomColor: "#5B8CFF",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    writingDirection: "rtl",
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  adsetCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  adsetHeader: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  adsetName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
    marginLeft: 8,
  },
  adsetDetails: {
    gap: 6,
  },
  adsetDetail: {
    fontSize: 13,
    textAlign: "right",
    writingDirection: "rtl",
  },
  adCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    overflow: "hidden",
  },
  adsGrid: { gap: 14 },
  fbAdCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  fbAdHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    padding: 12,
    paddingBottom: 6,
  },
  fbPageAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  fbPageAvatarText: { color: "#FFF", fontSize: 16, fontWeight: "800" },
  fbPageName: { fontSize: 13, fontWeight: "700", writingDirection: "rtl" },
  fbSponsored: { fontSize: 11, fontWeight: "500", writingDirection: "rtl" },
  fbBody: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
    paddingHorizontal: 12,
    paddingBottom: 8,
    writingDirection: "rtl",
    textAlign: "right",
  },
  fbImage: { width: "100%", aspectRatio: 1.0 },
  fbImagePlaceholder: {
    width: "100%",
    aspectRatio: 1.0,
    alignItems: "center",
    justifyContent: "center",
  },
  fbLinkBar: {
    flexDirection: "row-reverse",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderTopWidth: 1,
  },
  fbHeadline: { fontSize: 14, fontWeight: "700", writingDirection: "rtl", textAlign: "right" },
  fbDescription: { fontSize: 12, fontWeight: "500", writingDirection: "rtl", textAlign: "right", marginTop: 1 },
  fbCtaBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "rgba(79,110,247,0.15)",
  },
  fbCtaBtnText: { color: "#4F6EF7", fontSize: 13, fontWeight: "800" },
  fbStatusRow: { paddingHorizontal: 12, paddingVertical: 8, alignItems: "flex-end" },
  adImage: {
    width: "100%",
    aspectRatio: 1.91,
    borderRadius: 12,
    marginBottom: 10,
  },
  adImagePlaceholder: {
    width: "100%",
    aspectRatio: 1.91,
    borderRadius: 12,
    marginBottom: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  adTitle: {
    fontSize: 15,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
    marginTop: 8,
  },
  adBody: {
    fontSize: 13,
    textAlign: "right",
    writingDirection: "rtl",
    marginTop: 4,
    lineHeight: 20,
  },
});
