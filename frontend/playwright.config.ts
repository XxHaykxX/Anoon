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
  // The mock suite is stateless (no backend), so it parallelises freely. The
  // real/ suite is NOT: every file drives the SAME two seeded accounts
  // (admin1/admin2) against one live backend, so parallel files fight over the
  // shared state — the roulette queue, the active match, the p2p topic, the
  // friends list. A full parallel run produced six spurious "Target page,
  // context or browser has been closed" failures that all vanished at
  // --workers=1; do not lift this without giving each file its own accounts.
  workers: process.env.E2E_REAL === "1" ? 1 : undefined,
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
      // The admin panel is a different app on a different origin with a desktop
      // layout — it gets its own project below, and must not be swept up by the
      // phone-framed default one.
      //
      // A regex anchored on the tests path, NOT the glob "**/admin/**": globs
      // are matched against the ABSOLUTE path, which on this machine is
      // C:\Users\Admin\… — so that glob ignored every spec in the repo and the
      // whole suite silently listed zero tests.
      // Same for the mobile project below: a different app on a different port.
      testIgnore: /[\\/]tests[\\/]e2e[\\/](admin|mobile)[\\/]/,
      use: {
        ...devices["Desktop Chrome"],
        // Override the device's default (desktop) viewport with the phone frame.
        viewport: { width: 390, height: 844 },
      },
    },
    {
      // The admin panel (admin/, :3002). Opt-in — `--project=admin` with
      // E2E_ADMIN=1 and ADMIN_SESSION_SECRET; see tests/e2e/admin/helpers.ts for
      // what has to be running and why the app must be BUILT in api mode.
      name: "admin",
      testDir: "./tests/e2e/admin",
      // Not parallel: these drive ONE live backend and some of them mutate it —
      // the role-gate test bans a user for a moment, which the overview's
      // «Активных банов» card counts, so a parallel run had it comparing the
      // card against a number that was true a second earlier.
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.ADMIN_BASE_URL ?? "http://localhost:3002",
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      // The Expo client's web export (mobile/), driven against a live stand —
      // the only way to exercise the native bundle on a machine with no device
      // and no Android SDK. Opt-in with E2E_MOBILE=1; see the spec's header for
      // the three commands that put the bundle on :3000.
      name: "mobile",
      testDir: "./tests/e2e/mobile",
      fullyParallel: false,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.MOBILE_BASE_URL ?? "http://127.0.0.1:3000",
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
