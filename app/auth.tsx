import type { AuthError } from "@supabase/supabase-js";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInUp,
  type AnimatedStyle,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { PasswordRequirements } from "../components/password-requirements";
import { firstPasswordValidationError } from "../lib/password-validation";
import { setAuthRememberPreference, supabase } from "../lib/supabase";
import { useTheme } from "../contexts/theme-context";

type AuthTab = "login" | "register";
type AuthView = "main" | "forgot" | "forgot_sent";
type FieldKey = "email" | "password" | "general";
type PendingAction = "login" | "register" | "forgot" | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SITE_URL =
  process.env.EXPO_PUBLIC_SITE_URL ?? "https://puls-v1-jhs6.vercel.app";

const RESET_REDIRECT_TO =
  process.env.EXPO_PUBLIC_RESET_REDIRECT_URL ??
  `${SITE_URL}/reset-password`;

const WEB_T = Platform.OS === "web"
  ? ({ transition: "all 0.2s ease" } as Record<string, string>)
  : undefined;

// ─── Error mappers ───

function mapLoginError(error: AuthError): { field: FieldKey; message: string } {
  const raw = (error.message || "").trim();
  const code = (error as { code?: string }).code || "";
  const lower = raw.toLowerCase();
  if (code === "email_not_confirmed" || lower.includes("email not confirmed"))
    return { field: "email", message: "נא לאשר את כתובת האימייל מהמייל שנשלח אליך" };
  if (code === "user_not_found" || lower.includes("user not found") || lower.includes("no user found"))
    return { field: "email", message: "לא נמצא חשבון עם אימייל זה" };
  if (code === "invalid_credentials" || lower.includes("invalid login") || lower.includes("invalid credentials"))
    return { field: "password", message: "סיסמה שגויה, נסה שוב" };
  return { field: "general", message: raw || "אירעה שגיאה, נסה שוב" };
}

function mapSignUpError(error: AuthError): { field: FieldKey; message: string } {
  const raw = (error.message || "").trim();
  const code = (error as { code?: string }).code || "";
  const lower = raw.toLowerCase();
  if (code === "user_already_exists" || lower.includes("already registered") || lower.includes("already been registered") || lower.includes("user already exists"))
    return { field: "email", message: "כתובת אימייל זו כבר רשומה" };
  if (lower.includes("password"))
    return { field: "password", message: raw };
  return { field: "general", message: raw || "אירעה שגיאה, נסה שוב" };
}

// ─── Shake hook ───

function useShake(): { style: AnimatedStyle<ViewStyle>; trigger: () => void } {
  const x = useSharedValue(0);
  const style = useAnimatedStyle<ViewStyle>(() => ({
    transform: [{ translateX: x.value }],
  }));
  const trigger = useCallback(() => {
    x.value = withSequence(
      withTiming(-10, { duration: 45, easing: Easing.linear }),
      withTiming(10, { duration: 45, easing: Easing.linear }),
      withTiming(-8, { duration: 45, easing: Easing.linear }),
      withTiming(8, { duration: 45, easing: Easing.linear }),
      withTiming(-4, { duration: 40, easing: Easing.linear }),
      withTiming(0, { duration: 40, easing: Easing.out(Easing.quad) }),
    );
  }, [x]);
  return { style, trigger };
}

// ─── Sub-components ───

function FieldError({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Animated.View entering={FadeInUp.duration(220).easing(Easing.out(Easing.cubic))} style={s.errorRow}>
      <Text style={s.errorText}>{text}</Text>
    </Animated.View>
  );
}

type ThemeColors = ReturnType<typeof useTheme>["colors"];

