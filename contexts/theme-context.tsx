import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

type ThemeMode = "dark" | "light";

type ThemeColors = {
  bg: string;
  bgSecondary: string;
  cardBg: string;
  cardBorder: string;
  inputBg: string;
  inputBorder: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textOnAccent: string;
  separator: string;
  overlay: string;
  tabBar: string;
  tabBarBorder: string;
  statusBar: "light-content" | "dark-content";
  // semantic
  pillBg: string;
  pillBorder: string;
  skeletonBg: string;
  badgeBg: string;
};

const DARK: ThemeColors = {
  bg: "#0A0F1E",
  bgSecondary: "#131A23",
  cardBg: "rgba(255,255,255,0.05)",
  cardBorder: "rgba(255,255,255,0.08)",
  inputBg: "rgba(255,255,255,0.06)",
  inputBorder: "rgba(255,255,255,0.08)",
  text: "#F3F6FF",
  textSecondary: "rgba(243,246,255,0.70)",
  textMuted: "rgba(243,246,255,0.50)",
  textOnAccent: "#FFFFFF",
  separator: "rgba(255,255,255,0.06)",
  overlay: "rgba(0,0,0,0.60)",
  tabBar: "#0D1117",
  tabBarBorder: "transparent",
  statusBar: "light-content",
  pillBg: "rgba(255,255,255,0.10)",
  pillBorder: "rgba(255,255,255,0.16)",
  skeletonBg: "rgba(255,255,255,0.08)",
  badgeBg: "rgba(255,255,255,0.14)",
};

const LIGHT: ThemeColors = {
  bg: "#F5F5F7",
  bgSecondary: "#EEEEF2",
  cardBg: "#FFFFFF",
  cardBorder: "rgba(0,0,0,0.08)",
  inputBg: "rgba(0,0,0,0.04)",
  inputBorder: "rgba(0,0,0,0.10)",
  text: "#1A1A2E",
  textSecondary: "rgba(26,26,46,0.65)",
  textMuted: "rgba(26,26,46,0.45)",
  textOnAccent: "#FFFFFF",
  separator: "rgba(0,0,0,0.06)",
  overlay: "rgba(0,0,0,0.40)",
  tabBar: "#FFFFFF",
  tabBarBorder: "rgba(0,0,0,0.08)",
  statusBar: "dark-content",
  pillBg: "rgba(0,0,0,0.06)",
  pillBorder: "rgba(0,0,0,0.10)",
  skeletonBg: "rgba(0,0,0,0.06)",
  badgeBg: "rgba(0,0,0,0.06)",
};

type ThemeContextValue = {
  mode: ThemeMode;
  colors: ThemeColors;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  mode: "dark",
  colors: DARK,
  toggle: () => {},
});

const STORAGE_KEY = "adchat:theme-mode";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("dark");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === "light" || v === "dark") setMode(v);
    });
  }, []);

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      AsyncStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const colors = mode === "dark" ? DARK : LIGHT;

  return (
    <ThemeContext.Provider value={{ mode, colors, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

/** Reusable dynamic style sheet hook — returns memoized base overrides */
export function useThemeStyles() {
  const { colors, mode } = useTheme();
  return useMemo(
    () =>
      StyleSheet.create({
        safeArea: { backgroundColor: colors.bg },
        container: { backgroundColor: colors.bg },
        card: { backgroundColor: colors.cardBg, borderColor: colors.cardBorder },
        input: { backgroundColor: colors.inputBg, borderColor: colors.inputBorder, color: colors.text },
        text: { color: colors.text },
        textSec: { color: colors.textSecondary },
        textMuted: { color: colors.textMuted },
        separator: { backgroundColor: colors.separator },
        overlay: { backgroundColor: colors.overlay },
        bgSecondary: { backgroundColor: colors.bgSecondary },
      }),
    [colors],
  );
}
