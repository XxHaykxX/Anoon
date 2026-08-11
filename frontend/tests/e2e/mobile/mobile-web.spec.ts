import { test, expect } from "@playwright/test";

/**
 * The Expo client, driven against a LIVE backend — by the only route this
 * machine has. There is no Android SDK and no device here, so the bundle is
 * exported for web (react-native-web: the same screens, the same store, the
 * same companion/Tinode clients) and driven in a browser.
 *
 * What this proves: every screen mounts without a runtime error, and the shared
 * store really logs into the backend from the native bundle — the login lands on
 * «Чаты» with the tab bar, not on a spinner or a blank frame.
 *
 * What it CANNOT prove, and what a device run is still for: the keystore
 * (expo-secure-store), the image picker, the keyboard avoiding view, and
 * anything about how it looks on a real screen.
 *
 * Prepare (three commands, from `mobile/`):
 *   npx expo export --platform web --output-dir ../.expo-web \
 *     EXPO_PUBLIC_BACKEND_URL=http://127.0.0.1:8088
 *   npx serve -l 3000 ../.expo-web      # clean URLs — `serve`, not python's http.server
 *   # …and the stand itself: docker compose up -d + the app behind Caddy :8088
 *
 * Run:  E2E_MOBILE=1 npx playwright test --project=mobile
 */

const E2E_MOBILE = process.env.E2E_MOBILE === "1";
test.skip(!E2E_MOBILE, "Needs the Expo web export served on :3000 and a live stand — see the header.");

/** Seeded on the stand; the same pair every real spec uses. */
const ACCOUNT = { login: "alice_test", password: "alicepass123" };

const SCREENS = [
  "auth-login", "auth-register", "auth-gender", "auth-profile-setup",
  "auth-verify-email", "auth-forgot-password", "auth-reset-password",
  "onboarding", "searching", "anon-chat", "private-chat", "settings",
  "friend-search", "friend-requests", "report", "invite", "banned", "muted",
];

for (const screen of SCREENS) {
  test(`${screen} mounts without a runtime error`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto(`/${screen}`, { waitUntil: "networkidle" });
    expect(res?.status()).toBe(200);
    // A screen that threw during render still answers 200 with an empty body —
    // the status alone says nothing.
    expect((await page.locator("body").innerText()).trim().length).toBeGreaterThan(0);
    expect(errors, `${screen} threw during render`).toEqual([]);
  });
}

test("a real sign-in from the native bundle reaches the app", async ({ page }) => {
  await page.goto("/auth-login", { waitUntil: "networkidle" });
  await page.locator("input").nth(0).fill(ACCOUNT.login);
  await page.locator("input").nth(1).fill(ACCOUNT.password);
  await page.getByText("Войти", { exact: true }).click();

  await expect(page).toHaveURL(/\/chats$/, { timeout: 30_000 });
  // The tab bar is the proof that the shell mounted, not just the route changed.
  await expect(page.getByText("Рулетка", { exact: true })).toBeVisible();
});
