import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import type { Session } from "@supabase/supabase-js";
import { BusinessProvider } from "../contexts/business-context";
import { ThemeProvider } from "../contexts/theme-context";
import { supabase } from "../lib/supabase";

void SplashScreen.preventAutoHideAsync();

function isPublicRoute(segment: string | undefined) {
  return (
    segment === "auth" ||
    segment === "reset-password" ||
    segment === "oauth-success"
  );
}

export default function RootLayout() {
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    void SplashScreen.hideAsync();
  }, [session]);

  useEffect(() => {
    if (session === undefined) return;
    const seg0 = segments[0];
    const isPublic = isPublicRoute(seg0);

    if (!session && !isPublic) {
      router.replace("/auth");
    } else if (session && seg0 === "auth") {
      router.replace("/");
    }
  }, [session, segments, router]);

  if (!mounted) return null;

  return (
    <ThemeProvider>
    <BusinessProvider>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="auth" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="oauth-success" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="campaign" />
      </Stack>
    </BusinessProvider>
    </ThemeProvider>
  );
}
