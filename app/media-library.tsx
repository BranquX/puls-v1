import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useBusiness } from "../contexts/business-context";
import { useTheme } from "../contexts/theme-context";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { fetchAdchatApi } from "../lib/fetch-adchat-api";
import { Shimmer } from "../components/Shimmer";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

type MediaItem = {
  id: string;
  business_id: string;
  user_id: string | null;
  image_base64: string;
  mime_type: string | null;
  title: string | null;
  prompt: string | null;
  agent: string | null;
  campaign_context: string | null;
  created_at: string;
};

function formatIso(iso: string): string {
  const s = String(iso || "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 16);
  return d.toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dataUriFor(item: MediaItem): string {
  const mt = (item.mime_type || "image/png").trim() || "image/png";
  return `data:${mt};base64,${item.image_base64}`;
}

function skeletonItems(n: number) {
  return Array.from({ length: n }).map((_, i) => ({ id: `sk-${i}` }));
}

export default function MediaLibraryScreen() {
  const router = useRouter();
  const { business, loading } = useBusiness();
  const { colors } = useTheme();
  const { isDesktop, mediaColumns } = useResponsiveLayout();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [viewer, setViewer] = useState<MediaItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (!business?.id || inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const res = await fetchAdchatApi(
        `${API_BASE}/api/media-library?business_id=${encodeURIComponent(business.id)}`,
      );
      const json = (await res.json().catch(() => ({}))) as {
        items?: MediaItem[];
        error?: string;
      };
      if (res.status === 401) { router.replace("/auth"); return; }
      if (!res.ok) throw new Error(json.error || "טעינת ספרייה נכשלה");
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch {
      setError("אין חיבור לאינטרנט. בדוק את החיבור ונסה שוב.");
      setItems([]);
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  }, [business?.id]);

  useEffect(() => {
    if (loading) return;
    void load();
  }, [loading, load]);

  const onDelete = useCallback(
    (id: string) => {
      Alert.alert("מחיקה", "למחוק את התמונה?", [
        { text: "ביטול", style: "cancel" },
        {
          text: "מחק",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                const res = await fetchAdchatApi(
                  `${API_BASE}/api/media-library/${encodeURIComponent(id)}`,
                  { method: "DELETE" },
                );
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                  Alert.alert("שגיאה", json.error || "מחיקה נכשלה");
                  return;
                }
                setItems((prev) => prev.filter((x) => x.id !== id));
                if (viewer?.id === id) setViewer(null);
              } catch (e) {
                Alert.alert("שגיאה", e instanceof Error ? e.message : "מחיקה נכשלה");
              }
            })();
          },
        },
      ]);
    },
    [viewer?.id],
  );

  const onShare = useCallback((item: MediaItem) => {
    const uri = dataUriFor(item);
    void (async () => {
      try {
        if (Platform.OS === "ios") {
          await Share.share({ url: uri });
        } else {
          await Share.share({ message: uri });
        }
      } catch {
        Alert.alert("שיתוף", "לא ניתן לפתוח את תפריט השיתוף.");
      }
    })();
  }, []);

  const onDownload = useCallback((item: MediaItem) => {
    // כרגע: Data URI (עובד טוב בווב, ובמובייל דרך Share/Save במסך הצ׳אט).
    // אפשר לשדרג להורדה כקובץ דרך expo-file-system בסבב הבא.
    onShare(item);
  }, [onShare]);

  const header = useMemo(() => {
    return (
      <View style={[styles.header, { borderBottomColor: colors.cardBorder, backgroundColor: colors.cardBg }]}>
        <TouchableOpacity
          style={[styles.headerBtn, { borderColor: colors.inputBorder, backgroundColor: colors.inputBg }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="חזרה"
          activeOpacity={0.85}
        >
          <Text style={[styles.headerBtnText, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          {business?.brand_logo ? (
            <Image
              source={{ uri: business.brand_logo }}
              style={[styles.headerLogo, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}
              resizeMode="cover"
            />
          ) : null}
          <Text style={[styles.headerTitle, { color: colors.text }, isDesktop && { fontSize: 20 }]}>ספרייה</Text>
        </View>
        <TouchableOpacity
          style={[styles.headerBtn, styles.headerPrimary]}
          onPress={() =>
            router.push({ pathname: "/(tabs)/chat", params: { seedMessage: "צור גרפיקה" } })
          }
          accessibilityRole="button"
          accessibilityLabel="צור גרפיקה חדשה"
          activeOpacity={0.85}
        >
          <Text style={styles.headerPrimaryText}>צור גרפיקה חדשה</Text>
        </TouchableOpacity>
      </View>
    );
  }, [router, business?.brand_logo, colors]);

  if (loading || !business) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <LinearGradient colors={[colors.bg, colors.bgSecondary]} style={styles.gradient}>
          {header}
          <View style={styles.center}>
            <ActivityIndicator color="#5B8CFF" />
            <Text style={[styles.hint, { color: colors.textSecondary }]}>טוען…</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={[colors.bg, colors.bgSecondary]} style={styles.gradient}>
        {header}

        {busy ? (
          <FlatList
            data={skeletonItems(8)}
            keyExtractor={(x) => x.id}
            key={`skel-${mediaColumns}`}
            numColumns={mediaColumns}
            contentContainerStyle={[styles.grid, { paddingHorizontal: isDesktop ? "5%" : 14 }]}
            columnWrapperStyle={styles.colWrap}
            renderItem={() => (
              <View style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
                <Shimmer height={isDesktop ? 220 : 160} borderRadius={10} style={{ width: "100%" }} />
                <View style={{ padding: 10, gap: 6 }}>
                  <Shimmer width="60%" height={12} />
                  <Shimmer width="40%" height={10} />
                </View>
              </View>
            )}
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(x) => x.id}
            key={`main-${mediaColumns}`}
            numColumns={mediaColumns}
            contentContainerStyle={[styles.grid, { paddingHorizontal: isDesktop ? "5%" : 14 }]}
            columnWrapperStyle={styles.colWrap}
            ListEmptyComponent={
              error ? (
                <View style={styles.empty}>
                  <Text style={{ fontSize: 36 }}>⚠️</Text>
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>שגיאה בטעינה</Text>
                  <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>{error}</Text>
                  <Pressable
                    style={[styles.retryBtn]}
                    onPress={() => void load()}
                  >
                    <Text style={styles.retryBtnText}>נסה שוב</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.empty}>
                  <Text style={{ fontSize: 36 }}>🎨</Text>
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>הספרייה ריקה</Text>
                  <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                    בקש ממאיה ליצור גרפיקה בצ׳אט והיא תופיע כאן אוטומטית
                  </Text>
                  <Pressable
                    style={[styles.retryBtn]}
                    onPress={() => router.push({ pathname: "/(tabs)/chat", params: { seedMessage: "צרי לי גרפיקה" } })}
                  >
                    <Text style={styles.retryBtnText}>צור גרפיקה עם מאיה</Text>
                  </Pressable>
                </View>
              )
            }
            renderItem={({ item }) => (
              <Pressable
                style={[styles.card, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}
                onPress={() => setViewer(item)}
                accessibilityRole="button"
                accessibilityLabel={item.title || "תמונה"}
              >
                <Image
                  source={{ uri: dataUriFor(item) }}
                  style={[styles.thumb, isDesktop && { height: 220 }]}
                  resizeMode="cover"
                />
                <View style={styles.overlayTop}>
                  <Text style={styles.dateText}>{formatIso(item.created_at)}</Text>
                </View>
                <View style={styles.overlayBtns}>
                  <TouchableOpacity
                    style={[styles.overlayBtn, { borderColor: colors.inputBorder }]}
                    onPress={() => onDownload(item)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="הורד"
                  >
                    <Text style={[styles.overlayBtnText, { color: colors.text }]}>⬇︎</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.overlayBtn, { borderColor: colors.inputBorder }]}
                    onPress={() => onShare(item)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="שתף"
                  >
                    <Text style={[styles.overlayBtnText, { color: colors.text }]}>↗︎</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.overlayBtn, styles.overlayBtnDanger]}
                    onPress={() => onDelete(item.id)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="מחק"
                  >
                    <Text style={[styles.overlayBtnText, { color: colors.text }]}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            )}
          />
        )}

        <Modal visible={viewer != null} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
          <View style={[styles.viewerBackdrop, { backgroundColor: colors.overlay }]}>
            <View style={[styles.viewerCard, { backgroundColor: colors.bg, borderColor: colors.cardBorder }]}>
              {viewer ? (
                <>
                  <Image source={{ uri: dataUriFor(viewer) }} style={styles.viewerImg} resizeMode="contain" />
                  <View style={[styles.viewerBar, { borderTopColor: colors.separator }]}>
                    <Text style={[styles.viewerMeta, { color: colors.textSecondary }]}>{formatIso(viewer.created_at)}</Text>
                    <View style={styles.viewerActions}>
                      <TouchableOpacity style={[styles.viewerBtn, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]} onPress={() => onShare(viewer)} activeOpacity={0.85}>
                        <Text style={[styles.viewerBtnText, { color: colors.text }]}>שתף</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.viewerBtn, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]} onPress={() => onDownload(viewer)} activeOpacity={0.85}>
                        <Text style={[styles.viewerBtnText, { color: colors.text }]}>הורד</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.viewerBtn, styles.viewerBtnDanger, { backgroundColor: colors.inputBg }]}
                        onPress={() => onDelete(viewer.id)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.viewerBtnText, { color: colors.text }]}>מחק</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              ) : null}
              <TouchableOpacity style={[styles.viewerClose, { backgroundColor: colors.cardBg, borderTopColor: colors.separator }]} onPress={() => setViewer(null)} activeOpacity={0.85}>
                <Text style={[styles.viewerCloseText, { color: colors.text }]}>סגור</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F17" },
  gradient: { flex: 1 },
  header: {
    height: 56,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  headerCenter: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerLogo: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  headerTitle: {
    color: "#F3F6FF",
    fontSize: 16,
    fontWeight: "900",
    writingDirection: "rtl",
  },
  headerBtn: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnText: { color: "#F3F6FF", fontSize: 16, fontWeight: "900" },
  headerPrimary: {
    backgroundColor: "#4F6EF7",
    borderColor: "rgba(37,99,235,0.55)",
  },
  headerPrimaryText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    writingDirection: "rtl",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  hint: { color: "rgba(243,246,255,0.65)", fontWeight: "700" },
  grid: { paddingVertical: 14, paddingHorizontal: 14, paddingBottom: 28 },
  colWrap: { gap: 12 },
  card: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 12,
    minHeight: 180,
  },
  thumb: { width: "100%", height: 180, backgroundColor: "rgba(0,0,0,0.25)" },
  overlayTop: {
    position: "absolute",
    top: 8,
    left: 8,
    right: 8,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  dateText: {
    color: "rgba(243,246,255,0.85)",
    fontSize: 11,
    fontWeight: "900",
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    overflow: "hidden",
  },
  overlayBtns: {
    position: "absolute",
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  overlayBtn: {
    flex: 1,
    height: 34,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  overlayBtnDanger: {
    borderColor: "rgba(239,68,68,0.35)",
  },
  overlayBtnText: { color: "#F3F6FF", fontSize: 14, fontWeight: "900" },
  empty: { paddingTop: 30, alignItems: "flex-end" },
  emptyTitle: {
    color: "#F3F6FF",
    fontSize: 16,
    fontWeight: "900",
    writingDirection: "rtl",
  },
  emptyBody: {
    marginTop: 8,
    color: "rgba(243,246,255,0.65)",
    fontSize: 13,
    lineHeight: 20,
    writingDirection: "rtl",
    textAlign: "right",
    maxWidth: 360,
  },
  skelThumb: { height: 180, backgroundColor: "rgba(255,255,255,0.06)" },
  skelLine: {
    height: 12,
    marginTop: 10,
    marginHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  viewerCard: {
    width: "100%",
    maxWidth: 720,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#0B0F17",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  viewerImg: { width: "100%", height: 420, backgroundColor: "rgba(0,0,0,0.35)" },
  viewerBar: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    gap: 10,
  },
  viewerMeta: { color: "rgba(243,246,255,0.7)", fontWeight: "800" },
  viewerActions: { flexDirection: "row-reverse", gap: 10 },
  viewerBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  viewerBtnDanger: {
    borderColor: "rgba(239,68,68,0.35)",
  },
  viewerBtnText: { color: "#F3F6FF", fontWeight: "900", writingDirection: "rtl" },
  viewerClose: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  viewerCloseText: { color: "#F3F6FF", fontWeight: "900", writingDirection: "rtl" },
  retryBtn: { marginTop: 12, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: "#4F6EF7" },
  retryBtnText: { color: "#FFF", fontSize: 14, fontWeight: "800" },
});

