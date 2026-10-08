import { defineConfig } from "@playwright/test";

const PORT = 3210;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const databaseUrl = process.env.DATABASE_URL;
const demoPassword = process.env.SCREENSHOT_DEMO_PASSWORD;

if (!databaseUrl) {
  throw new Error(
    "Screenshots need DATABASE_URL pointing at your local test database " +
      "(the same one vitest uses, e.g. postgresql://autoeco:autoeco@127.0.0.1:5432/autoeco_test)."
  );
}
if (!demoPassword) {
  throw new Error(
    "Screenshots need SCREENSHOT_DEMO_PASSWORD set: the password for the demo " +
      "user they log in as. It is read from the environment and never stored here."
  );
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.capture.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  outputDir: "./.playwright-artifacts",
  reporter: [["list"]],
  globalSetup: "./e2e/seed-global.ts",
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: databaseUrl,
      PREVIEW_PENDING_LOCALES: "1",
      NEXT_PUBLIC_PREVIEW_PENDING_LOCALES: "1",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "screenshot-only-dev-secret-0123456789abcdef",
      NEXT_PUBLIC_APP_URL: BASE_URL,
      EMAIL_PROVIDER: "console",
      CAPTCHA_PROVIDER: "none",
      ...process.env,
    },
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
});