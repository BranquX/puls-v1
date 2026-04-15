import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const SUPABASE_URL = "https://owqqbgjtfpduikiigjdz.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93cXFiZ2p0ZnBkdWlraWlnamR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTIxMzEsImV4cCI6MjA5MDcyODEzMX0.MpaGoTSPVvNQpOwyI8_IqAUsAMyiJCi2Z1tQUBAXBDE";

/** Web בלבד: false = session ב-sessionStorage (נמחק בסגירת הדפדפן) */
export const AUTH_REMEMBER_KEY = "adchat_remember_me";

export function setAuthRememberPreference(remember: boolean): void {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    localStorage.setItem(AUTH_REMEMBER_KEY, remember ? "true" : "false");
  } catch {
    /* ignore */
  }
}

function getWebAuthStorage(): Storage {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as Storage;
  }
  try {
    const v = localStorage.getItem(AUTH_REMEMBER_KEY);
    if (v === "false") return sessionStorage;
    return localStorage;
  } catch {
    return localStorage;
  }
}

const webAuthStorage = {
  getItem: (key: string) => {
    return Promise.resolve(getWebAuthStorage().getItem(key));
  },
  setItem: (key: string, value: string) => {
    const store = getWebAuthStorage();
    const other = store === localStorage ? sessionStorage : localStorage;
    try {
      other.removeItem(key);
    } catch {
      /* ignore */
    }
    store.setItem(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    return Promise.resolve();
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: Platform.OS === "web" ? webAuthStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
  },
});
