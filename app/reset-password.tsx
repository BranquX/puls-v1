import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Platform,
  ActivityIndicator,
  ScrollView,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StatusBar,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInUp,
  type AnimatedStyle,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { PasswordRequirements } from "../components/password-requirements";
import { firstPasswordValidationError } from "../lib/password-validation";
import { supabase } from "../lib/supabase";
import { useTheme } from "../contexts/theme-context";

type ViewStyle = import("react-native").ViewStyle;

export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [ready, setReady] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const focusPw = useSharedValue(0);
  const focusCf = useSharedValue(0);

  const inputBorderColor = colors.inputBorder;
  const linePw = useAnimatedStyle<ViewStyle>(() => ({
    borderBottomColor: focusPw.value
      ? "rgba(96, 165, 250, 0.95)"
      : inputBorderColor,
    borderBottomWidth: focusPw.value ? 2 : 1,
  }));

  const lineCf = useAnimatedStyle<ViewStyle>(() => ({
    borderBottomColor: focusCf.value
      ? "rgba(96, 165, 250, 0.95)"
      : inputBorderColor,
    borderBottomWidth: focusCf.value ? 2 : 1,
  }));

  useEffect(() => {
    let cancelled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (cancelled) return;
        if (event === "PASSWORD_RECOVERY" || session) {
          setReady(true);
        }
      },
    );

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) setReady(true);
      setSessionChecked(true);
    });

    const t = setTimeout(() => {
      if (!cancelled) setSessionChecked(true);
    }, 2500);

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  const onSubmit = useCallback(async () => {
    Keyboard.dismiss();
    setError(null);

    const pwErr = firstPasswordValidationError(password);
    if (pwErr) {
      setError(pwErr);
      return;
    }
    if (password !== confirm) {
      setError("הסיסמאות אינן תואמות");
      return;
    }

    setBusy(true);
    try {
      const { error: upErr } = await supabase.auth.updateUser({
        password,
      });
      if (upErr) {
        setError(upErr.message || "עדכון הסיסמה נכשל");
        return;
      }
      setSuccess(true);
      setTimeout(() => {
        router.replace("/");
      }, 1600);
    } finally {
      setBusy(false);
    }
  }, [password, confirm, router]);

  const glassExtra =
    Platform.OS === "web"
      ? ({
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
        } as Record<string, string>)
      : {};

  const invalidLink = sessionChecked && !ready && !success;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]} accessibilityLanguage="he">
      <StatusBar barStyle={colors.statusBar} />

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <LinearGradient
          colors={[colors.bg, colors.bg, colors.bgSecondary]}
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
            <Text style={[styles.logoText, { color: colors.text }]}>Puls.</Text>
            <Text style={[styles.tagline, { color: colors.textMuted }]}>איפוס סיסמה</Text>
          </Animated.View>

          <Animated.View
            entering={FadeInUp.duration(520)
              .delay(80)
              .easing(Easing.out(Easing.cubic))}
            style={[styles.cardOuter, { borderColor: colors.cardBorder }, glassExtra]}
          >
            <View style={[styles.cardTint, { backgroundColor: colors.cardBg }]} />

            <View style={styles.cardInner}>
              {success ? (
                <Animated.View
                  entering={FadeIn.duration(350)}
                  style={styles.successBlock}
                >
                  <Text style={styles.successCheck}>✓</Text>
                  <Text style={[styles.successTitle, { color: colors.text }]}>
                    הסיסמה עודכנה! מעביר לדשבורד...
                  </Text>
                  <ActivityIndicator color="#86EFAC" style={{ marginTop: 16 }} />
                </Animated.View>
              ) : invalidLink ? (
                <View style={styles.centerMsg}>
                  <Text style={styles.errTitle}>הקישור אינו תקין</Text>
                  <Text style={[styles.errBody, { color: colors.textSecondary }]}>
                    ייתכן שהקישור פג או כבר נוצל. בקשו קישור חדש ממסך הכניסה.
                  </Text>
                  <Pressable
                    style={[styles.secondaryBtn, { backgroundColor: colors.inputBg, borderColor: colors.inputBorder }]}
                    onPress={() => router.replace("/auth")}
                  >
                    <Text style={[styles.secondaryBtnText, { color: colors.text }]}>חזרה לכניסה</Text>
                  </Pressable>
                </View>
              ) : !ready ? (
                <View style={styles.centerMsg}>
                  <ActivityIndicator color="#93C5FD" size="large" />
                  <Text style={[styles.loadingText, { color: colors.textSecondary }]}>מאמתים קישור…</Text>
                </View>
              ) : (
                <>
                  <Text style={[styles.intro, { color: colors.textSecondary }]}>
                    בחרו סיסמה חדשה לחשבון שלכם.
                  </Text>

                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>סיסמה חדשה</Text>
                  <Animated.View style={[styles.underlineWrap, linePw]}>
                    <View style={styles.iconRow}>
                      <Text style={styles.fieldIcon}>🔒</Text>
                      <TextInput
                        style={[styles.inputFlex, { color: colors.text }]}
                        value={password}
                        onChangeText={setPassword}
                        placeholder="לפחות 6 תווים, אותיות וספרה"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry
                        textAlign="right"
                        autoCapitalize="none"
                        onFocus={() => {
                          focusPw.value = withTiming(1, { duration: 160 });
                        }}
                        onBlur={() => {
                          focusPw.value = withTiming(0, { duration: 200 });
                        }}
                      />
                    </View>
                  </Animated.View>

                  <PasswordRequirements password={password} />

                  <Text style={[styles.fieldLabel, { marginTop: 18, color: colors.textSecondary }]}>
                    אימות סיסמה
                  </Text>
                  <Animated.View style={[styles.underlineWrap, lineCf]}>
                    <View style={styles.iconRow}>
                      <Text style={styles.fieldIcon}>🔒</Text>
                      <TextInput
                        style={[styles.inputFlex, { color: colors.text }]}
                        value={confirm}
                        onChangeText={setConfirm}
                        placeholder="הזינו שוב"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry
                        textAlign="right"
                        autoCapitalize="none"
                        onFocus={() => {
                          focusCf.value = withTiming(1, { duration: 160 });
                        }}
                        onBlur={() => {
                          focusCf.value = withTiming(0, { duration: 200 });
                        }}
                      />
                    </View>
                  </Animated.View>

                  {error ? (
                    <Animated.View
                      entering={FadeIn.duration(200)}
                      style={styles.errorRow}
                    >
                      <Text style={styles.errorIcon}>⚠️</Text>
                      <Text style={styles.errorText}>{error}</Text>
                    </Animated.View>
                  ) : null}

                  <Pressable
                    style={({ pressed }) => [
                      styles.submitOuter,
                      pressed && { opacity: 0.92 },
                      busy && { opacity: 0.85 },
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
                      {busy ? (
                        <View style={styles.loadingRow}>
                          <ActivityIndicator color="#FFF" size="small" />
                          <Text style={styles.submitText}>מעדכן…</Text>
                        </View>
                      ) : (
                        <Text style={styles.submitText}>עדכון סיסמה</Text>
                      )}
                    </LinearGradient>
                  </Pressable>
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
  root: { flex: 1, backgroundColor: "#080C14" },
  meshBlue: { ...StyleSheet.absoluteFillObject },
  meshGray: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "52%",
  },
  kav: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 22,
    justifyContent: "center",
  },
  logoBlock: { alignItems: "center", marginBottom: 28 },
  logoText: {
    color: "#F8FAFC",
    fontSize: 36,
    fontWeight: "900",
    textAlign: "center",
    textShadowColor: "rgba(59, 130, 246, 0.85)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  tagline: {
    marginTop: 10,
    color: "rgba(226, 232, 240, 0.62)",
    fontSize: 15,
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
  intro: {
    color: "rgba(226, 232, 240, 0.75)",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "right",
    marginBottom: 8,
  },
  fieldLabel: {
    color: "rgba(226, 232, 240, 0.75)",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
    marginBottom: 8,
  },
  underlineWrap: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.2)",
  },
  iconRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
  },
  fieldIcon: { fontSize: 18 },
  inputFlex: {
    flex: 1,
    color: "#F8FAFC",
    fontSize: 16,
    paddingVertical: 10,
  },
  errorRow: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 12,
  },
  errorIcon: { fontSize: 14, marginTop: 1 },
  errorText: {
    flex: 1,
    color: "#FCA5A5",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
  },
  submitOuter: {
    marginTop: 28,
    borderRadius: 16,
    overflow: "hidden",
  },
  submitGradient: {
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  loadingRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
  },
  submitText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
  },
  centerMsg: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 14,
  },
  loadingText: {
    color: "rgba(226, 232, 240, 0.7)",
    fontSize: 15,
    textAlign: "center",
  },
  errTitle: {
    color: "#FCA5A5",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  errBody: {
    color: "rgba(226, 232, 240, 0.75)",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  secondaryBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  secondaryBtnText: {
    color: "#E2E8F0",
    fontSize: 15,
    fontWeight: "700",
  },
  successBlock: { alignItems: "center", paddingVertical: 28 },
  successCheck: {
    fontSize: 56,
    color: "#4ADE80",
    fontWeight: "800",
  },
  successTitle: {
    marginTop: 16,
    color: "#ECFDF5",
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
  },
});
