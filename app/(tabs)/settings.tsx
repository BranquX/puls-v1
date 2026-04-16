import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
  Animated,
  Image,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  StatusBar,
} from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useRouter } from "expo-router";
import { useBusiness } from "../../contexts/business-context";
import { useTheme } from "../../contexts/theme-context";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { fetchAdchatApi } from "../../lib/fetch-adchat-api";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { normalizeWebsiteUrl, formatScrapeSummary } from "../../lib/website-utils";
import { Shimmer } from "../../components/Shimmer";

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

type BrandFont = "Modern" | "Classic" | "Bold" | "Minimal";
type TargetGender = "men" | "women" | "all";

type Competitor = { name: string; website?: string };

type ClientMemoryPayload = {
  business_id: string;
  by_category: Record<string, Record<string, string>>;
};

function memVal(
  mem: ClientMemoryPayload | null | undefined,
  category: string,
  key: string,
): string {
  const v = mem?.by_category?.[category]?.[key];
  return typeof v === "string" ? v.trim() : "";
}

function isHexColor(s: string): boolean {
  return /^#?[0-9a-f]{6}$/i.test(String(s || "").trim());
}

function normalizeHex(s: string): string {
  const t = String(s || "").trim();
  if (!t) return "";
  const h = t.startsWith("#") ? t : `#${t}`;
  return h.toUpperCase();
}

function ensureToneArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).map((s) => s.trim()).filter(Boolean).slice(0, 5);
}

function ensureCompetitors(v: unknown): Competitor[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === "object")
    .map((x: any) => ({
      name: String(x.name || "").trim(),
      website: x.website ? String(x.website).trim() : undefined,
    }))
    .filter((c) => c.name)
    .slice(0, 5);
}

const TABS = [
  { key: "profile", label: 'פרופיל 🏢' },
  { key: "brand", label: 'מותג 🎨' },
  { key: "audience", label: 'קהל 🎯' },
] as const;
type SettingsTab = (typeof TABS)[number]["key"];

const PALETTE = [
  "#4F6EF7",
  "#22C55E",
  "#F97316",
  "#EC4899",
  "#A855F7",
  "#F59E0B",
  "#EF4444",
  "#06B6D4",
  "#10B981",
  "#6366F1",
  "#111827",
  "#FFFFFF",
];

