import { supabase } from "./supabase";

/** כותרות Authorization לקריאות לשרת Puls. (JWT של Supabase). */
export async function adchatServerAuthHeaders(): Promise<
  Record<string, string>
> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token?.trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export async function fetchAdchatApi(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const auth = await adchatServerAuthHeaders();
  const headers = new Headers(init.headers ?? undefined);
  if (auth.Authorization) headers.set("Authorization", auth.Authorization);
  return fetch(input, { ...init, headers });
}
