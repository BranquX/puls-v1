import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../contexts/theme-context";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";

type Route = { key: string; name: string };

type SidebarProps = {
  state: { routes: Route[]; index: number };
  navigation: { emit: (e: any) => any; navigate: (name: string) => void };
  descriptors: Record<string, { options: { title?: string } }>;
};

const ACTIVE = "#4F6EF7";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const NAV_ITEMS: {
  route: string;
  label: string;
  icon: IconName;
  iconActive: IconName;
}[] = [
  { route: "index", label: "בית", icon: "home-outline", iconActive: "home" },
  { route: "campaigns", label: "קמפיינים", icon: "stats-chart-outline", iconActive: "stats-chart" },
  { route: "leads", label: "לידים", icon: "people-outline", iconActive: "people" },
  { route: "analytics", label: "ניתוח", icon: "analytics-outline", iconActive: "analytics" },
  { route: "chat", label: "צ'אט", icon: "chatbubbles-outline", iconActive: "chatbubbles" },
  { route: "library", label: "ספרייה", icon: "images-outline", iconActive: "images" },
  { route: "settings", label: "הגדרות", icon: "settings-outline", iconActive: "settings" },
];

export default function DesktopSidebar({ state, navigation }: SidebarProps) {
  const { colors, mode } = useTheme();
  const { sidebarWidth } = useResponsiveLayout();
  const isDark = mode === "dark";

  return (
    <View
      style={[
        styles.sidebar,
        {
          width: sidebarWidth,
          backgroundColor: isDark ? "#0D1117" : "#FFFFFF",
          borderLeftColor: colors.cardBorder,
        },
      ]}
    >
      {/* Brand */}
      <View style={styles.brand}>
        <View style={styles.brandRow}>
          <View style={[styles.logoMark, { backgroundColor: ACTIVE }]}>
            <Text style={styles.logoLetter}>{"\u3030"}</Text>
          </View>
          <Text style={[styles.brandName, { color: colors.text }]}>Puls.</Text>
        </View>
      </View>

      {/* Nav */}
      <View style={styles.navList}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const item = NAV_ITEMS.find((n) => n.route === route.name);
          if (!item) return null;

          return (
            <Pressable
              key={route.key}
              onPress={() => {
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
              style={({ pressed, hovered }: any) => [
                styles.navItem,
                focused && {
                  backgroundColor: isDark ? "rgba(79,110,247,0.12)" : "rgba(79,110,247,0.08)",
                },
                !focused && hovered && {
                  backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                },
                pressed && { opacity: 0.8 },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
            >
              <Ionicons
                name={focused ? item.iconActive : item.icon}
                size={18}
                color={focused ? ACTIVE : colors.textMuted}
              />
              <Text
                style={[
                  styles.navLabel,
                  { color: focused ? ACTIVE : colors.textMuted },
                  focused && styles.navLabelActive,
                ]}
                numberOfLines={1}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    borderLeftWidth: 1,
    alignSelf: "stretch",
    paddingTop: 20,
    paddingBottom: 12,
  },
  brand: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  brandRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
  },
  logoMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  logoLetter: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  brandName: {
    fontSize: 16,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  navList: {
    flex: 1,
    paddingHorizontal: 10,
    gap: 2,
  },
  navItem: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  navLabel: {
    fontSize: 13,
    fontWeight: "600",
    writingDirection: "rtl",
  },
  navLabelActive: {
    fontWeight: "700",
  },
});
