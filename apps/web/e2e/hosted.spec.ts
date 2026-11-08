import { expect, test } from "@playwright/test";
import path from "node:path";

/**
 * Hosted end-to-end coverage.
 *
 * These tests talk to the deployed Cloudflare Pages + Render + Supabase stack,
 * so they are opt-in: a normal `pnpm test:e2e` run must stay offline and must
 * not depend on live credentials. Set HOSTED_E2E=1 (plus SUPABASE_ACCESS_TOKEN
 * and, optionally, HOSTED_BASE_URL) to exercise the authenticated hosted path.
 */

const HOSTED_E2E = process.env.HOSTED_E2E === "1";
const BASE_URL = (process.env.HOSTED_BASE_URL ?? "https://homeworker-43k.pages.dev").replace(/\/+$/, "");
const API_URL = (process.env.HOSTED_API_URL ?? "https://homeworker-api.onrender.com").replace(/\/+$/, "");
// supabase-js derives this key from the project URL; the hosted project is
// lsbnoltwcwwzgszuuxfh. Keep the literal so a typo in another env var cannot
// silently seed a key the browser never reads.
const SUPABASE_STORAGE_KEY = "sb-lsbnoltwcwwzgszuuxfh-auth-token";
const FIXTURE = path.resolve(process.cwd(), "../../fixtures/sample-typed.pdf");

interface AccessTokenClaims {
  sub?: string;
  email?: string;
  role?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

function decodeAccessToken(token: string): Required<Pick<AccessTokenClaims, "sub" | "exp">> & AccessTokenClaims {
  const segment = token.split(".")[1];
  if (!segment) throw new Error("SUPABASE_ACCESS_TOKEN is not a JWT (no payload segment)");
  const claims = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as AccessTokenClaims;
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new Error("SUPABASE_ACCESS_TOKEN has no sub claim");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) {
    throw new Error("SUPABASE_ACCESS_TOKEN is expired or has no exp claim");
  }
  return claims as Required<Pick<AccessTokenClaims, "sub" | "exp">> & AccessTokenClaims;
}

/**
 * Build the exact session object supabase-js persists in localStorage. Only the
 * access token is handed to this spec; the user block is derived from the JWT
 * claims rather than minted from a second credential.
 */
function buildStoredSession(token: string) {
  const claims = decodeAccessToken(token);
  const signedInAt = new Date((claims.iat ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: Math.max(0, claims.exp - Math.floor(Date.now() / 1000)),
    expires_at: claims.exp,
    refresh_token: "",
    user: {
      id: claims.sub,
      aud: claims.aud ?? "authenticated",
      role: claims.role ?? "authenticated",
      email: claims.email ?? "",
      email_confirmed_at: signedInAt,
      phone: "",
      confirmed_at: signedInAt,
      last_sign_in_at: signedInAt,
      app_metadata: claims.app_metadata ?? { provider: "email", providers: ["email"] },
      user_metadata: claims.user_metadata ?? {},
      identities: [],
      created_at: signedInAt,
      updated_at: signedInAt,
      is_anonymous: false,
    },
  };
}

function requiredAccessToken(): string {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is required when HOSTED_E2E=1; mint it with the Supabase password grant",
    );
  }
  return token;
}

test.skip(!HOSTED_E2E, "Hosted end-to-end coverage runs only with HOSTED_E2E=1.");

test.beforeAll(() => {
  requiredAccessToken();
});

test.describe("hosted stack", () => {
  test("landing page returns 200 over HTTPS with the hosted CSP", async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    expect(response, "the hosted landing page must produce a navigation response").not.toBeNull();
    expect(response!.status()).toBe(200);
    expect(new URL(page.url()).protocol).toBe("https:");

    const csp = response!.headers()["content-security-policy"] ?? "";
    expect(csp, "hosted landing page must send Content-Security-Policy").not.toBe("");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain(`connect-src 'self' ${API_URL}`);

    await expect(page.getByRole("heading", { name: /sign in to protect your projects/i })).toBeVisible();
  });

  test("a seeded Supabase session reveals the authenticated upload UI", async ({ context, page }) => {
    const session = buildStoredSession(requiredAccessToken());
    await context.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [SUPABASE_STORAGE_KEY, JSON.stringify(session)],
    );

    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });

    await expect(page.getByLabel(/drop your notes/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /turn into handwritten notes/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /sign in to protect your projects/i })).toHaveCount(0);

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), SUPABASE_STORAGE_KEY);
    expect(stored, "the seeded session must survive the page load").toContain(session.access_token);
  });

  test("a real browser upload crosses CORS and reaches review", async ({ context, page }) => {
    test.setTimeout(300_000);

    const consoleErrors: string[] = [];
    const failedApiRequests: string[] = [];
    const apiResponses: { method: string; url: string; status: number }[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("requestfailed", (request) => {
      if (!request.url().startsWith(`${API_URL}/`)) return;
      failedApiRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "unknown"}`);
    });
    page.on("response", (response) => {
      if (!response.url().startsWith(`${API_URL}/`)) return;
      apiResponses.push({
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
      });
    });

    const session = buildStoredSession(requiredAccessToken());
    await context.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [SUPABASE_STORAGE_KEY, JSON.stringify(session)],
    );

    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/drop your notes/i).setInputFiles(FIXTURE);
    await page.getByRole("button", { name: /turn into handwritten notes/i }).click();

    // The upload POST is browser-issued multipart with Authorization,
    // X-Homeworker-Client, and Idempotency-Key headers, so Chromium/Firefox
    // must complete a real CORS preflight before this navigation can happen.
    await expect(page).toHaveURL(/\/project\/?\?id=[0-9a-f-]{36}$/i, { timeout: 240_000 });
    const projectId = new URL(page.url()).searchParams.get("id");
    expect(projectId).toMatch(/^[0-9a-f-]{36}$/i);

    await expect(page.getByText(/needs review/i).first()).toBeVisible({ timeout: 180_000 });
    const editor = page.getByRole("textbox", { name: /extracted text for page 1/i });
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await expect(editor).toHaveValue(/homeworker/i, { timeout: 60_000 });

    const createResponse = apiResponses.find(
      (response) => response.method === "POST" && response.url === `${API_URL}/v1/projects`,
    );
    expect(
      createResponse,
      `expected the browser to POST /v1/projects; saw ${JSON.stringify(apiResponses)}`,
    ).toBeTruthy();
    expect(createResponse!.status).toBe(201);
    expect(apiResponses.filter((response) => response.status >= 400)).toEqual([]);
    expect(failedApiRequests).toEqual([]);
    expect(consoleErrors.filter((text) => /CORS|Access-Control|blocked by/i.test(text))).toEqual([]);
  });
});
