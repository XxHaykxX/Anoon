import { expect, type Page, type Locator } from "@playwright/test";

/**
 * Shared helpers for the frontend e2e suite.
 *
 * All specs target the app in **mock mode** (`NEXT_PUBLIC_USE_TINODE` unset), so
 * no companion / Tinode backend is required — the dev server alone is enough.
 * See tests/README.md for how to run.
 */

/** The single-page app shell lives at this route; it boots on the onboarding screen. */
export const ANOON_PATH = "/anoon";

/**
 * Age-range labels use a typographic EN DASH (U+2013), not a hyphen. Keep these
 * constants so specs never accidentally type an ASCII "-" that would never match.
 */
export const AGE_18_21 = "18–21"; // "18–21"
export const AGE_22_25 = "22–25"; // "22–25"

/**
 * Console/log noise that is expected in a Next.js dev server and unrelated to the
 * app's own correctness. Anything matching one of these is NOT treated as a failure.
 */
const IGNORED_CONSOLE = [
  /favicon/i,
  /manifest/i,
  /Failed to load resource/i,
  /status of 404/i,
  /Download the React DevTools/i,
  /clipboard/i,
  /Permissions-Policy/i,
  /net::ERR_/i,
  /\bpreload\b/i,
  /Fast Refresh/i,
  /Notification/i,
  /ServiceWorker|service worker|sw\.js/i,
];

export interface ErrorGuard {
  /** Uncaught page exceptions + un-ignored console errors collected so far. */
  readonly messages: string[];
}

/**
 * Attach listeners that record uncaught exceptions (`pageerror`) and genuine
 * `console.error` output. Call {@link assertNoErrors} at the end of a test.
 *
 * Uncaught exceptions are the real signal for "a primary button threw"; console
 * errors are filtered against {@link IGNORED_CONSOLE} to avoid dev-server noise.
 */
export function attachErrorGuard(page: Page): ErrorGuard {
  const messages: string[] = [];
  page.on("pageerror", (err) => {
    messages.push(`[pageerror] ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    messages.push(`[console.error] ${text}`);
  });
  return { messages };
}

/** Fail the test if the guard collected any uncaught exception / real console error. */
export function assertNoErrors(guard: ErrorGuard): void {
  expect(guard.messages, `Unexpected runtime errors:\n${guard.messages.join("\n")}`).toEqual([]);
}

/** Open the app fresh; it always boots on the onboarding carousel. */
export async function gotoAnoon(page: Page): Promise<void> {
  await page.goto(ANOON_PATH);
  // First onboarding slide heading — proves the shell mounted client-side.
  await expect(page.getByRole("heading", { name: "Живая рулётка" })).toBeVisible();
}

/** The bottom-tab bar (a <nav>). Scope tab clicks here to avoid header duplicates. */
export function bottomNav(page: Page): Locator {
  return page.getByRole("navigation");
}

/**
 * Click one of the 5 bottom tabs by its Russian label.
 *
 * History, because the labels moved twice: BUG-24 renamed "Главная" → "Рулетка"
 * (the elevated center action) and "Друзья" → "Чаты" (the post-login landing
 * screen). BUG-36 then SPLIT that tab in two — «Чаты» now lists only active
 * conversations, while the full contact list moved to «Контакты». So a friend
 * you have never messaged has a row under «Контакты» and NOT under «Чаты»;
 * see {@link openFirstFriendChat} in real/helpers.ts, which handles both.
 */
export async function switchTab(
  page: Page,
  label: "Чаты" | "Контакты" | "Рулетка" | "Уведомления" | "Профиль",
): Promise<void> {
  await bottomNav(page).getByRole("button", { name: label }).click();
}

/**
 * Sign in through the mock login flow: onboarding → «Войти» → email/password →
 * «Войти». In mock mode the login screen jumps straight to «Чаты» (BUG-24
 * made the relabeled Friends tab the post-login landing screen — it used to
 * be Home). Leaves the app on the Chats screen (heading «Чаты»).
 */
export async function signInMock(page: Page): Promise<void> {
  await gotoAnoon(page);
  // The bottom "Войти" link on onboarding (exact, so it never matches
  // "Войти через Google" on the next screen).
  await page.getByRole("button", { name: "Войти", exact: true }).click();

  await page.getByPlaceholder("you@example.com").fill("tester@anoon.chat");
  await page.getByPlaceholder("Ваш пароль").fill("secret123");
  await page.getByRole("button", { name: "Войти", exact: true }).click();

  await expectChats(page);
}

/** Assert we are on the Chats screen (BUG-24's post-login landing screen). */
export async function expectChats(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Чаты" })).toBeVisible();
}

/**
 * Assert we are on the Home screen. BUG-21 removed the own-age picker (own
 * age now comes straight from the profile, not a manual Home step) — the
 * heading it used to assert on, «Ваш возраст», no longer exists. «Возраст
 * собеседника» (the partner age-range filter, which BUG-21 explicitly kept)
 * is the first section left on Home, so it's the new arrival signal.
 */
export async function expectHome(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Возраст собеседника" })).toBeVisible();
}

/**
 * Navigate to Home and start the roulette. BUG-24 made Chats (not Home) the
 * post-login landing screen, so this now switches tabs first rather than
 * assuming the caller is already there. BUG-21 removed the own-age gate, so
 * «Начать чат» is enabled immediately once on Home — nothing left to pick
 * first. Waits until the anonymous chat composer is visible (mock searching
 * auto-matches after ~1.5s).
 */
export async function startRouletteToChat(page: Page): Promise<void> {
  await switchTab(page, "Рулетка");
  await expectHome(page);
  await page.getByRole("button", { name: "Начать чат" }).click();

  await expect(page.getByRole("heading", { name: "Ищем собеседника…" })).toBeVisible();

  // Mock searching screen pushes anon-chat on a ~1.5s timer.
  await expect(page.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 10_000 });
}
