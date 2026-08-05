import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the frontend PWA e2e suite.
 *
 * Targets the app in MOCK MODE (`NEXT_PUBLIC_USE_TINODE` unset) so no companion /
 * Tinode backend is needed — only the Next.js dev server must be running.
 *
 *   1. Start the app:   npm run dev            (serves http://localhost:3001)
 *   2. Run the suite:   npm run test:e2e
 *
 * Point at a different origin with BASE_URL, e.g.:
 *   BASE_URL=http://localhost:3000 npm run test:e2e
 *
 * The app renders inside a CSS phone frame; the viewport is set to 390×844 to
 * match it. Playwright auto-scrolls elements into view before interacting, so
 * the frame's border/centering never blocks clicks.
 */
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./tests/e2e",
  // Generous: the Next.js dev server compiles /anoon on first hit, which can be slow.
  timeout: 60_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    navigationTimeout: 45_000,
    viewport: { width: 390, height: 844 },
    permissions: ["clipboard-read", "clipboard-write", "notifications"],
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Override the device's default (desktop) viewport with the phone frame.
        viewport: { width: 390, height: 844 },
      },
    },
  ],

  // The dev server is started manually (see header). To let Playwright manage it,
  // uncomment the block below — but ensure NEXT_PUBLIC_USE_TINODE is NOT set so
  // the app stays in mock mode.
  // webServer: {
  //   command: "npm run dev",
  //   url: BASE_URL,
  //   reuseExistingServer: true,
  //   timeout: 120_000,
  // },
});
