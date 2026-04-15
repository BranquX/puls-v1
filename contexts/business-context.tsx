import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../lib/supabase";

export type Business = {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  phone?: string | null;
  address?: string | null;
  description?: string | null;
  brand_logo?: string | null;
  brand_colors?: unknown;
  brand_font?: string | null;
  brand_tone?: unknown;
  brand_avoid?: string | null;
  target_age_min?: number | null;
  target_age_max?: number | null;
  target_gender?: string | null;
  target_geo?: string | null;
  competitors?: unknown;
  brand_differentiator?: string | null;
  meta_account_id: string | null;
  google_account_id: string | null;
  meta_user_id: string | null;
  user_id?: string | null;
  created_at?: string;
  meta_ad_account_ids?: unknown;
  meta_page_ids?: unknown;
  meta_instagram_ids?: unknown;
  meta_pixel_ids?: unknown;
  selected_ad_account_id?: string | null;
  selected_page_id?: string | null;
  selected_instagram_id?: string | null;
  selected_pixel_id?: string | null;
};

type BusinessContextValue = {
  business: Business | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const BusinessContext = createContext<BusinessContextValue | null>(null);

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id ?? null;

    if (!uid) {
      setBusiness(null);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("businesses")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      setBusiness(null);
      setLoading(false);
      return;
    }

    if (!data) {
      setBusiness(null);
      setLoading(false);
      return;
    }

    const { meta_access_token: _omitToken, ...rest } = data as Business & {
      meta_access_token?: string;
    };
    setBusiness(rest as Business);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  const value = useMemo(
    () => ({ business, loading, refresh }),
    [business, loading, refresh],
  );

  return (
    <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>
  );
}

export function useBusiness() {
  const ctx = useContext(BusinessContext);
  if (!ctx) {
    throw new Error("useBusiness must be used within BusinessProvider");
  }
  return ctx;
}
