import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT ?? "8200";

export default defineConfig({
  testDir: "./e2e/app",
  globalTeardown: "./e2e/app/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 15_000,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-US",
    timezoneId: "Europe/Helsinki",
    trace: "on-first-retry",
  },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm run e2e:server",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
