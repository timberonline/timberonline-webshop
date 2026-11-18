import { defineConfig, devices } from "@playwright/test";

/** Browsertests tegen een draaiende app (lokaal: npm run dev met .env.local; of E2E_BASE_URL). */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "off", screenshot: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "mobiel", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
});
