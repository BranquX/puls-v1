import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
  useWindowDimensions,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBusiness } from "../contexts/business-context";
import { useTheme } from "../contexts/theme-context";
import { fetchAdchatApi } from "../lib/fetch-adchat-api";
import { supabase } from "../lib/supabase";
import { normalizeWebsiteUrl, formatScrapeSummary } from "../lib/website-utils";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

const AGENTS = [
  { key: "dana", name: "דנה", emoji: "👩‍💼", role: "אסטרטגיה", avatar: "https://i.pravatar.cc/150?img=47" },
  { key: "yoni", name: "יוני", emoji: "✍️", role: "קופי", avatar: "https://i.pravatar.cc/150?img=33" },
  { key: "ron", name: "רון", emoji: "📊", role: "אנליטיקה", avatar: "https://i.pravatar.cc/150?img=12" },
  { key: "maya", name: "מאיה", emoji: "🎨", role: "קריאייטיב", avatar: "https://i.pravatar.cc/150?img=45" },
  { key: "noa", name: "נועה", emoji: "📱", role: "סושיאל", avatar: "https://i.pravatar.cc/150?img=44" },
] as const;

type Phase = "welcome" | "url" | "scraping" | "summary" | "manual" | "corrections";

function formatScrapeSummaryWithIntro(data: Record<string, unknown>): string {
  return `סרקתי את האתר שלך! הנה מה שמצאתי:\n\n${formatScrapeSummary(data)}\n\nזה נכון? יש משהו לתקן או להוסיף?`;
}

async function upsertMemory(
  businessId: string,
  category: string,
  key: string,
  value: string,
  source: string,
) {
  await fetchAdchatApi(`${API_BASE}/api/client-memory`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      business_id: businessId,
      category,
      key,
      value,
      source,
      confidence: 95,
    }),
  });
}

function Progress({ step, total, colors }: { step: number; total: number; colors: ReturnType<typeof useTheme>["colors"] }) {
  const pct = total <= 0 ? 0 : Math.max(0, Math.min(1, step / total));
  return (
    <View style={styles.progressWrap}>
      <View style={[styles.progressTrack, { backgroundColor: colors.inputBorder }]}>
        <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
      <Text style={[styles.progressText, { color: colors.textMuted }]}>
        {step}/{total}
      </Text>
    </View>
  );
}

