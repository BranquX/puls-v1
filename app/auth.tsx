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

function mapLoginError(error: AuthError): { field: FieldKey; message: string } {
  const raw = (error.message || "").trim();
  const code = (error as { code?: string }).code || "";
  const lower = raw.toLowerCase();

  if (
    code === "email_not_confirmed" ||
    lower.includes("email not confirmed")
  ) {
    return {
      field: "email",
      message: "נא לאשר את כתובת האימייל מהמייל שנשלח אליך",
    };
  }

  if (
    code === "user_not_found" ||
    lower.includes("user not found") ||
    lower.includes("no user found")
  ) {
    return { field: "email", message: "לא נמצא חשבון עם אימייל זה" };
  }

  if (
    code === "invalid_credentials" ||
    lower.includes("invalid login") ||
    lower.includes("invalid credentials")
  ) {
    return { field: "password", message: "סיסמה שגויה, נסה שוב" };
  }

  return { field: "general", message: raw || "אירעה שגיאה, נסה שוב" };
}

function mapSignUpError(error: AuthError): { field: FieldKey; message: string } {
  const raw = (error.message || "").trim();
  const code = (error as { code?: string }).code || "";
  const lower = raw.toLowerCase();

  if (
    code === "user_already_exists" ||
    lower.includes("already registered") ||
    lower.includes("already been registered") ||
    lower.includes("user already exists")
  ) {
    return { field: "email", message: "כתובת אימייל זו כבר רשומה" };
  }

  if (lower.includes("password")) {
    return { field: "password", message: raw };
  }

  return { field: "general", message: raw || "אירעה שגיאה, נסה שוב" };
}

