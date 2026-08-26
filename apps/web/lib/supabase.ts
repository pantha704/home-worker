import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserConfig, isHostedMode } from "@/lib/config";

let browserClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!isHostedMode()) {
    throw new Error("Supabase Auth is only available in hosted mode");
  }
  if (!browserClient) {
    const { publishableKey, url } = getSupabaseBrowserConfig();
    browserClient = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  }
  return browserClient;
}

export async function getAccessToken(): Promise<string | null> {
  if (!isHostedMode()) return null;
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? null;
}

export async function clearBrowserSession(): Promise<void> {
  if (!isHostedMode()) return;
  await getSupabaseClient().auth.signOut({ scope: "local" });
}
