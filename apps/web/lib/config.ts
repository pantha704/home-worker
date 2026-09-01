const DEFAULT_API_BASE_URL = "http://localhost:8000";

export type RuntimeMode = "local-service" | "browser-preview" | "hosted";

export function getRuntimeMode(): RuntimeMode {
  const configured = process.env.NEXT_PUBLIC_RUNTIME_MODE;
  if (configured === "hosted" || configured === "browser-preview" || configured === "local-service") {
    return configured;
  }
  return process.env.NEXT_PUBLIC_STATIC_EXPORT === "1" ? "browser-preview" : "local-service";
}

export function isHostedMode(): boolean {
  return getRuntimeMode() === "hosted";
}

export function isBrowserPreviewMode(): boolean {
  return getRuntimeMode() === "browser-preview";
}

export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (isHostedMode() && !configured) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL is required in hosted mode");
  }
  return (configured || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export function getSupabaseBrowserConfig(): { publishableKey: string; url: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required in hosted mode",
    );
  }
  return { publishableKey, url };
}