function toIntInRange(raw: string, min: number, max: number): number | null {
  const t = raw.replace(/[^\d]/g, "");
  if (!t) return null;
  const n = parseInt(t, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

export default function SettingsScreen() {
  const router = useRouter();
  const { business, loading: businessLoading, refresh } = useBusiness();
  const { mode, colors, toggle: toggleTheme } = useTheme();
  const { isDesktop } = useResponsiveLayout();
  const rawTabBarHeight = useBottomTabBarHeight();
  const tabBarHeight = isDesktop ? 0 : rawTabBarHeight;

  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("profile");
  const [toast, setToast] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [clientMemory, setClientMemory] = useState<ClientMemoryPayload | null>(
    null,
  );

  // Scrape
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<Record<string, unknown> | null>(null);
  const [scrapeModalOpen, setScrapeModalOpen] = useState(false);

  // Section 1: פרופיל עסקי
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");

  // Section 2: Brand Kit
  const [brandLogo, setBrandLogo] = useState<string>("");
  const [cPrimary, setCPrimary] = useState("#4F6EF7");
  const [cSecondary, setCSecondary] = useState("#22C55E");
  const [cText, setCText] = useState("#FFFFFF");
  const [brandFont, setBrandFont] = useState<BrandFont>("Modern");
  const [brandSecondaryFont, setBrandSecondaryFont] = useState("");
  const [brandTone, setBrandTone] = useState<string[]>([]);
  const [brandAvoid, setBrandAvoid] = useState("");
  const [stylePreference, setStylePreference] = useState("");
  const [colorPicker, setColorPicker] = useState<{
    open: boolean;
    key: "primary" | "secondary" | "text" | null;
  }>({ open: false, key: null });

  // Section 3: קהל יעד ומתחרים
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [gender, setGender] = useState<TargetGender>("all");
  const [geo, setGeo] = useState("");
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [differentiator, setDifferentiator] = useState("");

  const initialSnapshotRef = useRef<string>("");

  const [metaBusy, setMetaBusy] = useState(false);
  const [tokenExpiryWarning, setTokenExpiryWarning] = useState<{ days_left: number; expires_at: string } | null>(null);
  const [metaAssetsLoading, setMetaAssetsLoading] = useState(false);
  const [metaAdAccounts, setMetaAdAccounts] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [metaPages, setMetaPages] = useState<Array<{ id: string; name: string }>>([]);
  const [metaInstagram, setMetaInstagram] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [selectedAdAccountId, setSelectedAdAccountId] = useState<string>("");
  const [selectedPageId, setSelectedPageId] = useState<string>("");
  const [selectedInstagramId, setSelectedInstagramId] = useState<string>("");
  const [picker, setPicker] = useState<{
    open: boolean;
    type: "adaccounts" | "pages" | "instagram" | null;
  }>({ open: false, type: null });
  const [pickerSearch, setPickerSearch] = useState("");
  const [assetConfirm, setAssetConfirm] = useState<{
    open: boolean;
    type: "adaccounts" | "pages" | "instagram" | "disconnect" | null;
    asset: { id: string; name: string } | null;
    prevName: string;
  }>({ open: false, type: null, asset: null, prevName: "" });
  const metaPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metaPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const metaUserLabel = useMemo(() => {
    const maybeName = String((business as any)?.meta_user_name || "").trim();
    if (maybeName) return maybeName;
    const id = String(business?.meta_user_id || "").trim();
    if (!id) return "";
    return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
  }, [business?.meta_user_id, (business as any)?.meta_user_name]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "adchat-meta-oauth" && event.data.ok) {
        // Clear polling since connection succeeded via postMessage
        if (metaPollIntervalRef.current) {
          clearInterval(metaPollIntervalRef.current);
          metaPollIntervalRef.current = null;
        }
        if (metaPollTimeoutRef.current) {
          clearTimeout(metaPollTimeoutRef.current);
          metaPollTimeoutRef.current = null;
        }
        setMetaBusy(false);
        void refresh();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [refresh]);

  const onConnectMeta = useCallback(async () => {
    if (!business?.id) return;
    setMetaBusy(true);

    // On web: detect mobile by viewport width (popup blockers are aggressive on mobile)
    const isWeb = Platform.OS === "web" && typeof window !== "undefined";
    const isMobileWeb = isWeb && window.innerWidth < 768;

    // Open window SYNCHRONOUSLY (before await) to preserve the user-gesture chain.
    // Mobile browsers silently block window.open if it happens after an async call.
    let popup: Window | null = null;
    if (isWeb && !isMobileWeb) {
      popup = window.open("about:blank", "meta-oauth", "width=560,height=720,scrollbars=yes");
    }

    try {
      const res = await fetchAdchatApi(
        `${API_BASE}/auth/meta?business_id=${encodeURIComponent(business.id)}`,
      );
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        if (popup) popup.close();
        Alert.alert("שגיאה", json.error || "לא התקבלה כתובת OAuth");
        return;
      }

      if (isMobileWeb) {
        // Mobile web: full-page redirect (popups are unreliable)
        window.location.href = json.url;
        return;
      }

      if (isWeb) {
        // Desktop web: navigate the pre-opened popup
        if (!popup || popup.closed) {
          Alert.alert("", "נראה שהפופאפ נחסם. אפשרו פופאפים ונסו שוב.");
          return;
        }
        popup.location.href = json.url;

        // Poll until meta_user_id is set (or 2 minutes)
        if (metaPollIntervalRef.current) clearInterval(metaPollIntervalRef.current);
        if (metaPollTimeoutRef.current) clearTimeout(metaPollTimeoutRef.current);

        metaPollIntervalRef.current = setInterval(async () => {
          try {
            const { data } = await supabase
              .from("businesses")
              .select("meta_user_id")
              .eq("id", business.id)
              .single();
            if (data?.meta_user_id) {
              if (metaPollIntervalRef.current) clearInterval(metaPollIntervalRef.current);
              metaPollIntervalRef.current = null;
              if (metaPollTimeoutRef.current) clearTimeout(metaPollTimeoutRef.current);
              metaPollTimeoutRef.current = null;
              await refresh();
            }
          } catch {
            // ignore
          }
        }, 2000);

        metaPollTimeoutRef.current = setTimeout(() => {
          if (metaPollIntervalRef.current) clearInterval(metaPollIntervalRef.current);
          metaPollIntervalRef.current = null;
          metaPollTimeoutRef.current = null;
        }, 120000);
      } else {
        // Native app (iOS/Android)
        await Linking.openURL(json.url);
        Alert.alert(
          "המשך בדפדפן",
          "לאחר שתסיימו להתחבר, חזרו לאפליקציה — נבדוק את החיבור אוטומטית.",
        );
      }
    } catch (e) {
      if (popup) popup.close();
      Alert.alert("שגיאה", e instanceof Error ? e.message : "לא ניתן להתחבר ל‑Meta");
    } finally {
      setMetaBusy(false);
    }
  }, [business?.id, refresh]);

  const handleDisconnectMeta = useCallback(async () => {
    const confirmed =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.confirm("האם אתה בטוח שרוצה לנתק את פייסבוק?")
        : await new Promise<boolean>((resolve) =>
            Alert.alert("ניתוק פייסבוק", "האם אתה בטוח?", [
              { text: "ביטול", onPress: () => resolve(false), style: "cancel" },
              { text: "נתק", onPress: () => resolve(true), style: "destructive" },
            ]),
          );

    if (!confirmed) return;
    if (!business?.id) return;

    try {
      await fetchAdchatApi(`${API_BASE}/api/disconnect-meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: business?.id }),
      });
      await refresh();
    } catch (e) {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.alert("שגיאה בניתוק, נסה שוב");
      } else {
        Alert.alert("שגיאה", "לא הצלחנו לנתק, נסה שוב");
      }
    }
  }, [business?.id, refresh]);

  useEffect(() => {
    // Keep selected values in sync with business context
    if (!business) return;
    setSelectedAdAccountId(String((business as any).selected_ad_account_id || ""));
    setSelectedPageId(String((business as any).selected_page_id || ""));
    setSelectedInstagramId(String((business as any).selected_instagram_id || ""));
  }, [
    business?.id,
    (business as any)?.selected_ad_account_id,
    (business as any)?.selected_page_id,
    (business as any)?.selected_instagram_id,
  ]);

  const loadMetaAssets = useCallback(async () => {
    if (!business?.id) return;
    setMetaAssetsLoading(true);
    try {
      const bid = business.id;
      const aRes = await fetchAdchatApi(
        `${API_BASE}/api/meta-assets?business_id=${encodeURIComponent(bid)}&type=adaccounts`,
      );
      const aJson = (await aRes.json().catch(() => ({}))) as { assets?: Array<{ id: string; name?: string }>; error?: string };

      const pRes = await fetchAdchatApi(
        `${API_BASE}/api/meta-assets?business_id=${encodeURIComponent(bid)}&type=pages`,
      );
      const pJson = (await pRes.json().catch(() => ({}))) as { assets?: Array<{ id: string; name?: string }>; error?: string };

      const iRes = await fetchAdchatApi(
        `${API_BASE}/api/meta-assets?business_id=${encodeURIComponent(bid)}&type=instagram`,
      );
      const iJson = (await iRes.json().catch(() => ({}))) as { assets?: Array<{ id: string; name?: string }>; error?: string };

      setMetaAdAccounts(
        Array.isArray(aJson.assets)
          ? aJson.assets
              .map((x) => ({ id: String(x.id || ""), name: String(x.name || x.id || "") }))
              .filter((x) => x.id)
          : [],
      );
      setMetaPages(
        Array.isArray(pJson.assets)
          ? pJson.assets
              .map((x) => ({ id: String(x.id || ""), name: String(x.name || x.id || "") }))
              .filter((x) => x.id)
          : [],
      );
      setMetaInstagram(
        Array.isArray(iJson.assets)
          ? iJson.assets
              .map((x) => ({ id: String(x.id || ""), name: String(x.name || x.id || "") }))
              .filter((x) => x.id)
          : [],
      );
    } catch {
      setMetaAdAccounts([]);
      setMetaPages([]);
      setMetaInstagram([]);
    } finally {
      setMetaAssetsLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    if (business?.meta_user_id) {
      void loadMetaAssets();
      // Fetch token expiry warning
      void (async () => {
        try {
          const res = await fetchAdchatApi(
            `${API_BASE}/api/meta-context?business_id=${encodeURIComponent(business.id)}`,
          );
          const json = await res.json().catch(() => ({}));
          if (res.ok && json.token_expiry_warning) {
            setTokenExpiryWarning(json.token_expiry_warning);
          } else {
            setTokenExpiryWarning(null);
          }
        } catch {
          // ignore
        }
      })();
    }
  }, [business?.meta_user_id, business?.id, loadMetaAssets]);


  const handleDeleteAccount = async () => {
    const confirmed =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.confirm("האם אתה בטוח שרוצה למחוק את החשבון? כל המידע יימחק לצמיתות ולא ניתן לשחזר אותו.")
        : await new Promise<boolean>((resolve) =>
            Alert.alert(
              "מחיקת חשבון",
              "כל המידע יימחק לצמיתות ולא ניתן לשחזר אותו. להמשיך?",
              [
                { text: "ביטול", onPress: () => resolve(false), style: "cancel" },
                { text: "מחק לצמיתות", onPress: () => resolve(true), style: "destructive" },
              ],
            ),
          );

    if (!confirmed) return;

    try {
      const res = await fetchAdchatApi(`${API_BASE}/api/account`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = json.error || "מחיקה נכשלה";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("שגיאה", msg);
        return;
      }
      await AsyncStorage.clear();
      router.replace("/auth");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "מחיקה נכשלה";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("שגיאה", msg);
    }
  };

  const handleLogout = async () => {
    const confirmed =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.confirm("האם אתה בטוח שרוצה להתנתק?")
        : await new Promise<boolean>((resolve) =>
            Alert.alert("התנתקות", "האם אתה בטוח?", [
              { text: "ביטול", onPress: () => resolve(false), style: "cancel" },
              { text: "התנתק", onPress: () => resolve(true), style: "destructive" },
            ]),
          );

    if (!confirmed) return;

    try {
      await supabase.auth.signOut();
      await AsyncStorage.clear();
      router.replace("/auth");
    } catch (e) {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.alert("שגיאה בהתנתקות");
      } else {
        Alert.alert("שגיאה", "נסה שוב");
      }
    }
  };

  const snapshot = useMemo(() => {
    return JSON.stringify({
      name: name.trim(),
      industry: industry.trim(),
      website: website.trim(),
      phone: phone.trim(),
      address: address.trim(),
      description: description.trim(),
      brandLogo: brandLogo ? "__set__" : "",
      cPrimary: normalizeHex(cPrimary),
      cSecondary: normalizeHex(cSecondary),
      cText: normalizeHex(cText),
      brandFont,
      brandSecondaryFont: brandSecondaryFont.trim(),
      brandTone,
      brandAvoid: brandAvoid.trim(),
      stylePreference,
      ageMin,
      ageMax,
      gender,
      geo: geo.trim(),
      competitors: competitors
        .map((c) => ({ name: c.name.trim(), website: (c.website || "").trim() }))
        .filter((c) => c.name),
      differentiator: differentiator.trim(),
    });
  }, [
    name,
    industry,
    website,
    phone,
    address,
    description,
    brandLogo,
    cPrimary,
    cSecondary,
    cText,
    brandFont,
    brandSecondaryFont,
    brandTone,
    brandAvoid,
    stylePreference,
    ageMin,
    ageMax,
    gender,
    geo,
    competitors,
    differentiator,
  ]);

  const isDirty = initialSnapshotRef.current !== "" && snapshot !== initialSnapshotRef.current;

  useEffect(() => {
    if (businessLoading) return;
    if (!business) {
      return;
    }
    setName(String(business.name || ""));
    setIndustry(String(business.industry || ""));
    setWebsite(String(business.website || ""));
    setPhone(String((business as any).phone || ""));
    setAddress(String((business as any).address || ""));
    setDescription(String((business as any).description || ""));

    setBrandLogo(String((business as any).brand_logo || ""));
    const bc = (business as any).brand_colors;
    const primary = bc && typeof bc === "object" ? (bc as any).primary : null;
    const secondary = bc && typeof bc === "object" ? (bc as any).secondary : null;
    const text = bc && typeof bc === "object" ? (bc as any).text : null;
    setCPrimary(isHexColor(primary) ? normalizeHex(primary) : "#4F6EF7");
    setCSecondary(isHexColor(secondary) ? normalizeHex(secondary) : "#22C55E");
    setCText(isHexColor(text) ? normalizeHex(text) : "#FFFFFF");

    const bf = String((business as any).brand_font || "").trim() as BrandFont;
    setBrandFont((["Modern", "Classic", "Bold", "Minimal"] as const).includes(bf) ? bf : "Modern");
    setBrandSecondaryFont(String((business as any).brand_secondary_font || ""));
    setBrandTone(ensureToneArray((business as any).brand_tone));
    setBrandAvoid(String((business as any).brand_avoid || ""));
    setStylePreference(String((business as any).brand_style_preference || ""));

    const am = Number((business as any).target_age_min ?? 18);
    const ax = Number((business as any).target_age_max ?? 65);
    setAgeMin(Number.isFinite(am) ? Math.max(18, Math.min(65, Math.round(am))) : 18);
    setAgeMax(Number.isFinite(ax) ? Math.max(18, Math.min(65, Math.round(ax))) : 65);
    const g = String((business as any).target_gender || "all") as TargetGender;
    setGender(g === "men" || g === "women" || g === "all" ? g : "all");
    setGeo(String((business as any).target_geo || ""));
    const comps = ensureCompetitors((business as any).competitors);
    setCompetitors(comps);
    setDifferentiator(String((business as any).brand_differentiator || ""));

    // baseline ל-dirty
    requestAnimationFrame(() => {
      initialSnapshotRef.current = JSON.stringify({
        name: String(business.name || "").trim(),
        industry: String(business.industry || "").trim(),
        website: String(business.website || "").trim(),
        phone: String((business as any).phone || "").trim(),
        address: String((business as any).address || "").trim(),
        description: String((business as any).description || "").trim(),
        brandLogo: String((business as any).brand_logo || "").trim() ? "__set__" : "",
        cPrimary: normalizeHex(isHexColor(primary) ? primary : "#4F6EF7"),
        cSecondary: normalizeHex(isHexColor(secondary) ? secondary : "#22C55E"),
        cText: normalizeHex(isHexColor(text) ? text : "#FFFFFF"),
        brandFont:
          (["Modern", "Classic", "Bold", "Minimal"] as const).includes(bf)
            ? bf
            : "Modern",
        brandSecondaryFont: String((business as any).brand_secondary_font || "").trim(),
        brandTone: ensureToneArray((business as any).brand_tone),
        brandAvoid: String((business as any).brand_avoid || "").trim(),
        stylePreference: String((business as any).brand_style_preference || ""),
        ageMin: Number.isFinite(am) ? Math.max(18, Math.min(65, Math.round(am))) : 18,
        ageMax: Number.isFinite(ax) ? Math.max(18, Math.min(65, Math.round(ax))) : 65,
        gender: g === "men" || g === "women" || g === "all" ? g : "all",
        geo: String((business as any).target_geo || "").trim(),
        competitors: comps.map((c) => ({ name: c.name.trim(), website: (c.website || "").trim() })),
        differentiator: String((business as any).brand_differentiator || "").trim(),
      });
    });
  }, [business, businessLoading]);

  useEffect(() => {
    if (businessLoading) return;
    if (!business) {
      router.replace("/onboarding");
    }
  }, [businessLoading, business, router]);

  useEffect(() => {
    return () => {
      if (metaPollIntervalRef.current) clearInterval(metaPollIntervalRef.current);
      if (metaPollTimeoutRef.current) clearTimeout(metaPollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!business?.id) return;
    void (async () => {
      try {
        const res = await fetchAdchatApi(
          `${API_BASE}/api/client-memory?business_id=${encodeURIComponent(business.id)}`,
        );
        const json = (await res.json().catch(() => ({}))) as ClientMemoryPayload;
        if (res.ok && json && typeof json === "object") {
          setClientMemory({
            business_id: json.business_id || business.id,
            by_category: json.by_category || {},
          });
        }
      } catch {
        setClientMemory(null);
      }
    })();
  }, [business?.id]);

  const onPickLogo = useCallback(async () => {
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("", "צריך הרשאת גלריה כדי לבחור לוגו");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled) return;
    const a0 = result.assets && result.assets[0] ? result.assets[0] : null;
    if (!a0?.base64) {
      Alert.alert("", "לא הצלחתי לקרוא את התמונה כ-base64");
      return;
    }
    setBrandLogo(a0.base64);
  }, []);

  const toggleTone = useCallback((t: string) => {
    setBrandTone((prev) => {
      const on = prev.includes(t);
      const next = on ? prev.filter((x) => x !== t) : [...prev, t];
      return next.slice(0, 5);
    });
  }, []);

  const showToast = useCallback(
    (msg: string) => {
      setToast(msg);
      toastOpacity.setValue(0);
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start(() => {
        setTimeout(() => {
          Animated.timing(toastOpacity, {
            toValue: 0,
            duration: 220,
            useNativeDriver: true,
          }).start(() => setToast(null));
        }, 1100);
      });
    },
    [toastOpacity],
  );

  const saveSelectedAssets = useCallback(
    async (patch: {
      selected_ad_account_id?: string;
      selected_page_id?: string;
      selected_instagram_id?: string;
    }) => {
      if (!business?.id) return;
      try {
        const body = {
          business_id: business.id,
          selected_ad_account_id:
            patch.selected_ad_account_id ?? selectedAdAccountId ?? "",
          selected_page_id: patch.selected_page_id ?? selectedPageId ?? "",
          selected_instagram_id:
            patch.selected_instagram_id ?? selectedInstagramId ?? "",
        };
        await fetchAdchatApi(`${API_BASE}/api/meta-selected-assets`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        await refresh();
        showToast("נשמר ✓");
      } catch {
        Alert.alert("שגיאה", "לא הצלחנו לשמור. נסה שוב.");
      }
    },
    [business?.id, selectedAdAccountId, selectedPageId, selectedInstagramId, refresh, showToast],
  );

  // Auto-select when there's exactly 1 asset per type and nothing selected yet
  useEffect(() => {
    if (metaAssetsLoading || !business?.id) return;
    const patch: { selected_ad_account_id?: string; selected_page_id?: string; selected_instagram_id?: string } = {};
    if (metaAdAccounts.length === 1 && !selectedAdAccountId) {
      setSelectedAdAccountId(metaAdAccounts[0].id);
      patch.selected_ad_account_id = metaAdAccounts[0].id;
    }
    if (metaPages.length === 1 && !selectedPageId) {
      setSelectedPageId(metaPages[0].id);
      patch.selected_page_id = metaPages[0].id;
    }
    if (metaInstagram.length === 1 && !selectedInstagramId) {
      setSelectedInstagramId(metaInstagram[0].id);
      patch.selected_instagram_id = metaInstagram[0].id;
    }
    if (Object.keys(patch).length > 0) {
      void saveSelectedAssets(patch);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaAssetsLoading, metaAdAccounts.length, metaPages.length, metaInstagram.length]);

  const onSave = useCallback(async () => {
    if (!business?.id) return;
    setSaving(true);
    try {
      const comps = competitors
        .map((c) => ({ name: c.name.trim(), website: c.website?.trim() }))
        .filter((c) => c.name)
        .slice(0, 5);
      const patch = {
        name: name.trim(),
        industry: industry.trim() || null,
        website: website.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        description: description.trim() || null,
        brand_logo: brandLogo ? brandLogo : null,
        brand_colors: {
          primary: normalizeHex(cPrimary),
          secondary: normalizeHex(cSecondary),
          text: normalizeHex(cText),
        },
        brand_font: brandFont,
        brand_secondary_font: brandSecondaryFont.trim() || null,
        brand_tone: brandTone,
        brand_avoid: brandAvoid.trim() || null,
        brand_style_preference: stylePreference || null,
        target_age_min: Math.min(ageMin, ageMax),
        target_age_max: Math.max(ageMin, ageMax),
        target_gender: gender,
        target_geo: geo.trim() || null,
        competitors: comps,
        brand_differentiator: differentiator.trim() || null,
      };

      const res = await fetchAdchatApi(
        `${API_BASE}/api/businesses/${encodeURIComponent(business.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        Alert.alert("שגיאה", json.error || "שמירה נכשלה");
        return;
      }
      await refresh();
      initialSnapshotRef.current = snapshot;
      showToast("נשמר בהצלחה ✓");
    } finally {
      setSaving(false);
    }
  }, [
    business?.id,
    name,
    industry,
    website,
    phone,
    address,
    description,
    brandLogo,
    cPrimary,
    cSecondary,
    cText,
    brandFont,
    brandSecondaryFont,
    brandTone,
    brandAvoid,
    stylePreference,
    ageMin,
    ageMax,
    gender,
    geo,
    competitors,
    differentiator,
    refresh,
    snapshot,
    showToast,
  ]);

  const runScrape = useCallback(async () => {
    if (!business?.id) return;
    const normalized = normalizeWebsiteUrl(website);
    if (!normalized) {
      Alert.alert("", "נא להזין כתובת אתר תקינה");
      return;
    }
    setScraping(true);
    try {
      const res = await fetchAdchatApi(`${API_BASE}/api/scrape-website`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: normalized, business_id: business.id }),
      });
      const raw = await res.text().catch(() => "");
      const json = JSON.parse(raw || "{}") as {
        data?: Record<string, unknown>;
        error?: string;
      };
      if (!res.ok) {
        Alert.alert("סריקה נכשלה", json.error || raw || "נסה שוב");
        return;
      }
      if (!json.data || typeof json.data !== "object") {
        Alert.alert("", "לא התקבלו נתונים מהסריקה");
        return;
      }
      setScrapeResult(json.data);
      setScrapeModalOpen(true);
      await refresh();
    } catch (e) {
      Alert.alert("", e instanceof Error ? e.message : "שגיאה בסריקה");
    } finally {
      setScraping(false);
    }
  }, [business?.id, website, refresh]);

  const filledDescriptionByDana =
    !!description.trim() &&
    description.trim() === memVal(clientMemory, "business_profile", "business_overview");
  const filledDifferentiatorByDana =
    !!differentiator.trim() &&
    differentiator.trim() === memVal(clientMemory, "brand", "competitive_advantage");
  const filledGeoByDana =
    !!geo.trim() && geo.trim() === memVal(clientMemory, "audience", "ideal_customer");
  const filledToneByDana =
    brandTone.length > 0 &&
    memVal(clientMemory, "preferences", "messaging_tone") !== "" &&
    brandTone.join(",") ===
      memVal(clientMemory, "preferences", "messaging_tone")
        .split(/,|\n|;|\|/g)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 5)
        .join(",");

  const showDanaTooltip = () => {
    Alert.alert(
      "דנה ✓",
      "מולא על ידי דנה באונבורדינג — ניתן לעריכה.",
      [{ text: "סגור" }],
    );
  };

  const danaBadge = (on: boolean) =>
    on ? (
      <TouchableOpacity
        onPress={showDanaTooltip}
        style={styles.danaBadge}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="דנה"
      >
        <Text style={styles.danaBadgeText}>דנה ✓</Text>
      </TouchableOpacity>
    ) : null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={colors.statusBar as any} />
      {/* Header + tabs — same on mobile and desktop */}
      <View style={[styles.header, { backgroundColor: colors.bg }, isDesktop && { alignItems: "center" }]}>
        <View style={[isDesktop && { maxWidth: 680, width: "100%" }]}>
        <Text style={[styles.screenTitle, { color: colors.text }, isDesktop && { fontSize: 22 }]} accessibilityRole="header">
          הגדרות
        </Text>
        <View style={styles.tabsRow}>
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.tabBtn, { borderColor: colors.inputBorder, backgroundColor: colors.cardBg }, on && styles.tabBtnOn]}
                onPress={() => setTab(t.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.tabText, { color: colors.textMuted }, on && styles.tabTextOn, on && { color: colors.text }]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        </View>
      </View>

      <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: tabBarHeight + 120 },
          isDesktop && styles.scrollDesktop,
        ]}
        keyboardShouldPersistTaps="handled"
        accessibilityLanguage="he"
      >
        {/* Meta connection (always shown) */}
        <View style={[styles.metaSection, { backgroundColor: colors.cardBg, borderColor: colors.cardBorder }]}>
          <View style={styles.metaTopRow}>
            <Text style={[styles.metaTitle, { color: colors.text }]}>חיבור Meta</Text>
            {business?.meta_user_id ? (
              <View style={styles.metaConnectedPill}>
                <Text style={styles.metaConnectedText}>מחובר ✓</Text>
              </View>
            ) : null}
          </View>

          {business?.meta_user_id ? (
            <>
              <Text style={[styles.metaSub, { color: colors.textSecondary }]}>
                {metaUserLabel ? `משתמש: ${metaUserLabel}` : "מחובר לחשבון Meta"}
              </Text>

              {tokenExpiryWarning && (
                <View style={[styles.tokenWarningBanner, { backgroundColor: "rgba(234,179,8,0.10)", borderColor: "rgba(234,179,8,0.30)" }]}>
                  <Text style={styles.tokenWarningText}>
                    ⚠️ הטוקן פג בעוד {tokenExpiryWarning.days_left} ימים — חדש חיבור
                  </Text>
                  <TouchableOpacity
                    style={styles.tokenWarningBtn}
                    onPress={() => void onConnectMeta()}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.tokenWarningBtnText}>חדש עכשיו</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={[styles.metaAssetsBlock, { borderTopColor: colors.separator }]}>
                <Text style={[styles.metaAssetsTitle, { color: colors.textSecondary }]}>בחירת נכסים</Text>
                {metaAssetsLoading ? (
                  <View style={{ gap: 12 }}>
                    {[0, 1, 2].map((i) => (
                      <View key={i} style={[styles.assetCard, { backgroundColor: colors.bgSecondary, borderColor: colors.cardBorder }]}>
                        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, padding: 14 }}>
                          <Shimmer width={28} height={28} borderRadius={14} />
                          <View style={{ flex: 1, gap: 6 }}>
                            <Shimmer width={60} height={10} />
                            <Shimmer width={120} height={14} />
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : metaAdAccounts.length === 0 &&
                  metaPages.length === 0 &&
                  metaInstagram.length === 0 ? (
                  <Text style={[styles.metaEmptyText, { color: colors.textSecondary }]}>לא נמצאו נכסים</Text>
                ) : (
                  <View style={{ gap: 12 }}>
                    {[
                      { type: "adaccounts" as const, label: "מנהל מודעות", icon: "📊", items: metaAdAccounts, selectedId: selectedAdAccountId, count: metaAdAccounts.length },
                      { type: "pages" as const, label: "דף פייסבוק", icon: "📄", items: metaPages, selectedId: selectedPageId, count: metaPages.length },
                      { type: "instagram" as const, label: "אינסטגרם", icon: "📸", items: metaInstagram, selectedId: selectedInstagramId, count: metaInstagram.length },
                    ].filter((g) => g.items.length > 0).map((g) => {
                      const selected = g.items.find((x) => x.id === g.selectedId);
                      return (
                        <TouchableOpacity
                          key={g.type}
                          style={[
                            styles.assetCard,
                            { backgroundColor: colors.bgSecondary, borderColor: selected ? "#4F6EF7" : colors.cardBorder },
                          ]}
                          onPress={() => setPicker({ open: true, type: g.type })}
                          activeOpacity={0.85}
                        >
                          <View style={styles.assetCardRow}>
                            <Text style={styles.assetCardIcon}>{g.icon}</Text>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.assetCardLabel, { color: colors.textMuted }]}>{g.label}</Text>
                              <Text style={[styles.assetCardValue, { color: colors.text }]} numberOfLines={1}>
                                {selected ? selected.name : "לא נבחר"}
                              </Text>
                            </View>
                            <View style={{ alignItems: "center" }}>
                              {selected ? (
                                <Ionicons name="checkmark-circle" size={20} color="#4F6EF7" />
                              ) : (
                                <Text style={[styles.assetCardBadge, { backgroundColor: colors.pillBg, color: colors.textMuted }]}>
                                  {g.count}
                                </Text>
                              )}
                              <Text style={[styles.assetCardChevron, { color: colors.textMuted }]}>◂</Text>
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={[styles.metaBtn, styles.metaBtnDisconnect]}
                onPress={() => setAssetConfirm({ open: true, type: "disconnect", asset: null, prevName: "" })}
                activeOpacity={0.9}
                disabled={metaBusy}
              >
                <Text style={styles.metaBtnDisconnectText}>
                  {metaBusy ? "מנתק…" : "נתק חשבון"}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.metaBtn, styles.metaBtnConnect, metaBusy && styles.metaBtnDisabled]}
              onPress={() => void onConnectMeta()}
              activeOpacity={0.9}
              disabled={metaBusy}
            >
              {metaBusy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.metaBtnConnectText}>חבר חשבון פייסבוק</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

      <Modal
        visible={picker.open}
        transparent
        animationType="fade"
        onRequestClose={() => { setPicker({ open: false, type: null }); setPickerSearch(""); }}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.bgSecondary, borderColor: colors.cardBorder }]}>
            {/* Header */}
            <View style={styles.pickerHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {picker.type === "adaccounts" ? "📊 מנהל מודעות" : picker.type === "pages" ? "📄 דף פייסבוק" : "📸 אינסטגרם"}
              </Text>
              <TouchableOpacity
                onPress={() => { setPicker({ open: false, type: null }); setPickerSearch(""); }}
                hitSlop={12}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Search — show only when 4+ items */}
            {(() => {
              const list = picker.type === "adaccounts" ? metaAdAccounts : picker.type === "pages" ? metaPages : metaInstagram;
              return list.length >= 4 ? (
                <View style={[styles.pickerSearchWrap, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}>
                  <Ionicons name="search" size={16} color={colors.textMuted} style={{ marginLeft: 8 }} />
                  <TextInput
                    style={[styles.pickerSearchInput, { color: colors.text }]}
                    placeholder="חפש לפי שם או מזהה…"
                    placeholderTextColor={colors.textMuted}
                    value={pickerSearch}
                    onChangeText={setPickerSearch}
                    autoFocus
                  />
                  {pickerSearch.length > 0 ? (
                    <TouchableOpacity onPress={() => setPickerSearch("")} hitSlop={8}>
                      <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null;
            })()}

            {/* Items */}
            <ScrollView
              contentContainerStyle={{ paddingVertical: 4 }}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 380 }}
            >
              {(() => {
                const allItems = picker.type === "adaccounts" ? metaAdAccounts : picker.type === "pages" ? metaPages : metaInstagram;
                const q = pickerSearch.trim().toLowerCase();
                const filtered = q
                  ? allItems.filter((a) => (a.name || "").toLowerCase().includes(q) || (a.id || "").toLowerCase().includes(q))
                  : allItems;
                if (filtered.length === 0) {
                  return (
                    <Text style={[styles.pickerEmpty, { color: colors.textMuted }]}>
                      {q ? `לא נמצאו תוצאות ל-"${pickerSearch}"` : "אין נכסים"}
                    </Text>
                  );
                }
                return filtered.map((a) => {
                  const isSelected =
                    (picker.type === "adaccounts" && a.id === selectedAdAccountId) ||
                    (picker.type === "pages" && a.id === selectedPageId) ||
                    (picker.type === "instagram" && a.id === selectedInstagramId);
                  return (
                    <TouchableOpacity
                      key={a.id}
                      style={[
                        styles.pickerItem,
                        { backgroundColor: isSelected ? "rgba(79,110,247,0.10)" : colors.cardBg, borderColor: isSelected ? "#4F6EF7" : colors.cardBorder },
                      ]}
                      activeOpacity={0.85}
                      onPress={() => {
                        if (isSelected) {
                          // Already selected — just close
                          setPicker({ open: false, type: null });
                          setPickerSearch("");
                          return;
                        }
                        const prevId =
                          picker.type === "adaccounts" ? selectedAdAccountId
                          : picker.type === "pages" ? selectedPageId
                          : selectedInstagramId;
                        const prevItem = prevId
                          ? (picker.type === "adaccounts" ? metaAdAccounts : picker.type === "pages" ? metaPages : metaInstagram)
                              .find((x) => x.id === prevId)
                          : null;
                        if (prevId) {
                          // Switching from one asset to another — confirm first
                          setPicker({ open: false, type: null });
                          setPickerSearch("");
                          setAssetConfirm({
                            open: true,
                            type: picker.type,
                            asset: { id: a.id, name: a.name || a.id },
                            prevName: prevItem?.name || prevId,
                          });
                        } else {
                          // First-time selection — save directly
                          setPicker({ open: false, type: null });
                          setPickerSearch("");
                          if (picker.type === "adaccounts") {
                            setSelectedAdAccountId(a.id);
                            void saveSelectedAssets({ selected_ad_account_id: a.id });
                          } else if (picker.type === "pages") {
                            setSelectedPageId(a.id);
                            void saveSelectedAssets({ selected_page_id: a.id });
                          } else if (picker.type === "instagram") {
                            setSelectedInstagramId(a.id);
                            void saveSelectedAssets({ selected_instagram_id: a.id });
                          }
                          showToast("נשמר ✓");
                        }
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.pickerItemName, { color: colors.text }]} numberOfLines={1}>
                          {a.name || a.id}
                        </Text>
                        <Text style={[styles.pickerItemId, { color: colors.textMuted }]} numberOfLines={1}>
                          {a.id}
                        </Text>
                      </View>
                      {isSelected ? (
                        <Ionicons name="checkmark-circle" size={22} color="#4F6EF7" />
                      ) : (
                        <View style={[styles.pickerItemRadio, { borderColor: colors.cardBorder }]} />
                      )}
                    </TouchableOpacity>
                  );
                });
              })()}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Asset change / disconnect confirmation modal */}
      <Modal
        visible={assetConfirm.open}
        transparent
        animationType="fade"
        onRequestClose={() => setAssetConfirm({ open: false, type: null, asset: null, prevName: "" })}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.bgSecondary, borderColor: colors.cardBorder, maxWidth: 400 }]}>
            {assetConfirm.type === "disconnect" ? (
              <>
                <Text style={[styles.confirmIcon]}>⚠️</Text>
                <Text style={[styles.confirmTitle, { color: colors.text }]}>ניתוק חשבון Meta</Text>
                <Text style={[styles.confirmBody, { color: colors.textSecondary }]}>
                  ניתוק החשבון יגרום ל:{"\n\n"}
                  • הפסקת מעקב אחר קמפיינים והוצאות{"\n"}
                  • איבוד גישה לנתוני ביצועים{"\n"}
                  • התראות Meta יפסיקו להגיע{"\n\n"}
                  ניתן תמיד להתחבר מחדש.
                </Text>
                <View style={styles.confirmBtns}>
                  <TouchableOpacity
                    style={[styles.confirmBtnCancel, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}
                    onPress={() => setAssetConfirm({ open: false, type: null, asset: null, prevName: "" })}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.confirmBtnCancelText, { color: colors.text }]}>ביטול</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtnDanger]}
                    onPress={() => {
                      setAssetConfirm({ open: false, type: null, asset: null, prevName: "" });
                      void handleDisconnectMeta();
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.confirmBtnDangerText}>נתק</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.confirmIcon]}>🔄</Text>
                <Text style={[styles.confirmTitle, { color: colors.text }]}>
                  {assetConfirm.type === "adaccounts" ? "החלפת מנהל מודעות" : assetConfirm.type === "pages" ? "החלפת דף פייסבוק" : "החלפת אינסטגרם"}
                </Text>
                <Text style={[styles.confirmBody, { color: colors.textSecondary }]}>
                  את/ה עומד/ת להחליף מ-{"\n"}
                  <Text style={{ fontWeight: "900", color: colors.text }}>{assetConfirm.prevName}</Text>
                  {"\n"}ל-{"\n"}
                  <Text style={{ fontWeight: "900", color: colors.text }}>{assetConfirm.asset?.name}</Text>
                  {"\n\n"}
                  {assetConfirm.type === "adaccounts"
                    ? "כל נתוני הקמפיינים, ההוצאות והביצועים יתעדכנו בהתאם לחשבון החדש."
                    : assetConfirm.type === "pages"
                      ? "הדף החדש ישמש לניתוח תוכן ולזיהוי פוסטים."
                      : "חשבון האינסטגרם החדש ישמש לניתוח תוכן וביצועים."}
                </Text>
                <View style={styles.confirmBtns}>
                  <TouchableOpacity
                    style={[styles.confirmBtnCancel, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}
                    onPress={() => setAssetConfirm({ open: false, type: null, asset: null, prevName: "" })}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.confirmBtnCancelText, { color: colors.text }]}>ביטול</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtnPrimary]}
                    onPress={() => {
                      const { type, asset } = assetConfirm;
                      setAssetConfirm({ open: false, type: null, asset: null, prevName: "" });
                      if (!asset) return;
                      if (type === "adaccounts") {
                        setSelectedAdAccountId(asset.id);
                        void saveSelectedAssets({ selected_ad_account_id: asset.id });
                      } else if (type === "pages") {
                        setSelectedPageId(asset.id);
                        void saveSelectedAssets({ selected_page_id: asset.id });
                      } else if (type === "instagram") {
                        setSelectedInstagramId(asset.id);
                        void saveSelectedAssets({ selected_instagram_id: asset.id });
                      }
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.confirmBtnPrimaryText}>אשר החלפה</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

        {tab === "profile" ? (
          <View style={[styles.card, { backgroundColor: colors.bgSecondary, borderColor: colors.cardBorder }]}>
            <LabeledInput
              label="שם העסק"
              placeholder="לדוגמה: סטודיו פילאטיס רמת גן"
              value={name}
              onChangeText={setName}
              focused={focusedKey === "name"}
              onFocus={() => setFocusedKey("name")}
              onBlur={() => setFocusedKey(null)}
              themeColors={colors}
            />
            <LabeledInput
              label="תחום / קטגוריה"
              placeholder="לדוגמה: כושר ובריאות"
              value={industry}
              onChangeText={setIndustry}
              focused={focusedKey === "industry"}
              onFocus={() => setFocusedKey("industry")}
              onBlur={() => setFocusedKey(null)}
              themeColors={colors}
            />
            <LabeledInput
              label="אתר אינטרנט"
              placeholder="לדוגמה: https://example.com"
              value={website}
              onChangeText={setWebsite}
              focused={focusedKey === "website"}
              onFocus={() => setFocusedKey("website")}
              onBlur={() => setFocusedKey(null)}
              themeColors={colors}
            />
            <TouchableOpacity
              style={[styles.scrapeBtn, (scraping || !website.trim()) && styles.scrapeBtnDisabled]}
              onPress={() => void runScrape()}
              disabled={scraping || !website.trim()}
              activeOpacity={0.85}
            >
              {scraping ? (
                <View style={styles.scrapeRow}>
                  <ActivityIndicator color="#60A5FA" size="small" />
                  <Text style={styles.scrapeBtnText}>סורק את האתר…</Text>
                </View>
              ) : (
                <Text style={styles.scrapeBtnText}>סרוק אתר ומלא נתונים</Text>
              )}
            </TouchableOpacity>
            <LabeledInput
              label="טלפון ליצירת קשר"
              placeholder="לדוגמה: 050-1234567"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              focused={focusedKey === "phone"}
              onFocus={() => setFocusedKey("phone")}
              onBlur={() => setFocusedKey(null)}
              themeColors={colors}
            />
            <LabeledInput
              label="כתובת"
              placeholder="לדוגמה: ז'בוטינסקי 10, רמת גן"
              value={address}
              onChangeText={setAddress}
              focused={focusedKey === "address"}
              onFocus={() => setFocusedKey("address")}
              onBlur={() => setFocusedKey(null)}
              themeColors={colors}
            />
            <View style={styles.labelRow}>
              <Text style={[styles.label, { color: colors.textMuted }]}>תיאור קצר של העסק</Text>
              {danaBadge(filledDescriptionByDana)}
            </View>
            <LabeledInput
              label=""
              placeholder="לדוגמה: חנות בגדים לנשים 20-40 עם משלוחים מהירים"
              value={description}
              onChangeText={setDescription}
              multiline
              minHeight={80}
              focused={focusedKey === "description"}
              onFocus={() => setFocusedKey("description")}
              onBlur={() => setFocusedKey(null)}
              themeColors={colors}
            />
          </View>
        ) : null}

        {tab === "brand" ? (
          <View style={[styles.card, { backgroundColor: colors.bgSecondary, borderColor: colors.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>לוגו</Text>
            <View style={styles.logoBlock}>
              {brandLogo ? (
                <View style={[styles.logoHas, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}>
                  <Image
                    source={{ uri: `data:image/png;base64,${brandLogo}` }}
                    style={styles.logoImg}
                  />
                  <TouchableOpacity
                    style={styles.logoReplace}
                    onPress={() => void onPickLogo()}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.logoReplaceText}>החלף</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.logoEmpty, { backgroundColor: colors.inputBg }]}
                  onPress={() => void onPickLogo()}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.logoEmptyText, { color: colors.textMuted }]}>הוסף לוגו +</Text>
                </TouchableOpacity>
              )}
              <Text style={[styles.logoMeta, { color: colors.textMuted }]}>PNG/JPG עד 2MB</Text>
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 18, color: colors.text }]}>צבעי מותג</Text>
            <Text style={[styles.subtle, { color: colors.textMuted }]}>
              לחיצה על עיגול פותחת צבעים נפוצים. אפשר גם להקליד HEX.
            </Text>
            <View style={styles.colorsRow}>
              <ColorDot
                label="ראשי"
                value={cPrimary}
                onPress={() => setColorPicker({ open: true, key: "primary" })}
                themeColors={colors}
              />
              <ColorDot
                label="משני"
                value={cSecondary}
                onPress={() => setColorPicker({ open: true, key: "secondary" })}
                themeColors={colors}
              />
              <ColorDot
                label="טקסט"
                value={cText}
                onPress={() => setColorPicker({ open: true, key: "text" })}
                themeColors={colors}
              />
            </View>
            <View style={styles.hexRow}>
              <LabeledInput
                label="HEX ראשי"
                placeholder="#4F6EF7"
                value={cPrimary}
                onChangeText={setCPrimary}
                focused={focusedKey === "hex1"}
                onFocus={() => setFocusedKey("hex1")}
                onBlur={() => setFocusedKey(null)}
                textAlign="left"
                themeColors={colors}
              />
              <LabeledInput
                label="HEX משני"
                placeholder="#22C55E"
                value={cSecondary}
                onChangeText={setCSecondary}
                focused={focusedKey === "hex2"}
                onFocus={() => setFocusedKey("hex2")}
                onBlur={() => setFocusedKey(null)}
                textAlign="left"
                themeColors={colors}
              />
              <LabeledInput
                label="HEX טקסט"
                placeholder="#FFFFFF"
                value={cText}
                onChangeText={setCText}
                focused={focusedKey === "hex3"}
                onFocus={() => setFocusedKey("hex3")}
                onBlur={() => setFocusedKey(null)}
                textAlign="left"
                themeColors={colors}
              />
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 18, color: colors.text }]}>שפה עיצובית</Text>
            <Text style={[styles.subtle, { color: colors.textMuted }]}>
              בחר את הסגנון הוויזואלי המרכזי של המותג
            </Text>
            <View style={styles.styleCardsRow}>
              {([
                { key: "minimalist", label: "מינימליסטי", desc: "נקי, מרווח, פשוט", icon: "◻️" },
                { key: "colorful", label: "צבעוני", desc: "אנרגטי, נועז, תוסס", icon: "🎨" },
                { key: "professional", label: "מקצועי", desc: "אמין, רציני, נקי", icon: "💼" },
                { key: "friendly", label: "ידידותי", desc: "חם, נגיש, קליל", icon: "😊" },
              ] as const).map((s) => (
                <Pressable
                  key={s.key}
                  style={[
                    styles.styleCard,
                    { backgroundColor: colors.inputBg, borderColor: stylePreference === s.key ? "#60A5FA" : colors.cardBorder },
                    stylePreference === s.key && styles.styleCardActive,
                  ]}
                  onPress={() => setStylePreference(stylePreference === s.key ? "" : s.key)}
                >
                  <Text style={styles.styleCardIcon}>{s.icon}</Text>
                  <Text style={[styles.styleCardLabel, { color: colors.text }]}>{s.label}</Text>
                  <Text style={[styles.styleCardDesc, { color: colors.textMuted }]}>{s.desc}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 18, color: colors.text }]}>פונט ראשי</Text>
            <View style={styles.chipsRow}>
              {(["Modern", "Classic", "Bold", "Minimal"] as BrandFont[]).map((f) => (
                <Chip key={f} label={f} on={brandFont === f} onPress={() => setBrandFont(f)} themeColors={colors} />
              ))}
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 12, color: colors.text }]}>פונט משני</Text>
            <LabeledInput
              label=""
              placeholder="לדוגמה: Rubik, Assistant, Heebo..."
              value={brandSecondaryFont}
              onChangeText={setBrandSecondaryFont}
              focused={focusedKey === "secFont"}
              onFocus={() => setFocusedKey("secFont")}
              onBlur={() => setFocusedKey(null)}
              themeColors={colors}
            />

            <View style={[styles.labelRow, { marginTop: 18 }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>טון תקשורת</Text>
              {danaBadge(filledToneByDana)}
            </View>
            <View style={styles.chipsRow}>
              {[
                ["מקצועי", "💼"],
                ["ידידותי", "😊"],
                ["הומוריסטי", "😄"],
                ["רשמי", "📋"],
                ["צעיר", "⚡"],
              ].map(([t, e]) => (
                <Chip
                  key={t}
                  label={`${t} ${e}`}
                  on={brandTone.includes(t)}
                  onPress={() => toggleTone(t)}
                  themeColors={colors}
                />
              ))}
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 18, color: colors.text }]}>
              מה להימנע
            </Text>
            <LabeledInput
              label=""
              placeholder="לדוגמה: אל תזכיר מחירים, אל תשתמש בסלנג..."
              value={brandAvoid}
              onChangeText={setBrandAvoid}
              multiline
              minHeight={120}
              focused={focusedKey === "avoid"}
              onFocus={() => setFocusedKey("avoid")}
              onBlur={() => setFocusedKey(null)}
              themeColors={colors}
            />
          </View>
        ) : null}

        {tab === "audience" ? (
          <View style={[styles.card, { backgroundColor: colors.bgSecondary, borderColor: colors.cardBorder }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>גיל קהל יעד</Text>
            <View style={styles.ageRow}>
              <LabeledInput
                label="מ"
                placeholder="18"
                value={String(ageMin)}
                onChangeText={(t) => {
                  const n = toIntInRange(t, 18, 65);
                  if (n == null) return setAgeMin(18);
                  setAgeMin(Math.min(n, ageMax));
                }}
                keyboardType="number-pad"
                focused={focusedKey === "ageMin"}
                onFocus={() => setFocusedKey("ageMin")}
                onBlur={() => setFocusedKey(null)}
                textAlign="left"
                themeColors={colors}
              />
              <LabeledInput
                label="עד"
                placeholder="65"
                value={String(ageMax)}
                onChangeText={(t) => {
                  const n = toIntInRange(t, 18, 65);
                  if (n == null) return setAgeMax(65);
                  setAgeMax(Math.max(n, ageMin));
                }}
                keyboardType="number-pad"
                focused={focusedKey === "ageMax"}
                onFocus={() => setFocusedKey("ageMax")}
                onBlur={() => setFocusedKey(null)}
                textAlign="left"
                themeColors={colors}
              />
            </View>

            <Text style={[styles.sectionTitle, { marginTop: 18, color: colors.text }]}>מגדר</Text>
            <View style={styles.chipsRow}>
              <Chip label="גברים" on={gender === "men"} onPress={() => setGender("men")} themeColors={colors} />
              <Chip label="נשים" on={gender === "women"} onPress={() => setGender("women")} themeColors={colors} />
              <Chip label="הכל" on={gender === "all"} onPress={() => setGender("all")} themeColors={colors} />
            </View>

            <View style={[styles.labelRow, { marginTop: 18 }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>אזור גיאוגרפי</Text>
              {danaBadge(filledGeoByDana)}
            </View>
            <LabeledInput
              label=""
              placeholder="לדוגמה: מרכז / תל אביב והסביבה"
              value={geo}
              onChangeText={setGeo}
              focused={focusedKey === "geo"}
              onFocus={() => setFocusedKey("geo")}
              onBlur={() => setFocusedKey(null)}
              themeColors={colors}
            />

            <Text style={[styles.sectionTitle, { marginTop: 18, color: colors.text }]}>מתחרים</Text>
            {competitors.map((c, i) => (
              <View key={i} style={[styles.compCard, { borderColor: colors.cardBorder, backgroundColor: colors.cardBg }]}>
                <View style={styles.compTop}>
                  <Text style={[styles.compTitle, { color: colors.text }]}>מתחרה {i + 1}</Text>
                  <TouchableOpacity
                    onPress={() =>
                      setCompetitors((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    style={styles.compRemove}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.compRemoveText}>✕</Text>
                  </TouchableOpacity>
                </View>
                <LabeledInput
                  label="שם"
                  placeholder="לדוגמה: BrandX"
                  value={c.name}
                  onChangeText={(t) =>
                    setCompetitors((prev) => {
                      const next = [...prev];
                      next[i] = { ...next[i], name: t };
                      return next;
                    })
                  }
                  focused={focusedKey === `cname-${i}`}
                  onFocus={() => setFocusedKey(`cname-${i}`)}
                  onBlur={() => setFocusedKey(null)}
                  themeColors={colors}
                />
                <LabeledInput
                  label="אתר"
                  placeholder="לדוגמה: https://competitor.com"
                  value={c.website || ""}
                  onChangeText={(t) =>
                    setCompetitors((prev) => {
                      const next = [...prev];
                      next[i] = { ...next[i], website: t };
                      return next;
                    })
                  }
                  focused={focusedKey === `cweb-${i}`}
                  onFocus={() => setFocusedKey(`cweb-${i}`)}
                  onBlur={() => setFocusedKey(null)}
                  textAlign="left"
                  themeColors={colors}
                />
              </View>
            ))}
            <TouchableOpacity
              style={[styles.addBtn, competitors.length >= 5 && styles.addBtnDisabled]}
              onPress={() =>
                setCompetitors((prev) =>
                  prev.length >= 5 ? prev : [...prev, { name: "", website: "" }],
                )
              }
              disabled={competitors.length >= 5}
              activeOpacity={0.85}
            >
              <Text style={[styles.addBtnText, { color: colors.text }]}>הוסף מתחרה +</Text>
            </TouchableOpacity>

            <View style={[styles.labelRow, { marginTop: 18 }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>מה מבדל אותנו</Text>
              {danaBadge(filledDifferentiatorByDana)}
            </View>
            <LabeledInput
              label=""
              placeholder="לדוגמה: שירות מהיר + אחריות + ניסיון מוכח"
              value={differentiator}
              onChangeText={setDifferentiator}
              multiline
              minHeight={80}
              focused={focusedKey === "diff"}
              onFocus={() => setFocusedKey("diff")}
              onBlur={() => setFocusedKey(null)}
              themeColors={colors}
            />
          </View>
        ) : null}
      </ScrollView>
      </View>

      <View style={[styles.stickySave, { paddingBottom: Math.max(16, tabBarHeight * 0.1), backgroundColor: mode === "dark" ? "rgba(11, 15, 23, 0.92)" : "rgba(238, 238, 242, 0.95)", borderTopColor: colors.separator }]}>
        <View style={[styles.stickyInner, isDesktop && styles.stickyInnerDesktop]}>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.themeToggleBtn, { borderColor: mode === "dark" ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.15)", backgroundColor: mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }]}
              onPress={toggleTheme}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel={mode === "dark" ? "מעבר למצב בהיר" : "מעבר למצב כהה"}
            >
              <Ionicons name={mode === "dark" ? "sunny-outline" : "moon-outline"} size={18} color={colors.text} />
              <Text style={[styles.themeToggleBtnText, { color: colors.text }]}>{mode === "dark" ? "מצב בהיר" : "מצב כהה"}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={() => void handleLogout()}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="התנתק"
            >
              <Ionicons name="log-out-outline" size={18} color="#EF4444" />
              <Text style={styles.logoutBtnText}>התנתק</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.deleteAccountBtn}
              onPress={() => void handleDeleteAccount()}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="מחק חשבון"
            >
              <Ionicons name="trash-outline" size={16} color="#EF4444" />
              <Text style={styles.deleteAccountBtnText}>מחק חשבון</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[
              styles.saveBtn,
              (!isDirty || saving) && styles.saveBtnMuted,
              saving && styles.saveBtnDisabled,
            ]}
            onPress={() => void onSave()}
            disabled={saving || !isDirty}
            activeOpacity={0.9}
          >
            <Text style={styles.saveBtnText}>
              {saving
                ? "שומר…"
                : isDirty
                  ? "יש שינויים — שמור"
                  : "הכל מעודכן ✓"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {toast ? (
        <Animated.View style={[styles.toast, { opacity: toastOpacity, backgroundColor: colors.bgSecondary, borderColor: colors.cardBorder }]}>
          <Text style={[styles.toastText, { color: colors.text }]}>{toast}</Text>
        </Animated.View>
      ) : null}

      <Modal
        visible={scrapeModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setScrapeModalOpen(false)}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { maxHeight: "80%", backgroundColor: colors.bgSecondary, borderColor: colors.cardBorder }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>תוצאות סריקה</Text>
            <ScrollView
              contentContainerStyle={{ paddingVertical: 8 }}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.scrapeResultText, { color: colors.textSecondary }]}>
                {scrapeResult ? formatScrapeSummary(scrapeResult) : ""}
              </Text>
            </ScrollView>
            <Text style={[styles.scrapeResultNote, { color: colors.textMuted }]}>
              הנתונים נשמרו בפרופיל ובזיכרון דנה.
            </Text>
            <TouchableOpacity
              style={[styles.modalClose, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}
              onPress={() => setScrapeModalOpen(false)}
              activeOpacity={0.85}
            >
              <Text style={[styles.modalCloseText, { color: colors.text }]}>סגור</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={colorPicker.open}
        transparent
        animationType="fade"
        onRequestClose={() => setColorPicker({ open: false, key: null })}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.bgSecondary, borderColor: colors.cardBorder }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>בחר צבע</Text>
            <View style={styles.palette}>
              {PALETTE.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.paletteDot, { backgroundColor: c, borderColor: colors.cardBorder }]}
                  onPress={() => {
                    if (colorPicker.key === "primary") setCPrimary(c);
                    else if (colorPicker.key === "secondary") setCSecondary(c);
                    else if (colorPicker.key === "text") setCText(c);
                    setColorPicker({ open: false, key: null });
                  }}
                  activeOpacity={0.85}
                />
              ))}
            </View>
            <TouchableOpacity
              style={[styles.modalClose, { backgroundColor: colors.inputBg, borderColor: colors.cardBorder }]}
              onPress={() => setColorPicker({ open: false, key: null })}
              activeOpacity={0.85}
            >
              <Text style={[styles.modalCloseText, { color: colors.text }]}>סגור</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function LabeledInput({
  label,
  placeholder,
  value,
  onChangeText,
  multiline,
  minHeight,
  keyboardType,
  focused,
  onFocus,
  onBlur,
  textAlign,
  themeColors,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  multiline?: boolean;
  minHeight?: number;
  keyboardType?: any;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  textAlign?: "left" | "right";
  themeColors?: any;
}) {
  return (
    <View style={{ marginTop: label ? 14 : 10 }}>
      {label ? <Text style={[styles.label, themeColors && { color: themeColors.textMuted }]}>{label}</Text> : null}
      <View style={[styles.underlineWrap, themeColors && { borderBottomColor: themeColors.inputBorder }, focused && styles.underlineWrapOn]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={themeColors ? themeColors.textMuted + "88" : "rgba(156,163,175,0.55)"}
          style={[
            styles.input,
            themeColors && { color: themeColors.text },
            multiline && { minHeight: minHeight ?? 80, paddingTop: 10 },
          ]}
          textAlign={textAlign || "right"}
          multiline={multiline}
          keyboardType={keyboardType}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      </View>
    </View>
  );
}

function Chip({
  label,
  on,
  onPress,
  themeColors,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  themeColors?: any;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, themeColors && { borderColor: themeColors.cardBorder }, on && styles.chipOn]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, themeColors && { color: themeColors.textSecondary }, on && styles.chipTextOn, on && themeColors && { color: themeColors.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ColorDot({
  label,
  value,
  onPress,
  themeColors,
}: {
  label: string;
  value: string;
  onPress: () => void;
  themeColors?: any;
}) {
  const hex = normalizeHex(value);
  return (
    <TouchableOpacity
      style={styles.colorDotWrap}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View
        style={[
          styles.colorDot,
          { backgroundColor: isHexColor(hex) ? hex : "#111827" },
          themeColors && { borderColor: themeColors.cardBorder },
        ]}
      />
      <Text style={[styles.colorDotLabel, themeColors && { color: themeColors.textMuted }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10,
  },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  scrollDesktop: {
    maxWidth: 680,
    width: "100%",
    alignSelf: "center" as const,
    paddingHorizontal: 24,
  },
  screenTitle: {
    color: "#F3F6FF",
    fontSize: 22,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  tabsRow: {
    flexDirection: "row-reverse",
    gap: 8,
    marginTop: 12,
  },
  tabBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(30,42,58,1)",
    backgroundColor: "rgba(19,26,35,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  tabBtnOn: {
    borderColor: "rgba(79,110,247,0.55)",
    backgroundColor: "rgba(79,110,247,0.12)",
  },
  tabText: {
    color: "#9CA3AF",
    fontSize: 12,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  tabTextOn: {
    color: "#F3F6FF",
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    backgroundColor: "#131A23",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  sectionTitle: {
    color: "#F3F6FF",
    fontSize: 15,
    fontWeight: "900",
    writingDirection: "rtl",
    textAlign: "right",
  },
  subtle: {
    marginTop: 6,
    color: "rgba(156,163,175,0.75)",
    fontSize: 12,
    fontWeight: "600",
    writingDirection: "rtl",
    textAlign: "right",
  },
  labelRow: {
    marginTop: 14,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  label: {
    color: "#9CA3AF",
    fontSize: 12,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
  },
  underlineWrap: {
    borderBottomWidth: 1,
    borderBottomColor: "#1E2A3A",
  },
  underlineWrapOn: {
    borderBottomColor: "#4F6EF7",
  },
  input: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 2,
    color: "#F3F6FF",
    fontSize: 14,
    writingDirection: "rtl",
  },
  logoBlock: {
    marginTop: 10,
    alignItems: "center",
  },
  logoHas: {
    width: 120,
    height: 120,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoImg: {
    width: 120,
    height: 120,
  },
  logoReplace: {
    position: "absolute",
    top: 8,
    right: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  logoReplaceText: {
    color: "#F3F6FF",
    fontSize: 12,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  logoEmpty: {
    width: 120,
    height: 120,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "rgba(79,110,247,0.35)",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  logoEmptyText: {
    color: "#9CA3AF",
    fontWeight: "900",
    writingDirection: "rtl",
  },
  logoMeta: {
    marginTop: 8,
    color: "rgba(156,163,175,0.75)",
    fontSize: 12,
    fontWeight: "700",
  },
  styleCardsRow: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
  },
  styleCard: {
    width: "47%" as any,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    gap: 4,
  },
  styleCardActive: {
    borderColor: "#60A5FA",
    borderWidth: 2,
  },
  styleCardIcon: {
    fontSize: 22,
  },
  styleCardLabel: {
    fontSize: 14,
    fontWeight: "700" as const,
    textAlign: "center" as const,
  },
  styleCardDesc: {
    fontSize: 11,
    textAlign: "center" as const,
  },
  chipsRow: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(75,85,99,0.55)",
    backgroundColor: "transparent",
  },
  chipOn: {
    borderColor: "rgba(79,110,247,0.75)",
    backgroundColor: "rgba(79,110,247,0.18)",
  },
  chipText: {
    color: "rgba(243,246,255,0.8)",
    fontSize: 12,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  chipTextOn: {
    color: "#F3F6FF",
  },
  colorsRow: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    marginTop: 12,
  },
  colorDotWrap: {
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  colorDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.16)",
  },
  colorDotLabel: {
    color: "#9CA3AF",
    fontSize: 12,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  hexRow: {
    marginTop: 12,
    gap: 10,
  },
  ageRow: {
    flexDirection: "row-reverse",
    gap: 16,
    marginTop: 8,
  },
  compCard: {
    marginTop: 12,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  compTop: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
  },
  compTitle: {
    color: "#F3F6FF",
    fontWeight: "900",
    writingDirection: "rtl",
  },
  compRemove: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.45)",
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  compRemoveText: {
    color: "#EF4444",
    fontWeight: "900",
  },
  addBtn: {
    marginTop: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(79,110,247,0.55)",
    backgroundColor: "rgba(79,110,247,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnDisabled: { opacity: 0.55 },
  addBtnText: {
    color: "#F3F6FF",
    fontWeight: "900",
    writingDirection: "rtl",
  },
  danaBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: "rgba(79,110,247,0.16)",
    borderWidth: 1,
    borderColor: "rgba(79,110,247,0.35)",
  },
  danaBadgeText: {
    color: "rgba(147,197,253,1)",
    fontSize: 11,
    fontWeight: "900",
    writingDirection: "rtl",
  },
  scrapeBtn: {
    marginTop: 10,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(79,110,247,0.12)",
    borderWidth: 1,
    borderColor: "rgba(79,110,247,0.35)",
  },
  scrapeBtnDisabled: {
    opacity: 0.45,
  },
  scrapeBtnText: {
    color: "#60A5FA",
    fontSize: 13,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  scrapeRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
  },
  scrapeResultText: {
    color: "rgba(243,246,255,0.88)",
    fontSize: 14,
    lineHeight: 24,
    textAlign: "right",
    writingDirection: "rtl",
  },
  scrapeResultNote: {
    marginTop: 10,
    color: "rgba(156,163,175,0.75)",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "right",
    writingDirection: "rtl",
  },
  stickySave: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 10,
    backgroundColor: "rgba(11, 15, 23, 0.92)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
  },
  stickyInner: {
    width: "100%",
  },
  stickyInnerDesktop: {
    maxWidth: 680,
  },
  actionRow: {
    flexDirection: "row-reverse",
    gap: 10,
    marginBottom: 8,
  },
  saveBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4F6EF7",
  },
  saveBtnMuted: {
    backgroundColor: "rgba(75,85,99,0.35)",
  },
  saveBtnDisabled: { opacity: 0.75 },
  saveBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    writingDirection: "rtl",
  },
  themeToggleBtn: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row-reverse",
    gap: 8,
  },
  themeToggleBtnText: {
    color: "#F3F6FF",
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
  },
  logoutBtn: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row-reverse",
    gap: 8,
  },
  logoutBtnText: {
    color: "#EF4444",
    fontSize: 13,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  deleteAccountBtn: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
    backgroundColor: "rgba(239,68,68,0.06)",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
    marginStart: "auto",
  },
  deleteAccountBtnText: {
    color: "#EF4444",
    fontSize: 14,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  toast: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 92,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(19,26,35,0.96)",
    borderWidth: 1,
    borderColor: "rgba(79,110,247,0.25)",
    alignItems: "center",
  },
  toastText: {
    color: "#F3F6FF",
    fontWeight: "900",
    writingDirection: "rtl",
  },
  metaSection: {
    marginTop: 14,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  metaTopRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  metaTitle: {
    color: "#F3F6FF",
    fontSize: 16,
    fontWeight: "900",
    writingDirection: "rtl",
    textAlign: "right",
  },
  metaConnectedPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(34,197,94,0.16)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.30)",
  },
  metaConnectedText: {
    color: "rgba(134,239,172,1)",
    fontSize: 12,
    fontWeight: "900",
    writingDirection: "rtl",
  },
  metaSub: {
    marginTop: 10,
    color: "rgba(243,246,255,0.65)",
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
  },
  tokenWarningBanner: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  tokenWarningText: {
    flex: 1,
    color: "#FDE047",
    fontSize: 13,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
  },
  tokenWarningBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#EAB308",
  },
  tokenWarningBtnText: {
    color: "#1A1A1A",
    fontSize: 12,
    fontWeight: "800",
  },
  metaBtn: {
    marginTop: 14,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  metaBtnConnect: { backgroundColor: "#4F6EF7" },
  metaBtnConnectText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    writingDirection: "rtl",
  },
  metaBtnDisconnect: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  metaBtnDisconnectText: {
    color: "#EF4444",
    fontSize: 15,
    fontWeight: "900",
    writingDirection: "rtl",
  },
  metaBtnDisabled: { opacity: 0.75 },
  metaAssetsBlock: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  metaAssetsTitle: {
    color: "rgba(243,246,255,0.85)",
    fontSize: 13,
    fontWeight: "900",
    writingDirection: "rtl",
    textAlign: "right",
  },
  metaAssetsLoadingRow: {
    marginTop: 10,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
  },
  metaAssetsLoadingText: {
    color: "rgba(243,246,255,0.65)",
    fontSize: 12,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  metaEmptyText: {
    marginTop: 10,
    color: "rgba(243,246,255,0.65)",
    fontSize: 12,
    fontWeight: "800",
    writingDirection: "rtl",
    textAlign: "right",
  },
  metaFieldLabel: {
    marginTop: 12,
    color: "rgba(243,246,255,0.78)",
    fontSize: 12,
    fontWeight: "800",
    writingDirection: "rtl",
    textAlign: "right",
  },
  metaDropdown: {
    marginTop: 8,
    backgroundColor: "#131A23",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  metaDropdownText: {
    flex: 1,
    color: "#F3F6FF",
    fontSize: 13,
    fontWeight: "800",
    writingDirection: "rtl",
    textAlign: "right",
  },
  metaDropdownChevron: {
    color: "rgba(243,246,255,0.55)",
    fontSize: 16,
    fontWeight: "900",
  },
  // --- Asset card (inline selector) ---
  assetCard: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
  },
  assetCardRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
  },
  assetCardIcon: {
    fontSize: 20,
  },
  assetCardLabel: {
    fontSize: 11,
    fontWeight: "700",
    writingDirection: "rtl",
    textAlign: "right",
  },
  assetCardValue: {
    fontSize: 13,
    fontWeight: "800",
    writingDirection: "rtl",
    textAlign: "right",
    marginTop: 2,
  },
  assetCardBadge: {
    fontSize: 11,
    fontWeight: "800",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: "hidden",
  },
  assetCardChevron: {
    fontSize: 12,
    marginTop: 4,
  },
  // --- Picker modal ---
  pickerHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  pickerSearchWrap: {
    flexDirection: "row-reverse",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    height: 40,
    marginBottom: 10,
    gap: 8,
  },
  pickerSearchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    writingDirection: "rtl",
    textAlign: "right",
    paddingVertical: 0,
  },
  pickerEmpty: {
    textAlign: "center",
    fontSize: 13,
    fontWeight: "700",
    paddingVertical: 24,
    writingDirection: "rtl",
  },
  pickerItem: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    marginBottom: 8,
  },
  pickerItemName: {
    fontSize: 14,
    fontWeight: "800",
    writingDirection: "rtl",
    textAlign: "right",
  },
  pickerItemId: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "600",
    writingDirection: "rtl",
    textAlign: "right",
  },
  pickerItemRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
  },
  // --- Confirmation modal ---
  confirmIcon: {
    fontSize: 32,
    textAlign: "center",
    marginBottom: 12,
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
    writingDirection: "rtl",
    marginBottom: 12,
  },
  confirmBody: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 20,
    textAlign: "center",
    writingDirection: "rtl",
    marginBottom: 20,
  },
  confirmBtns: {
    flexDirection: "row-reverse",
    gap: 10,
  },
  confirmBtnCancel: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBtnCancelText: {
    fontSize: 14,
    fontWeight: "800",
  },
  confirmBtnPrimary: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#4F6EF7",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBtnPrimaryText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  confirmBtnDanger: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBtnDangerText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 14,
    backgroundColor: "#131A23",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    padding: 14,
  },
  modalTitle: {
    color: "#F3F6FF",
    fontWeight: "900",
    fontSize: 14,
    writingDirection: "rtl",
    textAlign: "right",
  },
  palette: {
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
  },
  paletteDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.12)",
  },
  modalClose: {
    marginTop: 14,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  modalCloseText: {
    color: "#F3F6FF",
    fontWeight: "900",
    writingDirection: "rtl",
  },
  // desktop nav removed — using horizontal tabs on both layouts
});