function useShake(): {
  style: AnimatedStyle<ViewStyle>;
  trigger: () => void;
} {
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

function FieldError({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={styles.fieldErrorRow}
    >
      <Text style={styles.fieldErrorIcon}>⚠️</Text>
      <Text style={styles.fieldErrorText}>{text}</Text>
    </Animated.View>
  );
}

type ThemeColors = ReturnType<typeof useTheme>["colors"];

type EmailIconFieldProps = {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  error?: string;
  shakeStyle: AnimatedStyle<ViewStyle>;
  accessibilityLabel: string;
  colors: ThemeColors;
};

function EmailIconField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  shakeStyle,
  accessibilityLabel,
  colors,
}: EmailIconFieldProps) {
  const focus = useSharedValue(0);
  const lineStyle = useAnimatedStyle<ViewStyle>(() => {
    const active = focus.value;
    return {
      borderBottomColor: active
        ? "rgba(96, 165, 250, 0.95)"
        : colors.inputBorder,
      borderBottomWidth: active ? 2 : 1,
    };
  });

  const row = (
    <View style={styles.iconInputRow}>
      <Text style={styles.leadingIcon}>📧</Text>
      <TextInput
        style={[styles.iconInputFlex, { color: colors.text }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        textAlign="right"
        accessibilityLabel={accessibilityLabel}
        onFocus={() => {
          focus.value = withTiming(1, { duration: 160 });
        }}
        onBlur={() => {
          focus.value = withTiming(0, { duration: 200 });
        }}
      />
    </View>
  );

  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Animated.View style={shakeStyle}>
        {error ? (
          <View style={[styles.underlineWrap, styles.underlineError]}>
            {row}
          </View>
        ) : (
          <Animated.View style={[styles.underlineWrap, lineStyle]}>
            {row}
          </Animated.View>
        )}
      </Animated.View>
      <FieldError text={error ?? ""} />
    </View>
  );
}

type PasswordIconFieldProps = {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  error?: string;
  shakeStyle: AnimatedStyle<ViewStyle>;
  accessibilityLabel: string;
  showPassword: boolean;
  onToggleShow: () => void;
  colors: ThemeColors;
};

function PasswordIconField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  shakeStyle,
  accessibilityLabel,
  showPassword,
  onToggleShow,
  colors,
}: PasswordIconFieldProps) {
  const focus = useSharedValue(0);
  const lineStyle = useAnimatedStyle<ViewStyle>(() => {
    const active = focus.value;
    return {
      borderBottomColor: active
        ? "rgba(96, 165, 250, 0.95)"
        : colors.inputBorder,
      borderBottomWidth: active ? 2 : 1,
    };
  });

  const row = (
    <View style={styles.passwordIconRow}>
      <Pressable
        onPress={onToggleShow}
        hitSlop={12}
        style={styles.eyeHit}
        accessibilityRole="button"
        accessibilityLabel={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
      >
        <Text style={styles.eyeEmoji}>{showPassword ? "🙈" : "👁️"}</Text>
      </Pressable>
      <TextInput
        style={[styles.iconInputFlex, { color: colors.text }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={!showPassword}
        textAlign="right"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={accessibilityLabel}
        onFocus={() => {
          focus.value = withTiming(1, { duration: 160 });
        }}
        onBlur={() => {
          focus.value = withTiming(0, { duration: 200 });
        }}
      />
      <Text style={styles.leadingIcon}>🔒</Text>
    </View>
  );

  return (
    <View style={styles.fieldBlock}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Animated.View style={shakeStyle}>
        {error ? (
          <View style={[styles.underlineWrap, styles.underlineError]}>
            {row}
          </View>
        ) : (
          <Animated.View style={[styles.underlineWrap, lineStyle]}>
            {row}
          </Animated.View>
        )}
      </Animated.View>
      <FieldError text={error ?? ""} />
    </View>
  );
}

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

  const [tabsLayoutW, setTabsLayoutW] = useState(0);
  const barLeft = useSharedValue(0);
  const barWidth = useSharedValue(0);

  const emailShake = useShake();
  const passwordShake = useShake();
  const generalShake = useShake();

  const clearErrors = useCallback(() => {
    setErrors({});
  }, []);

  useEffect(() => {
    clearErrors();
    setSuccess(false);
    setSignupNeedsEmailVerify(false);
  }, [tab, clearErrors]);

  useEffect(() => {
    if (tabsLayoutW <= 0) return;
    const bw = Math.max(tabsLayoutW / 2 - 20, 40);
    const loginLeft = tabsLayoutW - bw - 10;
    const regLeft = 10;
    barWidth.value = bw;
    barLeft.value = withTiming(tab === "login" ? loginLeft : regLeft, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
  }, [tab, tabsLayoutW, barLeft, barWidth]);

  const underlineStyle = useAnimatedStyle(() => ({
    width: barWidth.value,
    transform: [{ translateX: barLeft.value }],
  }));

  const validateClient = (): boolean => {
    const em = email.trim();
    const next: Partial<Record<FieldKey, string>> = {};

    if (!em) {
      next.email = "נא להזין אימייל";
    } else if (!EMAIL_RE.test(em)) {
      next.email = "כתובת אימייל לא תקינה";
    }

    if (!password) {
      next.password = "נא להזין סיסמה";
    } else if (tab === "register") {
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
    if (!em) {
      setErrors({ email: "נא להזין אימייל" });
      emailShake.trigger();
      return false;
    }
    if (!EMAIL_RE.test(em)) {
      setErrors({ email: "כתובת אימייל לא תקינה" });
      emailShake.trigger();
      return false;
    }
    return true;
  };

  const applyServerError = (field: FieldKey, message: string) => {
    setErrors({ [field]: message });
    if (field === "email") emailShake.trigger();
    else if (field === "password") passwordShake.trigger();
    else generalShake.trigger();
  };

  const submitLabel =
    pendingAction === "login"
      ? "מתחבר..."
      : pendingAction === "register"
        ? "יוצר חשבון..."
        : pendingAction === "forgot"
          ? "שולח..."
          : "";

  const onForgotSubmit = async () => {
    Keyboard.dismiss();
    clearErrors();
    if (!validateForgotEmail()) return;

    setBusy(true);
    setPendingAction("forgot");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: RESET_REDIRECT_TO },
      );
      if (error) {
        applyServerError("general", error.message || "שליחה נכשלה");
        return;
      }
      setView("forgot_sent");
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  };

  const onSubmit = async () => {
    Keyboard.dismiss();
    clearErrors();
    if (!validateClient()) return;

    const em = email.trim();
    const pw = password;

    setBusy(true);
    setPendingAction(tab === "login" ? "login" : "register");
    try {
      if (Platform.OS === "web") {
        setAuthRememberPreference(rememberMe);
      }

      if (tab === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: em,
          password: pw,
        });
        if (error) {
          const mapped = mapLoginError(error);
          applyServerError(mapped.field, mapped.message);
          return;
        }
        router.replace("/");
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: em,
        password: pw,
        options: { emailRedirectTo: SITE_URL },
      });

      if (error) {
        const mapped = mapSignUpError(error);
        applyServerError(mapped.field, mapped.message);
        return;
      }

      if (data.session) {
        setSuccess(true);
        setSignupNeedsEmailVerify(false);
        setTimeout(() => {
          router.replace("/");
        }, 1000);
        return;
      }

      setSuccess(true);
      setSignupNeedsEmailVerify(true);
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  };

  const onTabChange = (t: AuthTab) => {
    setTab(t);
    setSuccess(false);
    setSignupNeedsEmailVerify(false);
  };

  const glassExtra =
    Platform.OS === "web"
      ? ({
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
        } as Record<string, string>)
      : {};

  const tagline =
    view === "forgot"
      ? "איפוס סיסמה"
      : view === "forgot_sent"
        ? "בדקו את האימייל"
        : "התחברות לחשבון";

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]} accessibilityLanguage="he">
      <StatusBar barStyle={colors.statusBar} />

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <LinearGradient
          colors={["#080C14", "#080C14", "#0a1220"]}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={["rgba(37, 99, 235, 0.22)", "transparent"]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.9, y: 0.75 }}
          style={styles.meshBlue}
        />
        <LinearGradient
          colors={["transparent", "rgba(71, 85, 105, 0.18)"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.meshGray}
        />
      </View>

      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: Math.max(insets.top, 20) + 8,
              paddingBottom: insets.bottom + 28,
            },
            Platform.OS === "web" ? ({ direction: "rtl" } as const) : null,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeIn.duration(420)} style={styles.logoBlock}>
            <Text style={[styles.logoText, { color: colors.text }]} accessibilityRole="header">
              Puls.
            </Text>
            <Text style={[styles.tagline, { color: colors.textSecondary }]}>{tagline}</Text>
          </Animated.View>

          <Animated.View
            entering={FadeInUp.duration(520)
              .delay(80)
              .easing(Easing.out(Easing.cubic))}
            style={[styles.cardOuter, glassExtra, { borderColor: colors.cardBorder }]}
          >
            {Platform.OS !== "web" ? (
              <BlurView
                intensity={55}
                tint="dark"
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <View style={[styles.cardTint, { backgroundColor: colors.cardBg }]} />

            <View style={styles.cardInner}>
              {success && tab === "register" && view === "main" ? (
                <Animated.View
                  entering={FadeIn.duration(350)}
                  style={styles.successBlock}
                >
                  <Animated.Text
                    entering={FadeIn.duration(400).delay(100)}
                    style={styles.successCheck}
                  >
                    ✓
                  </Animated.Text>
                  <Text style={[styles.successTitle, { color: colors.text }]}>
                    {signupNeedsEmailVerify
                      ? "נשלח אליך מייל לאימות"
                      : "החשבון נוצר! מתחבר..."}
                  </Text>
                  <Text style={[styles.successHint, { color: colors.textSecondary }]}>
                    {signupNeedsEmailVerify
                      ? "אשר את האימייל ואז חזור לכאן להתחברות"
                      : "רגע אחד, מעבירים אותך לאפליקציה"}
                  </Text>
                  {!signupNeedsEmailVerify ? (
                    <ActivityIndicator
                      color="#86EFAC"
                      style={{ marginTop: 16 }}
                    />
                  ) : (
                    <Pressable
                      style={[styles.backToLoginBtn, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}
                      onPress={() => onTabChange("login")}
                    >
                      <Text style={[styles.backToLoginText, { color: colors.text }]}>מעבר לכניסה</Text>
                    </Pressable>
                  )}
                </Animated.View>
              ) : view === "forgot_sent" ? (
                <Animated.View
                  entering={FadeIn.duration(350)}
                  style={styles.forgotSentBlock}
                >
                  <Text style={[styles.forgotSentTitle, { color: colors.text }]}>
                    קישור איפוס נשלח לאימייל שלך ✉️
                  </Text>
                  <Text style={[styles.forgotSentHint, { color: colors.textSecondary }]}>
                    פתחו את המייל ולחצו על הקישור כדי לבחור סיסמה חדשה.
                  </Text>
                  <Pressable
                    style={[styles.backToLoginBtn, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}
                    onPress={() => {
                      setView("main");
                      clearErrors();
                    }}
                  >
                    <Text style={[styles.backToLoginText, { color: colors.text }]}>חזרה לכניסה</Text>
                  </Pressable>
                </Animated.View>
              ) : view === "forgot" ? (
                <>
                  <Text style={[styles.forgotIntro, { color: colors.textSecondary }]}>
                    הזינו את האימייל שלכם ונשלח קישור לאיפוס הסיסמה.
                  </Text>
                  <EmailIconField
                    label="אימייל"
                    value={email}
                    onChangeText={(t) => {
                      setEmail(t);
                      if (errors.email)
                        setErrors((e) => ({ ...e, email: undefined }));
                    }}
                    placeholder="you@example.com"
                    error={errors.email}
                    shakeStyle={emailShake.style}
                    accessibilityLabel="אימייל לאיפוס"
                    colors={colors}
                  />
                  {errors.general ? (
                    <Animated.View
                      entering={FadeIn.duration(200)}
                      style={styles.generalErrorWrap}
                    >
                      <FieldError text={errors.general} />
                    </Animated.View>
                  ) : null}
                  <Animated.View style={generalShake.style}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.submitPressable,
                        pressed && styles.submitPressed,
                        busy && styles.submitDisabled,
                      ]}
                      onPress={() => void onForgotSubmit()}
                      disabled={busy}
                    >
                      <LinearGradient
                        colors={["#4F6EF7", "#4F46E5", "#7C3AED"]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={styles.submitGradient}
                      >
                        {busy && pendingAction === "forgot" ? (
                          <View style={styles.loadingRow}>
                            <ActivityIndicator color="#FFF" size="small" />
                            <Text style={styles.submitText}>{submitLabel}</Text>
                          </View>
                        ) : (
                          <Text style={styles.submitText}>שלח קישור איפוס</Text>
                        )}
                      </LinearGradient>
                    </Pressable>
                  </Animated.View>
                  <Pressable
                    style={styles.textLinkBtn}
                    onPress={() => {
                      setView("main");
                      clearErrors();
                    }}
                  >
                    <Text style={[styles.textLink, { color: colors.textSecondary }]}>חזרה לכניסה</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <View
                    style={styles.tabsRow}
                    onLayout={(e) => {
                      setTabsLayoutW(e.nativeEvent.layout.width);
                      const w = e.nativeEvent.layout.width;
                      const bw = Math.max(w / 2 - 20, 40);
                      barWidth.value = bw;
                      const loginL = w - bw - 10;
                      const regL = 10;
                      barLeft.value =
                        tab === "login" ? loginL : regL;
                    }}
                  >
                    <Pressable
                      style={styles.tabHit}
                      onPress={() => onTabChange("login")}
                    >
                      <Text
                        style={[
                          styles.tabLabel,
                          { color: colors.textMuted },
                          tab === "login" && [styles.tabLabelActive, { color: colors.text }],
                        ]}
                      >
                        כניסה
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.tabHit}
                      onPress={() => onTabChange("register")}
                    >
                      <Text
                        style={[
                          styles.tabLabel,
                          { color: colors.textMuted },
                          tab === "register" && [styles.tabLabelActive, { color: colors.text }],
                        ]}
                      >
                        הרשמה
                      </Text>
                    </Pressable>
                    <View style={[styles.tabUnderlineTrack, { backgroundColor: colors.separator }]}>
                      <Animated.View
                        style={[styles.tabUnderlineBar, underlineStyle]}
                      />
                    </View>
                  </View>

                  <EmailIconField
                    label="אימייל"
                    value={email}
                    onChangeText={(t) => {
                      setEmail(t);
                      if (errors.email)
                        setErrors((e) => ({ ...e, email: undefined }));
                    }}
                    placeholder="you@example.com"
                    error={errors.email}
                    shakeStyle={emailShake.style}
                    accessibilityLabel="אימייל"
                    colors={colors}
                  />

                  <PasswordIconField
                    label="סיסמה"
                    value={password}
                    onChangeText={(t) => {
                      setPassword(t);
                      if (errors.password)
                        setErrors((e) => ({ ...e, password: undefined }));
                    }}
                    placeholder="לפחות 6 תווים, אותיות וספרה"
                    error={errors.password}
                    shakeStyle={passwordShake.style}
                    accessibilityLabel="סיסמה"
                    showPassword={showPassword}
                    onToggleShow={() => setShowPassword((s) => !s)}
                    colors={colors}
                  />

                  {tab === "register" ? (
                    <PasswordRequirements password={password} />
                  ) : null}

                  {tab === "login" ? (
                    <Pressable
                      style={styles.forgotLinkWrap}
                      onPress={() => {
                        setView("forgot");
                        clearErrors();
                      }}
                    >
                      <Text style={[styles.forgotLink, { color: colors.textSecondary }]}>שכחתי סיסמה</Text>
                    </Pressable>
                  ) : null}

                  {tab === "login" && Platform.OS === "web" ? (
                    <Pressable
                      style={styles.rememberRow}
                      onPress={() => setRememberMe((r) => !r)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: rememberMe }}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          { borderColor: colors.inputBorder, backgroundColor: colors.inputBg },
                          rememberMe && styles.checkboxOn,
                        ]}
                      >
                        {rememberMe ? (
                          <Text style={[styles.checkboxMark, { color: colors.text }]}>✓</Text>
                        ) : null}
                      </View>
                      <Text style={[styles.rememberLabel, { color: colors.textSecondary }]}>זכור אותי</Text>
                    </Pressable>
                  ) : null}

                  {errors.general ? (
                    <Animated.View
                      entering={FadeIn.duration(200)}
                      style={styles.generalErrorWrap}
                    >
                      <FieldError text={errors.general} />
                    </Animated.View>
                  ) : null}

                  <Animated.View style={generalShake.style}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.submitPressable,
                        pressed && styles.submitPressed,
                        busy && styles.submitDisabled,
                      ]}
                      onPress={() => void onSubmit()}
                      disabled={busy}
                    >
                      <LinearGradient
                        colors={["#4F6EF7", "#4F46E5", "#7C3AED"]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={styles.submitGradient}
                      >
                        {busy && submitLabel ? (
                          <View style={styles.loadingRow}>
                            <ActivityIndicator color="#FFF" size="small" />
                            <Text style={styles.submitText}>{submitLabel}</Text>
                          </View>
                        ) : (
                          <Text style={styles.submitText}>
                            {tab === "login" ? "כניסה" : "הרשמה"}
                          </Text>
                        )}
                      </LinearGradient>
                    </Pressable>
                  </Animated.View>
                </>
              )}
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#080C14",
  },
  meshBlue: {
    ...StyleSheet.absoluteFillObject,
    opacity: 1,
  },
  meshGray: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "52%",
  },
  kav: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 22,
    justifyContent: "center",
  },
  logoBlock: {
    alignItems: "center",
    marginBottom: 28,
  },
  logoText: {
    color: "#F8FAFC",
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: -0.5,
    textAlign: "center",
    textShadowColor: "rgba(59, 130, 246, 0.85)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
  },
  tagline: {
    marginTop: 10,
    color: "rgba(226, 232, 240, 0.62)",
    fontSize: 15,
    fontWeight: "500",
    textAlign: "center",
  },
  cardOuter: {
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    maxWidth: 440,
    width: "100%",
    alignSelf: "center",
  },
  cardTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  cardInner: {
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 26,
  },
  tabsRow: {
    flexDirection: "row-reverse",
    marginBottom: 8,
    position: "relative",
  },
  tabHit: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  tabLabel: {
    color: "rgba(226, 232, 240, 0.5)",
    fontSize: 16,
    fontWeight: "700",
  },
  tabLabelActive: {
    color: "#F1F5F9",
  },
  tabUnderlineTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  tabUnderlineBar: {
    position: "absolute",
    left: 0,
    bottom: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#60A5FA",
    shadowColor: "#4F6EF7",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  fieldBlock: {
    marginTop: 18,
  },
  fieldLabel: {
    color: "rgba(226, 232, 240, 0.75)",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
    marginBottom: 8,
  },
  iconInputRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
  },
  passwordIconRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
  },
  leadingIcon: {
    fontSize: 18,
  },
  eyeHit: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  eyeEmoji: {
    fontSize: 18,
  },
  iconInputFlex: {
    flex: 1,
    color: "#F8FAFC",
    fontSize: 16,
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  underlineWrap: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.2)",
  },
  underlineError: {
    borderBottomColor: "#F87171",
    borderBottomWidth: 2,
  },
  generalErrorWrap: {
    marginTop: 6,
  },
  fieldErrorRow: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 8,
    paddingRight: 2,
  },
  fieldErrorIcon: {
    fontSize: 14,
    marginTop: 1,
  },
  fieldErrorText: {
    flex: 1,
    color: "#FCA5A5",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
    lineHeight: 19,
  },
  forgotLinkWrap: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingVertical: 4,
  },
  forgotLink: {
    color: "rgba(147, 197, 253, 0.95)",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
  },
  rememberRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  checkboxOn: {
    borderColor: "rgba(96, 165, 250, 0.9)",
    backgroundColor: "rgba(37, 99, 235, 0.35)",
  },
  checkboxMark: {
    color: "#F8FAFC",
    fontSize: 13,
    fontWeight: "900",
    marginTop: -1,
  },
  rememberLabel: {
    color: "rgba(226, 232, 240, 0.82)",
    fontSize: 14,
    fontWeight: "600",
  },
  loadingRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
  },
  submitPressable: {
    marginTop: 28,
    borderRadius: 16,
    overflow: "hidden",
  },
  submitPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  submitDisabled: {
    opacity: 0.85,
  },
  submitGradient: {
    minHeight: 54,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  submitText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
  },
  successBlock: {
    alignItems: "center",
    paddingVertical: 32,
  },
  successCheck: {
    fontSize: 56,
    color: "#4ADE80",
    fontWeight: "800",
    textShadowColor: "rgba(74, 222, 128, 0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  successTitle: {
    marginTop: 16,
    color: "#ECFDF5",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  successHint: {
    marginTop: 8,
    color: "rgba(226, 232, 240, 0.65)",
    fontSize: 14,
    textAlign: "center",
  },
  backToLoginBtn: {
    marginTop: 22,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  backToLoginText: {
    color: "#E2E8F0",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  forgotIntro: {
    color: "rgba(226, 232, 240, 0.75)",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "right",
    marginBottom: 8,
  },
  forgotSentBlock: {
    alignItems: "center",
    paddingVertical: 20,
  },
  forgotSentTitle: {
    marginTop: 12,
    color: "#ECFDF5",
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 26,
    paddingHorizontal: 8,
  },
  forgotSentHint: {
    marginTop: 10,
    color: "rgba(226, 232, 240, 0.65)",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 4,
  },
  textLinkBtn: {
    marginTop: 18,
    alignSelf: "center",
    paddingVertical: 8,
  },
  textLink: {
    color: "rgba(147, 197, 253, 0.95)",
    fontSize: 15,
    fontWeight: "700",
  },
});
