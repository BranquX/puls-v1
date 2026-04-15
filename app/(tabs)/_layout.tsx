import { Tabs } from "expo-router";
import React, { useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../contexts/theme-context";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import DesktopSidebar from "../../components/DesktopSidebar";

type TabKey = "index" | "campaigns" | "leads" | "analytics" | "chat" | "library" | "settings";

const ACTIVE = "#4F6EF7";

function TabIcon({
  name,
  focused,
  inactiveColor,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  focused: boolean;
  inactiveColor: string;
}) {
  return (
    <View style={styles.iconWrap}>
      <View style={[styles.iconBg, focused && styles.iconBgOn]}>
        <Ionicons name={name} size={24} color={focused ? ACTIVE : inactiveColor} />
      </View>
      {focused ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
    </View>
  );
}

function makeTabButton(routeName: TabKey) {
  return function TabButton(props: any) {
    const { colors } = useTheme();
    const inactiveColor = colors.textMuted;
    const scale = useRef(new Animated.Value(1)).current;
    const onPressIn = () => {
      Animated.spring(scale, {
        toValue: 0.96,
        useNativeDriver: true,
        speed: 28,
        bounciness: 0,
      }).start();
    };
    const onPressOut = () => {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 28,
        bounciness: 6,
      }).start();
    };
    const focused = Boolean(props?.accessibilityState?.selected);
    const label =
      routeName === "index"
        ? "בית"
        : routeName === "campaigns"
          ? "קמפיינים"
          : routeName === "leads"
            ? "לידים"
            : routeName === "analytics"
              ? "ניתוח"
              : routeName === "chat"
                ? "צ'אט"
                : routeName === "library"
                  ? "ספרייה"
                  : "הגדרות";
    return (
      <Pressable
        {...props}
        onPressIn={(e: any) => {
          onPressIn();
          props?.onPressIn?.(e);
        }}
        onPressOut={(e: any) => {
          onPressOut();
          props?.onPressOut?.(e);
        }}
        style={[styles.btn, props?.style]}
      >
        <Animated.View style={[styles.btnInner, { transform: [{ scale }] }]}>
          {props.children}
          <Text style={[styles.label, { color: focused ? ACTIVE : inactiveColor }]}>
            {label}
          </Text>
        </Animated.View>
      </Pressable>
    );
  };
}

/**
 * On desktop (>768px): hide bottom tab bar, render a DesktopSidebar via the
 * custom `tabBar` prop. The `tabBar` callback receives the navigation state
 * so the sidebar can highlight the active route and navigate.
 *
 * expo-router's Tabs renders the custom tabBar component *within* its own
 * flex container. Setting `tabBarPosition: "left"` makes the Tabs component
 * lay out the tab bar and the screen side-by-side instead of stacked.
 */
export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isDesktop, sidebarWidth } = useResponsiveLayout();

  const buttons = useMemo(
    () => ({
      index: makeTabButton("index"),
      campaigns: makeTabButton("campaigns"),
      leads: makeTabButton("leads"),
      analytics: makeTabButton("analytics"),
      chat: makeTabButton("chat"),
      library: makeTabButton("library"),
      settings: makeTabButton("settings"),
    }),
    [],
  );

  return (
    <Tabs
      tabBar={
        isDesktop
          ? (props) => <DesktopSidebar {...(props as any)} />
          : undefined
      }
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: colors.textMuted,
        ...(isDesktop
          ? {
              tabBarPosition: "right" as any,
              tabBarStyle: {
                width: sidebarWidth,
                minHeight: "100%",
                backgroundColor: "transparent",
                borderWidth: 0,
                elevation: 0,
                shadowOpacity: 0,
              },
            }
          : {
              tabBarStyle: {
                backgroundColor: colors.tabBar,
                borderTopWidth: 1,
                borderTopColor: colors.tabBarBorder,
                height: 80,
                paddingBottom: Math.max(16, insets.bottom),
                paddingTop: 8,
                elevation: 0,
                shadowColor: "transparent",
              },
            }),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "בית",
          tabBarButton: isDesktop ? undefined : buttons.index,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              focused={focused}
              inactiveColor={colors.textMuted}
              name={focused ? "home" : "home-outline"}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="campaigns"
        options={{
          title: "קמפיינים",
          tabBarButton: isDesktop ? undefined : buttons.campaigns,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              focused={focused}
              inactiveColor={colors.textMuted}
              name={focused ? "stats-chart" : "stats-chart-outline"}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: "לידים",
          tabBarButton: isDesktop ? undefined : buttons.leads,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              focused={focused}
              inactiveColor={colors.textMuted}
              name={focused ? "people" : "people-outline"}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: "ניתוח",
          tabBarButton: isDesktop ? undefined : buttons.analytics,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              focused={focused}
              inactiveColor={colors.textMuted}
              name={focused ? "analytics" : "analytics-outline"}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "צ'אט",
          tabBarButton: isDesktop ? undefined : buttons.chat,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              focused={focused}
              inactiveColor={colors.textMuted}
              name={focused ? "chatbubbles" : "chatbubbles-outline"}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "ספרייה",
          tabBarButton: isDesktop ? undefined : buttons.library,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              focused={focused}
              inactiveColor={colors.textMuted}
              name={focused ? "images" : "images-outline"}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "הגדרות",
          tabBarButton: isDesktop ? undefined : buttons.settings,
          tabBarIcon: ({ focused }) => (
            <TabIcon
              focused={focused}
              inactiveColor={colors.textMuted}
              name={focused ? "settings" : "settings-outline"}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  btn: {
    flex: 1,
  },
  btnInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  iconBg: {
    padding: 6,
    borderRadius: 12,
  },
  iconBgOn: {
    backgroundColor: "rgba(79,110,247,0.12)",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ACTIVE,
  },
  dotSpacer: {
    width: 6,
    height: 6,
  },
  label: {
    fontSize: 10,
    fontWeight: "500",
    writingDirection: "rtl",
  },
});
