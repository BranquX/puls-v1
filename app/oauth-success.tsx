import { useEffect } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useBusiness } from "../contexts/business-context";
import { useTheme } from "../contexts/theme-context";

export default function OauthSuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    meta_connected?: string;
    business_id?: string;
  }>();
  const { refresh } = useBusiness();
  const { colors } = useTheme();

  useEffect(() => {
    if (params.meta_connected !== "true") {
      router.replace("/");
      return;
    }

    let cancelled = false;
    void (async () => {
      await refresh();
      if (cancelled) return;
      if (
        Platform.OS === "web" &&
        typeof window !== "undefined" &&
        window.opener
      ) {
        try {
          window.opener.postMessage(
            { type: "adchat-meta-oauth", ok: true },
            "*",
          );
        } catch {
          /* ignore */
        }
        window.close();
        return;
      }
      router.replace("/(tabs)/settings");
    })();

    return () => {
      cancelled = true;
    };
  }, [params.meta_connected, refresh, router]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ActivityIndicator color="#5B8CFF" size="large" />
      <Text style={[styles.hint, { color: colors.textSecondary }]}>מסיימים חיבור…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0B0F17",
  },
  hint: {
    marginTop: 16,
    color: "rgba(243, 246, 255, 0.75)",
    fontSize: 15,
    writingDirection: "rtl",
  },
});
