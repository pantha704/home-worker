import { defineConfig, devices } from "@playwright/test";

// Hosted runs drive the deployed stack (see e2e/hosted.spec.ts), so they need
// no local dev server and must retain evidence when a live dependency fails.
const hostedE2E = process.env.HOSTED_E2E === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:13200",
    launchOptions: process.env.PLAYWRIGHT_CHROME_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
      : undefined,
    trace: hostedE2E ? "retain-on-failure" : "on-first-retry",
    screenshot: hostedE2E ? "only-on-failure" : "off",
  },
  webServer: hostedE2E ? undefined : {
    command: "NEXT_PUBLIC_RUNTIME_MODE=browser-preview npm run dev -- --hostname 127.0.0.1 --port 13200",
    url: "http://127.0.0.1:13200/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, fullyParallel: false },
  ],
});
