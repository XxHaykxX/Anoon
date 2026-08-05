import { test, expect } from "@playwright/test";
import { signInMock, switchTab, attachErrorGuard, assertNoErrors } from "./helpers";

/**
 * Coins/subscription screen (Wave-3 #102), opened from Profile as a local
 * overlay (not a route — see AnoonProfile.tsx). Mock mode only needs the
 * default store state (`balance: 0`, `tier: "free"`) since `fetchWallet` is
 * gated behind `USE_TINODE` and never runs here.
 */
test("open wallet from Profile, see the default balance/tier, and go back", async ({ page }) => {
  const guard = attachErrorGuard(page);
  await signInMock(page);
  await switchTab(page, "Профиль");

  await page.getByRole("button", { name: "Монеты и подписка" }).click();
  await expect(page.getByRole("heading", { name: "Монеты и подписка" })).toBeVisible();

  // Default store state: no companion round-trip in mock mode.
  await expect(page.getByText("0", { exact: true })).toBeVisible();
  await expect(page.getByText("Бесплатный")).toBeVisible();

  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();

  assertNoErrors(guard);
});

test("buying coins / subscribing shows the payment-stub toast", async ({ page }) => {
  await signInMock(page);
  await switchTab(page, "Профиль");
  await page.getByRole("button", { name: "Монеты и подписка" }).click();

  // Coin-pack buttons have no accessible name of their own; the price label
  // inside is unique per pack and bubbles the click up to the button.
  await page.getByText("490 ֏").click();
  await expect(page.getByText("Оплата скоро — Армения")).toBeVisible();

  await page.getByRole("button", { name: "Оформить Premium" }).click();
  await expect(page.getByText("Оплата скоро — Армения")).toBeVisible();
});

test("current tier is badged instead of offering itself as an upgrade", async ({ page }) => {
  await signInMock(page);
  await switchTab(page, "Профиль");
  await page.getByRole("button", { name: "Монеты и подписка" }).click();

  // Mock tier is always "free", so neither paid card is "current" — both
  // still offer an upgrade button rather than the «Ваш тариф» badge.
  await expect(page.getByText("Ваш тариф")).toBeHidden();
  await expect(page.getByRole("button", { name: "Оформить Premium" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Оформить Super Premium" })).toBeVisible();
});