function Confetti({ play }: { play: boolean }) {
  const { width } = useWindowDimensions();
  const parts = useMemo(() => {
    const colors = ["#60A5FA", "#A78BFA", "#F59E0B", "#22C55E", "#F472B6"];
    return Array.from({ length: 22 }).map((_, i) => {
      const x = Math.random() * (width - 40) + 20;
      const delay = Math.random() * 350;
      const size = 6 + Math.random() * 6;
      const color = colors[i % colors.length];
      return { x, delay, size, color };
    });
  }, [width]);

  const anim = useRef(parts.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!play) return;
    const runs = anim.map((a, idx) =>
      Animated.timing(a, {
        toValue: 1,
        duration: 900 + idx * 10,
        delay: parts[idx]?.delay ?? 0,
        useNativeDriver: true,
      }),
    );
    Animated.stagger(10, runs).start(() => {
      for (const a of anim) a.setValue(0);
    });
  }, [play, anim, parts]);

  if (!play) return null;

  return (
    <View pointerEvents="none" style={styles.confettiLayer}>
      {parts.map((p, i) => {
        const t = anim[i] ?? new Animated.Value(0);
        const translateY = t.interpolate({
          inputRange: [0, 1],
          outputRange: [-10, 220],
        });
        const rotate = t.interpolate({
          inputRange: [0, 1],
          outputRange: ["0deg", "240deg"],
        });
        const opacity = t.interpolate({
          inputRange: [0, 0.15, 1],
          outputRange: [0, 1, 0],
        });
        return (
          <Animated.View
            key={i}
            style={[
              styles.confettiPiece,
              {
                left: p.x,
                width: p.size,
                height: p.size,
                backgroundColor: p.color,
                opacity,
                transform: [{ translateY }, { rotate }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { business, loading, refresh } = useBusiness();
  const { colors } = useTheme();

  const [phase, setPhase] = useState<Phase>("welcome");
  const [urlInput, setUrlInput] = useState("");
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [scrapePayload, setScrapePayload] = useState<Record<string, unknown> | null>(null);
  const [correctionNotes, setCorrectionNotes] = useState("");
  const [correctionDraft, setCorrectionDraft] = useState("");
  const [manualQ1, setManualQ1] = useState("");
  const [manualQ2, setManualQ2] = useState("");
  const [manualQ3, setManualQ3] = useState("");
  const [saving, setSaving] = useState(false);

  const slide = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const dirRef = useRef<1 | -1>(1);

  useEffect(() => {
    if (loading) return;
    if (business && phase === "welcome" && !businessId) {
      router.replace("/");
    }
  }, [loading, business, router, phase, businessId]);

  useEffect(() => {
    if (phase !== "welcome") return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
  }, [phase, fade]);

  useEffect(() => {
    slide.setValue(dirRef.current * width);
    Animated.timing(slide, { toValue: 0, duration: 260, useNativeDriver: true }).start();
  }, [phase, width, slide]);

  const goWelcomeToUrl = useCallback(() => {
    dirRef.current = 1;
    setPhase("url");
  }, []);

  const goBack = useCallback(() => {
    dirRef.current = -1;
    if (phase === "url") setPhase("welcome");
    else if (phase === "manual") setPhase("url");
    else if (phase === "corrections") setPhase("summary");
    else if (phase === "summary") setPhase("url");
  }, [phase]);

  const ensureBusinessForUrl = useCallback(async (): Promise<string | null> => {
    const { data: authData } = await supabase.auth.getSession();
    const uid = authData.session?.user?.id ?? null;
    if (!uid) {
      Alert.alert("", "נא להתחבר מחדש");
      return null;
    }
    const normalized = normalizeWebsiteUrl(urlInput);
    const { data: inserted, error } = await supabase
      .from("businesses")
      .insert({
        user_id: uid,
        name: "עסק חדש",
        industry: "—",
        website: normalized || null,
      })
      .select("id")
      .single();
    if (error || !inserted?.id) {
      Alert.alert("שגיאה", error?.message || "לא ניתן ליצור עסק");
      return null;
    }
    return String(inserted.id);
  }, [urlInput]);

  const runScrape = useCallback(async () => {
    const normalized = normalizeWebsiteUrl(urlInput);
    if (!normalized) {
      Alert.alert("", "נא להזין כתובת אתר תקינה");
      return;
    }
    setSaving(true);
    setPhase("scraping");
    try {
      const bid = businessId || (await ensureBusinessForUrl());
      if (!bid) {
        setPhase("url");
        return;
      }
      setBusinessId(bid);
      const res = await fetchAdchatApi(`${API_BASE}/api/scrape-website`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: normalized, business_id: bid }),
      });
      const raw = await res.text().catch(() => "");
      const json = JSON.parse(raw || "{}") as {
        data?: Record<string, unknown>;
        error?: string;
      };
      if (!res.ok) {
        Alert.alert("סריקה נכשלה", json.error || raw || "נסה שוב");
        setPhase("url");
        return;
      }
      if (!json.data || typeof json.data !== "object") {
        Alert.alert("", "לא התקבלו נתונים מהסריקה");
        setPhase("url");
        return;
      }
      setScrapePayload(json.data);
      setPhase("summary");
    } catch (e) {
      Alert.alert("", e instanceof Error ? e.message : "שגיאה");
      setPhase("url");
    } finally {
      setSaving(false);
    }
  }, [urlInput, businessId, ensureBusinessForUrl]);

  const goManual = useCallback(() => {
    dirRef.current = 1;
    setPhase("manual");
  }, []);

  const saveManualAndFinish = useCallback(async () => {
    const a = manualQ1.trim();
    const b = manualQ2.trim();
    const c = manualQ3.trim();
    if (a.length < 4 || b.length < 4) {
      Alert.alert("", "נא למלא לפחות את שני השדות הראשונים");
      return;
    }
    setSaving(true);
    try {
      const { data: authData } = await supabase.auth.getSession();
      const uid = authData.session?.user?.id ?? null;
      if (!uid) {
        Alert.alert("", "נא להתחבר מחדש");
        return;
      }
      let bid = businessId;
      if (!bid) {
        const { data: inserted, error } = await supabase
          .from("businesses")
          .insert({
            user_id: uid,
            name: a.split(/[,\n]/)[0]?.trim() || "עסק חדש",
            industry: "—",
            website: null,
          })
          .select("id")
          .single();
        if (error || !inserted?.id) {
          Alert.alert("שגיאה", error?.message || "שמירה נכשלה");
          return;
        }
        bid = String(inserted.id);
        setBusinessId(bid);
      }

      await upsertMemory(bid, "business_profile", "business_overview", a, "manual_onboarding");
      await upsertMemory(bid, "audience", "ideal_customer", b, "manual_onboarding");
      await upsertMemory(bid, "goals", "primary_ad_goal", b, "manual_onboarding");
      if (c) await upsertMemory(bid, "goals", "monthly_budget", c, "manual_onboarding");
      await upsertMemory(bid, "insights", "active_campaigns", "לא ידוע", "manual_onboarding");
      await upsertMemory(bid, "brand", "competitive_advantage", "—", "manual_onboarding");
      await upsertMemory(bid, "business_profile", "manual_onboarding_done", "true", "manual_onboarding");

      await refresh();
      router.replace({
        pathname: "/(tabs)/chat",
        params: { seedMessage: "היי דנה, סיימתי את ההתחלה. מה הצעד הראשון?" },
      } as any);
    } finally {
      setSaving(false);
    }
  }, [manualQ1, manualQ2, manualQ3, businessId, refresh, router]);

  const confirmScrapeAndFinish = useCallback(async () => {
    const bid = businessId;
    if (!bid || !scrapePayload) return;
    setSaving(true);
    try {
      if (correctionNotes.trim()) {
        await upsertMemory(
          bid,
          "business_profile",
          "post_scrape_notes",
          correctionNotes.trim(),
          "onboarding",
        );
      }
      await upsertMemory(bid, "business_profile", "scrape_confirmed", "true", "onboarding");
      await refresh();
      router.replace({
        pathname: "/(tabs)/chat",
        params: { seedMessage: "היי דנה, אישרתי את הנתונים מהאתר. בואי נתחיל." },
      } as any);
    } finally {
      setSaving(false);
    }
  }, [businessId, scrapePayload, correctionNotes, refresh, router]);

  const applyCorrections = useCallback(() => {
    const t = correctionDraft.trim();
    if (!t) return;
    setCorrectionNotes((prev) => (prev ? `${prev}\n${t}` : t));
    setCorrectionDraft("");
    Alert.alert("", "עודכן — לחצי ״מושלם״ כשמוכנים להמשיך");
  }, [correctionDraft]);

  const progressStep =
    phase === "welcome"
      ? 0
      : phase === "url" || phase === "scraping"
        ? 1
        : phase === "summary" || phase === "corrections"
          ? 2
          : phase === "manual"
            ? 3
            : 0;
  const progressTotal = 3;

  const topBar = useMemo(() => {
    const showBack = phase !== "welcome";
    return (
      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <View style={styles.topBarRow}>
          <View style={{ width: 44, alignItems: "flex-start" }}>
            {showBack ? (
              <Pressable
                onPress={goBack}
                style={({ pressed }) => [styles.backBtn, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }, pressed && styles.backBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel="חזור"
                hitSlop={8}
              >
                <Text style={[styles.backBtnText, { color: colors.text }]}>→</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={[styles.topBarBrand, { color: colors.textSecondary }]}>Puls.</Text>
          <View style={{ width: 44 }} />
        </View>
        {phase !== "welcome" ? <Progress step={progressStep} total={progressTotal} colors={colors} /> : null}
      </View>
    );
  }, [insets.top, phase, goBack, progressStep, progressTotal, colors]);

  const screen = useMemo(() => {
    if (phase === "welcome") {
      return (
        <Animated.View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder, opacity: fade }]}>
          <View style={styles.logoBlock}>
            <Text style={[styles.logoMark, { color: colors.text }]}>Puls.</Text>
          </View>
          <Text style={[styles.h1, { color: colors.text }]}>הסוכנות הדיגיטלית שלך</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>צוות AI שעובד בשבילך 24/7</Text>

          <View style={styles.agentAvatarsRow}>
            {AGENTS.map((a) => (
              <Image key={a.key} source={{ uri: a.avatar }} style={[styles.agentAvatar, { borderColor: colors.inputBorder, borderWidth: 2 }]} />
            ))}
          </View>

          <Pressable
            onPress={goWelcomeToUrl}
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="בואו נתחיל"
          >
            <Text style={styles.primaryBtnText}>בואו נתחיל</Text>
          </Pressable>
        </Animated.View>
      );
    }

    if (phase === "url") {
      return (
        <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
          <Text style={[styles.h1, { color: colors.text }]}>כתובת האתר שלך</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>
            נסרוק את האתר ונמלא אוטומטית את הפרופיל. אם אין אתר — בחרי ״אין אתר״.
          </Text>

          <Text style={[styles.label, { color: colors.textSecondary }]}>אתר (URL)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
            value={urlInput}
            onChangeText={setUrlInput}
            placeholder="https://www.example.co.il"
            placeholderTextColor={colors.textMuted}
            textAlign="right"
            autoCapitalize="none"
            keyboardType="url"
            accessibilityLabel="כתובת אתר"
          />

          <Pressable
            onPress={() => void runScrape()}
            disabled={saving}
            style={({ pressed }) => [
              styles.primaryBtn,
              saving && styles.primaryBtnDisabled,
              pressed && styles.primaryBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="סריקת אתר"
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>סרוק את האתר</Text>
            )}
          </Pressable>

          <Pressable
            onPress={goManual}
            style={({ pressed }) => [styles.secondaryBtn, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }, pressed && styles.primaryBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="אין אתר"
          >
            <Text style={[styles.secondaryBtnText, { color: colors.text }]}>אין אתר — אמלא ידנית</Text>
          </Pressable>
        </View>
      );
    }

    if (phase === "scraping") {
      return (
        <View style={[styles.card, styles.centerCard, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
          <ActivityIndicator size="large" color="#60A5FA" />
          <Text style={[styles.h1, { marginTop: 20, color: colors.text }]}>סורק את האתר שלך…</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>🔍 זה לוקח כ-10 שניות</Text>
        </View>
      );
    }

    if (phase === "summary" && scrapePayload) {
      const summaryText = formatScrapeSummaryWithIntro(scrapePayload);
      return (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
            <Text style={[styles.h1, { color: colors.text }]}>אישור פרטים</Text>
            <Text style={[styles.summaryBody, { color: colors.text }]}>{summaryText}</Text>
            {correctionNotes ? (
              <Text style={styles.notesPreview}>הערות: {correctionNotes}</Text>
            ) : null}

            <Pressable
              onPress={() => void confirmScrapeAndFinish()}
              disabled={saving}
              style={({ pressed }) => [
                styles.primaryBtn,
                saving && styles.primaryBtnDisabled,
                pressed && styles.primaryBtnPressed,
              ]}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>מושלם, בואנו נתחיל! 🚀</Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => {
                dirRef.current = 1;
                setPhase("corrections");
              }}
              style={({ pressed }) => [styles.secondaryBtn, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }, pressed && styles.primaryBtnPressed]}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.text }]}>יש לי תיקונים</Text>
            </Pressable>
          </View>
        </ScrollView>
      );
    }

    if (phase === "corrections" && scrapePayload) {
      const summaryText = formatScrapeSummaryWithIntro(scrapePayload);
      return (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
            <Text style={[styles.h1, { color: colors.text }]}>תיקונים</Text>
            <Text style={[styles.summaryBody, { color: colors.text }]}>{summaryText}</Text>
            <Text style={[styles.label, { color: colors.textSecondary }]}>מה לתקן או להוסיף?</Text>
            <TextInput
              style={[styles.input, styles.multiline, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
              value={correctionDraft}
              onChangeText={setCorrectionDraft}
              placeholder="כתבי כאן…"
              placeholderTextColor={colors.textMuted}
              textAlign="right"
              multiline
            />
            <Pressable
              onPress={applyCorrections}
              style={({ pressed }) => [styles.secondaryBtn, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }, pressed && styles.primaryBtnPressed]}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.text }]}>עדכן</Text>
            </Pressable>
            <Pressable
              onPress={() => void confirmScrapeAndFinish()}
              disabled={saving}
              style={({ pressed }) => [
                styles.primaryBtn,
                saving && styles.primaryBtnDisabled,
                pressed && styles.primaryBtnPressed,
              ]}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>מושלם, בואנו נתחיל! 🚀</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      );
    }

    if (phase === "manual") {
      return (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
            <Confetti play />
            <Text style={[styles.h1, { color: colors.text }]}>בלי אתר — נשלים בקצרה</Text>
            <Text style={[styles.sub, { color: colors.textSecondary }]}>שלוש שאלות בלבד</Text>

            <Text style={[styles.label, { color: colors.textSecondary }]}>1. שם עסק, תחום ומה מוכרים</Text>
            <TextInput
              style={[styles.input, styles.multiline, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
              value={manualQ1}
              onChangeText={setManualQ1}
              placeholder="למשל: קפה נורמה — קפה בתל אביב"
              placeholderTextColor={colors.textMuted}
              textAlign="right"
              multiline
            />

            <Text style={[styles.label, { color: colors.textSecondary }]}>2. קהל יעד + מטרת פרסום</Text>
            <TextInput
              style={[styles.input, styles.multiline, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
              value={manualQ2}
              onChangeText={setManualQ2}
              placeholder="למשל: צעירים 25–40 בת״א — רוצים יותר לידים"
              placeholderTextColor={colors.textMuted}
              textAlign="right"
              multiline
            />

            <Text style={[styles.label, { color: colors.textSecondary }]}>3. תקציב חודשי (אופציונלי)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text }]}
              value={manualQ3}
              onChangeText={setManualQ3}
              placeholder="למשל: ₪ 3,000"
              placeholderTextColor={colors.textMuted}
              textAlign="right"
            />

            <Pressable
              onPress={() => void saveManualAndFinish()}
              disabled={saving}
              style={({ pressed }) => [
                styles.primaryBtn,
                saving && styles.primaryBtnDisabled,
                pressed && styles.primaryBtnPressed,
              ]}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>קחו אותי לדנה</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      );
    }

    return null;
  }, [
    phase,
    fade,
    urlInput,
    saving,
    runScrape,
    goManual,
    goWelcomeToUrl,
    scrapePayload,
    correctionDraft,
    correctionNotes,
    manualQ1,
    manualQ2,
    manualQ3,
    applyCorrections,
    confirmScrapeAndFinish,
    saveManualAndFinish,
    colors,
  ]);

  return (
    <LinearGradient colors={[colors.bg, colors.bgSecondary]} style={styles.safeArea}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: "transparent" }]}>
        <StatusBar barStyle={colors.statusBar} />
        {topBar}
        <KeyboardAvoidingView
          style={styles.body}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Animated.View style={[styles.slideWrap, { transform: [{ translateX: slide }] }]}>
            {screen}
          </Animated.View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },
  topBar: {
    paddingHorizontal: 16,
  },
  topBarRow: {
    height: 44,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topBarBrand: {
    color: "rgba(243,246,255,0.65)",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
    writingDirection: "rtl",
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  backBtnPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  backBtnText: { color: "#F3F6FF", fontSize: 18, fontWeight: "900" },

  progressWrap: {
    marginTop: 10,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    paddingBottom: 8,
  },
  progressTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "rgba(79,110,247,0.85)",
  },
  progressText: {
    color: "rgba(243,246,255,0.55)",
    fontSize: 12,
    fontWeight: "800",
    writingDirection: "rtl",
  },

  body: { flex: 1, paddingHorizontal: 16, paddingBottom: 20 },
  slideWrap: { flex: 1, justifyContent: "center" },
  scroll: { flex: 1, alignSelf: "stretch" },
  scrollContent: { paddingBottom: 24, flexGrow: 1, justifyContent: "center" },

  card: {
    borderRadius: 20,
    padding: 20,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  centerCard: { alignItems: "center", justifyContent: "center" },
  logoBlock: {
    height: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  logoMark: {
    color: "#F3F6FF",
    fontSize: 44,
    fontWeight: "900",
    letterSpacing: 1,
  },
  h1: {
    color: "#F3F6FF",
    fontSize: 26,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  sub: {
    marginTop: 10,
    color: "rgba(243,246,255,0.70)",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "right",
    writingDirection: "rtl",
  },
  summaryBody: {
    marginTop: 14,
    color: "rgba(243,246,255,0.88)",
    fontSize: 15,
    lineHeight: 24,
    textAlign: "right",
    writingDirection: "rtl",
  },
  notesPreview: {
    marginTop: 12,
    color: "rgba(147,197,253,0.95)",
    fontSize: 13,
    textAlign: "right",
    writingDirection: "rtl",
  },

  agentAvatarsRow: {
    marginTop: 18,
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    gap: 10,
  },
  agentAvatar: {
    flex: 1,
    height: 44,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  agentAvatarEmoji: { fontSize: 18 },

  label: {
    marginTop: 18,
    color: "rgba(243,246,255,0.78)",
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
  },
  input: {
    marginTop: 8,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    color: "#F3F6FF",
    fontSize: 15,
    writingDirection: "rtl",
  },
  multiline: { minHeight: 100, paddingTop: 12, textAlignVertical: "top" },

  primaryBtn: {
    marginTop: 20,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#4F6EF7",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    writingDirection: "rtl",
  },
  secondaryBtn: {
    marginTop: 12,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  secondaryBtnText: {
    color: "rgba(243,246,255,0.9)",
    fontSize: 15,
    fontWeight: "800",
    writingDirection: "rtl",
  },

  confettiLayer: {
    position: "absolute",
    top: 10,
    left: 0,
    right: 0,
    height: 240,
    overflow: "hidden",
  },
  confettiPiece: {
    position: "absolute",
    top: 0,
    borderRadius: 3,
  },
});