function InputField({
  value,
  onChangeText,
  placeholder,
  error,
  shakeStyle,
  accessibilityLabel,
  colors,
  keyboardType,
  secureTextEntry,
  autoCapitalize,
  showToggle,
  onToggle,
  toggleLabel,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  error?: string;
  shakeStyle: AnimatedStyle<ViewStyle>;
  accessibilityLabel: string;
  colors: ThemeColors;
  keyboardType?: "email-address" | "default";
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences";
  showToggle?: boolean;
  onToggle?: () => void;
  toggleLabel?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [eyeHovered, setEyeHovered] = useState(false);

  return (
    <View style={s.fieldWrap}>
      <Animated.View style={shakeStyle}>
        <View
          style={[
            s.inputBox,
            WEB_T,
            { backgroundColor: colors.inputBg, borderColor: error ? "#F87171" : focused ? "#4F6EF7" : colors.inputBorder },
            focused && Platform.OS === "web" && ({ boxShadow: "0 0 0 3px rgba(79,110,247,0.15)" } as Record<string, string>),
          ]}
        >
          <TextInput
            style={[s.inputText, { color: colors.text }]}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            keyboardType={keyboardType || "default"}
            autoCapitalize={autoCapitalize || "none"}
            autoCorrect={false}
            textAlign="right"
            secureTextEntry={secureTextEntry}
            accessibilityLabel={accessibilityLabel}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          {showToggle && onToggle ? (
            <Pressable
              onPress={onToggle}
              onHoverIn={() => setEyeHovered(true)}
              onHoverOut={() => setEyeHovered(false)}
              hitSlop={8}
              style={[s.eyeBtn, eyeHovered && { backgroundColor: "rgba(255,255,255,0.08)" }]}
              accessibilityRole="button"
              accessibilityLabel={toggleLabel}
            >
              <Text style={s.eyeIcon}>{secureTextEntry ? "👁️" : "🙈"}</Text>
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
      <FieldError text={error ?? ""} />
    </View>
  );
}

// ─── Main screen ───

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [view, setView] = useState<AuthView>("main");
  const [tab, setTab] = useState<AuthTab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [success, setSuccess] = useState(false);
  const [signupNeedsEmailVerify, setSignupNeedsEmailVerify] = useState(false);

  const emailShake = useShake();
  const passwordShake = useShake();
  const generalShake = useShake();
  const [submitHovered, setSubmitHovered] = useState(false);
  const [forgotHovered, setForgotHovered] = useState(false);

  const clearErrors = useCallback(() => setErrors({}), []);

  useEffect(() => {
    clearErrors();
    setSuccess(false);
    setSignupNeedsEmailVerify(false);
  }, [tab, clearErrors]);

  const validateClient = (): boolean => {
    const em = email.trim();
    const next: Partial<Record<FieldKey, string>> = {};
    if (!em) next.email = "נא להזין אימייל";
    else if (!EMAIL_RE.test(em)) next.email = "כתובת אימייל לא תקינה";
    if (!password) next.password = "נא להזין סיסמה";
    else if (tab === "register") {
      const pwErr = firstPasswordValidationError(password);
      if (pwErr) next.password = pwErr;
    }
    if (Object.keys(next).length) {
      setErrors(next);
      if (next.email) emailShake.trigger();
      if (next.password) passwordShake.trigger();
      return false;
    }
    return true;
  };

  const validateForgotEmail = (): boolean => {
    const em = email.trim();
    if (!em) { setErrors({ email: "נא להזין אימייל" }); emailShake.trigger(); return false; }
    if (!EMAIL_RE.test(em)) { setErrors({ email: "כתובת אימייל לא תקינה" }); emailShake.trigger(); return false; }
    return true;
  };

  const applyServerError = (field: FieldKey, message: string) => {
    setErrors({ [field]: message });
    if (field === "email") emailShake.trigger();
    else if (field === "password") passwordShake.trigger();
    else generalShake.trigger();
  };

  const submitLabel =
    pendingAction === "login" ? "מתחבר..." :
    pendingAction === "register" ? "יוצר חשבון..." :
    pendingAction === "forgot" ? "שולח..." : "";

  const onForgotSubmit = async () => {
    Keyboard.dismiss(); clearErrors();
    if (!validateForgotEmail()) return;
    setBusy(true); setPendingAction("forgot");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: RESET_REDIRECT_TO });
      if (error) { applyServerError("general", error.message || "שליחה נכשלה"); return; }
      setView("forgot_sent");
    } finally { setBusy(false); setPendingAction(null); }
  };

  const onSubmit = async () => {
    Keyboard.dismiss(); clearErrors();
    if (!validateClient()) return;
    const em = email.trim();
    const pw = password;
    setBusy(true); setPendingAction(tab === "login" ? "login" : "register");
    try {
      if (Platform.OS === "web") setAuthRememberPreference(rememberMe);
      if (tab === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw });
        if (error) { const m = mapLoginError(error); applyServerError(m.field, m.message); return; }
        router.replace("/"); return;
      }
      const { data, error } = await supabase.auth.signUp({ email: em, password: pw, options: { emailRedirectTo: SITE_URL } });
      if (error) { const m = mapSignUpError(error); applyServerError(m.field, m.message); return; }
      if (data.session) { setSuccess(true); setSignupNeedsEmailVerify(false); setTimeout(() => router.replace("/"), 1000); return; }
      setSuccess(true); setSignupNeedsEmailVerify(true);
    } finally { setBusy(false); setPendingAction(null); }
  };

  const onTabChange = (t: AuthTab) => { setTab(t); setSuccess(false); setSignupNeedsEmailVerify(false); };

  const glassExtra = Platform.OS === "web"
    ? ({ backdropFilter: "blur(28px)", WebkitBackdropFilter: "blur(28px)" } as Record<string, string>)
    : {};

  // ─── Render ───

  const renderTabs = () => (
    <View style={[s.segmentWrap, { backgroundColor: colors.inputBg }]}>
      {(["login", "register"] as AuthTab[]).map((t) => {
        const active = tab === t;
        return (
          <Pressable key={t} style={[s.segmentBtn, active && s.segmentBtnActive]} onPress={() => onTabChange(t)}>
            <Text style={[s.segmentLabel, { color: colors.textMuted }, active && { color: colors.text, fontWeight: "800" }]}>
              {t === "login" ? "כניסה" : "הרשמה"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const renderForm = () => (
    <>
      <InputField
        value={email}
        onChangeText={(t) => { setEmail(t); if (errors.email) setErrors((e) => ({ ...e, email: undefined })); }}
        placeholder="אימייל"
        error={errors.email}
        shakeStyle={emailShake.style}
        accessibilityLabel="אימייל"
        keyboardType="email-address"
        colors={colors}
      />

      <InputField
        value={password}
        onChangeText={(t) => { setPassword(t); if (errors.password) setErrors((e) => ({ ...e, password: undefined })); }}
        placeholder={tab === "register" ? "סיסמה — לפחות 6 תווים, אותיות וספרה" : "סיסמה"}
        error={errors.password}
        shakeStyle={passwordShake.style}
        accessibilityLabel="סיסמה"
        secureTextEntry={!showPassword}
        showToggle
        onToggle={() => setShowPassword((v) => !v)}
        toggleLabel={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
        colors={colors}
      />

      {tab === "register" ? <PasswordRequirements password={password} /> : null}

      {tab === "login" ? (
        <View style={s.loginExtras}>
          <Pressable
            style={s.rememberRow}
            onPress={() => setRememberMe((r) => !r)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: rememberMe }}
          >
            <View style={[s.checkbox, { borderColor: colors.inputBorder, backgroundColor: colors.inputBg }, rememberMe && s.checkboxOn]}>
              {rememberMe ? <Text style={s.checkMark}>✓</Text> : null}
            </View>
            <Text style={[s.rememberLabel, { color: colors.textSecondary }]}>זכור אותי</Text>
          </Pressable>
          <Pressable
            onPress={() => { setView("forgot"); clearErrors(); }}
            onHoverIn={() => setForgotHovered(true)}
            onHoverOut={() => setForgotHovered(false)}
          >
            <Text style={[s.forgotLink, WEB_T, { color: forgotHovered ? "#93C5FD" : colors.textMuted }]}>שכחתי סיסמה</Text>
          </Pressable>
        </View>
      ) : null}

      {errors.general ? (
        <Animated.View entering={FadeIn.duration(200)} style={s.generalError}>
          <FieldError text={errors.general} />
        </Animated.View>
      ) : null}

      <Animated.View style={generalShake.style}>
        <Pressable
          style={({ pressed }) => [
            s.submitBtn, WEB_T,
            submitHovered && !pressed && s.submitHover,
            pressed && s.submitPress,
            busy && s.submitDisabled,
          ]}
          onHoverIn={() => setSubmitHovered(true)}
          onHoverOut={() => setSubmitHovered(false)}
          onPress={() => void onSubmit()}
          disabled={busy}
        >
          <LinearGradient
            colors={submitHovered ? ["#5B7CF8", "#5B56E8", "#8B4CF0"] : ["#4F6EF7", "#4F46E5", "#7C3AED"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={s.submitGradient}
          >
            {busy && submitLabel ? (
              <Animated.View entering={FadeIn.duration(200)} style={s.loadRow}>
                <ActivityIndicator color="#FFF" size="small" />
                <Text style={s.submitText}>{submitLabel}</Text>
              </Animated.View>
            ) : (
              <Text style={s.submitText}>{tab === "login" ? "כניסה" : "יצירת חשבון"}</Text>
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </>
  );

  const renderForgot = () => (
    <>
      <Text style={[s.forgotIntro, { color: colors.textSecondary }]}>
        הזינו את האימייל שלכם ונשלח קישור לאיפוס הסיסמה.
      </Text>
      <InputField
        value={email}
        onChangeText={(t) => { setEmail(t); if (errors.email) setErrors((e) => ({ ...e, email: undefined })); }}
        placeholder="אימייל"
        error={errors.email}
        shakeStyle={emailShake.style}
        accessibilityLabel="אימייל לאיפוס"
        keyboardType="email-address"
        colors={colors}
      />
      {errors.general ? (
        <Animated.View entering={FadeIn.duration(200)} style={s.generalError}><FieldError text={errors.general} /></Animated.View>
      ) : null}
      <Animated.View style={generalShake.style}>
        <Pressable
          style={({ pressed }) => [s.submitBtn, WEB_T, submitHovered && !pressed && s.submitHover, pressed && s.submitPress, busy && s.submitDisabled]}
          onHoverIn={() => setSubmitHovered(true)}
          onHoverOut={() => setSubmitHovered(false)}
          onPress={() => void onForgotSubmit()}
          disabled={busy}
        >
          <LinearGradient colors={["#4F6EF7", "#4F46E5", "#7C3AED"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={s.submitGradient}>
            {busy && pendingAction === "forgot" ? (
              <Animated.View entering={FadeIn.duration(200)} style={s.loadRow}><ActivityIndicator color="#FFF" size="small" /><Text style={s.submitText}>{submitLabel}</Text></Animated.View>
            ) : (
              <Text style={s.submitText}>שלח קישור איפוס</Text>
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
      <Pressable style={s.backBtn} onPress={() => { setView("main"); clearErrors(); }}>
        <Text style={[s.backBtnText, { color: colors.textSecondary }]}>← חזרה לכניסה</Text>
      </Pressable>
    </>
  );

  const renderForgotSent = () => (
    <Animated.View entering={FadeIn.duration(350)} style={s.sentBlock}>
      <Text style={s.sentEmoji}>✉️</Text>
      <Text style={[s.sentTitle, { color: colors.text }]}>קישור איפוס נשלח!</Text>
      <Text style={[s.sentHint, { color: colors.textSecondary }]}>פתחו את המייל ולחצו על הקישור כדי לבחור סיסמה חדשה.</Text>
      <Pressable style={[s.sentBtn, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]} onPress={() => { setView("main"); clearErrors(); }}>
        <Text style={[s.sentBtnText, { color: colors.text }]}>חזרה לכניסה</Text>
      </Pressable>
    </Animated.View>
  );

  const renderSuccess = () => (
    <Animated.View entering={FadeIn.duration(350)} style={s.sentBlock}>
      <Text style={s.successCheck}>✓</Text>
      <Text style={[s.sentTitle, { color: colors.text }]}>
        {signupNeedsEmailVerify ? "נשלח אליך מייל לאימות" : "החשבון נוצר! מתחבר..."}
      </Text>
      <Text style={[s.sentHint, { color: colors.textSecondary }]}>
        {signupNeedsEmailVerify ? "אשר את האימייל ואז חזור לכאן להתחברות" : "רגע אחד, מעבירים אותך לאפליקציה"}
      </Text>
      {!signupNeedsEmailVerify ? (
        <ActivityIndicator color="#86EFAC" style={{ marginTop: 16 }} />
      ) : (
        <Pressable style={[s.sentBtn, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]} onPress={() => onTabChange("login")}>
          <Text style={[s.sentBtnText, { color: colors.text }]}>מעבר לכניסה</Text>
        </Pressable>
      )}
    </Animated.View>
  );

  const showSuccess = success && tab === "register" && view === "main";

  return (
    <View style={[s.root, { backgroundColor: colors.bg }]} accessibilityLanguage="he">
      <StatusBar barStyle={colors.statusBar} />

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <LinearGradient colors={["#080C14", "#080C14", "#0a1220"]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={["rgba(37,99,235,0.22)", "transparent"]} start={{ x: 0.2, y: 0 }} end={{ x: 0.9, y: 0.75 }} style={StyleSheet.absoluteFillObject} />
      </View>

      <KeyboardAvoidingView style={s.kav} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingTop: Math.max(insets.top, 20) + 8, paddingBottom: insets.bottom + 28 }, Platform.OS === "web" ? ({ direction: "rtl" } as const) : null]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeIn.duration(420)} style={s.logoWrap}>
            <Text style={[s.logo, { color: colors.text }]} accessibilityRole="header">Puls.</Text>
            <Text style={[s.tagline, { color: colors.textSecondary }]}>
              {view === "forgot" ? "איפוס סיסמה" : view === "forgot_sent" ? "בדקו את האימייל" : tab === "login" ? "התחברות לחשבון" : "יצירת חשבון חדש"}
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeInUp.duration(520).delay(80).easing(Easing.out(Easing.cubic))}
            style={[s.card, glassExtra, { borderColor: colors.cardBorder }]}
          >
            {Platform.OS !== "web" ? <BlurView intensity={55} tint="dark" style={StyleSheet.absoluteFill} /> : null}
            <View style={[s.cardTint, { backgroundColor: colors.cardBg }]} />

            <View style={s.cardBody}>
              {showSuccess ? renderSuccess()
                : view === "forgot_sent" ? renderForgotSent()
                : view === "forgot" ? renderForgot()
                : (
                  <>
                    {renderTabs()}
                    {renderForm()}
                  </>
                )}
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ───

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#080C14" },
  kav: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 22, justifyContent: "center" },

  logoWrap: { alignItems: "center", marginBottom: 24 },
  logo: {
    fontSize: 42, fontWeight: "900", letterSpacing: -0.5, textAlign: "center",
    textShadowColor: "rgba(59,130,246,0.85)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 22,
  },
  tagline: { marginTop: 8, fontSize: 15, fontWeight: "500", textAlign: "center", color: "rgba(226,232,240,0.62)" },

  card: { borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", maxWidth: 420, width: "100%", alignSelf: "center" },
  cardTint: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,0.06)" },
  cardBody: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 },

  // Segmented tabs
  segmentWrap: {
    flexDirection: "row-reverse", borderRadius: 12, padding: 4, marginBottom: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10 },
  segmentBtnActive: { backgroundColor: "rgba(79,110,247,0.2)" },
  segmentLabel: { fontSize: 15, fontWeight: "600" },

  // Input field
  fieldWrap: { marginBottom: 12 },
  inputBox: {
    flexDirection: "row-reverse", alignItems: "center",
    borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, minHeight: 50,
  },
  inputText: {
    flex: 1, fontSize: 15, paddingVertical: 12, textAlign: "right",
    ...Platform.select({ web: { outlineStyle: "none" } as Record<string, string>, default: {} }),
  },
  eyeBtn: { padding: 6, borderRadius: 8, marginStart: 4 },
  eyeIcon: { fontSize: 18 },

  // Errors
  errorRow: { marginTop: 6, paddingHorizontal: 4 },
  errorText: { color: "#FCA5A5", fontSize: 13, fontWeight: "600", textAlign: "right", lineHeight: 18 },
  generalError: { marginTop: 4 },

  // Login extras (forgot + remember)
  loginExtras: { flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", marginTop: 4, marginBottom: 4 },
  rememberRow: { flexDirection: "row-reverse", alignItems: "center", gap: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  checkboxOn: { borderColor: "rgba(96,165,250,0.9)", backgroundColor: "rgba(37,99,235,0.35)" },
  checkMark: { color: "#F8FAFC", fontSize: 12, fontWeight: "900" },
  rememberLabel: { fontSize: 13, fontWeight: "600" },
  forgotLink: { fontSize: 13, fontWeight: "600" },

  // Submit button
  submitBtn: { marginTop: 16, borderRadius: 14, overflow: "hidden" },
  submitHover: {
    transform: [{ scale: 1.02 }],
    ...Platform.select({ web: { boxShadow: "0 4px 20px rgba(79,70,229,0.4)" } as Record<string, string>, default: {} }),
  },
  submitPress: { opacity: 0.92, transform: [{ scale: 0.98 }] },
  submitDisabled: { opacity: 0.85 },
  submitGradient: { minHeight: 52, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  submitText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  loadRow: { flexDirection: "row-reverse", alignItems: "center", gap: 10 },

  // Forgot flow
  forgotIntro: { fontSize: 14, lineHeight: 22, textAlign: "right", marginBottom: 8 },
  backBtn: { marginTop: 16, alignSelf: "center", paddingVertical: 8 },
  backBtnText: { fontSize: 14, fontWeight: "600" },

  // Sent / success states
  sentBlock: { alignItems: "center", paddingVertical: 24 },
  sentEmoji: { fontSize: 48 },
  successCheck: { fontSize: 56, color: "#4ADE80", fontWeight: "800", textShadowColor: "rgba(74,222,128,0.5)", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16 },
  sentTitle: { marginTop: 14, fontSize: 18, fontWeight: "800", textAlign: "center" },
  sentHint: { marginTop: 8, fontSize: 14, textAlign: "center", lineHeight: 22 },
  sentBtn: { marginTop: 20, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 14, borderWidth: 1 },
  sentBtnText: { fontSize: 15, fontWeight: "700", textAlign: "center" },
});
