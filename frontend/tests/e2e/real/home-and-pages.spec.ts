import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  skipUnlessReal,
  loginReal,
  switchTab,
  expectHome,
  expectChats,
  ACCOUNTS,
  attachErrorGuard,
  assertNoErrors,
  type ErrorGuard,
} from "./helpers";

skipUnlessReal(test);

/**
 * Real 2-user QA matrix, part 1 (#119): login → Home, and every secondary
 * page reachable from Profile/Friends actually renders against the live
 * stack. Doesn't touch friending/chat — that's home-and-pages' sibling files
 * (media/reactions/receipts/reply-edit-delete/calls/avatar/reveal, plus
 * friends-directory.spec.ts for the friends-list/search/reopen matrix).
 *
 * NOTE (BUG-21): Home used to gate «Начать чат» behind picking an own-age
 * bucket — that picker is gone (own age now comes from the profile), so this
 * file's Home test just confirms the button is enabled, no gate to describe.
 *
 * Single describe.serial per account rather than one shared pair: nothing
 * here needs two peers to interact, and keeping A/B independent means a
 * failure on one side's page tour doesn't also fail the other side's.
 */
test.describe.serial("real: login + Home + page tour", () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  let guardA: ErrorGuard;
  let guardB: ErrorGuard;

  test.beforeAll(async ({ browser }) => {
    contextA = await browser.newContext();
    contextB = await browser.newContext();
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();
    guardA = attachErrorGuard(pageA);
    guardB = attachErrorGuard(pageB);

    await loginReal(pageA, "a");
    await loginReal(pageB, "b");
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
  });

  test("both seeded accounts log in and land on Chats (BUG-24)", async () => {
    await expectChats(pageA);
    await expectChats(pageB);
  });

  test("Home: «Начать чат» is enabled immediately, no own-age gate (BUG-21)", async () => {
    // BUG-24 made Chats (not Home) the post-login landing screen — go there first.
    await switchTab(pageA, "Рулетка");
    // BUG-21 removed the own-age picker (own age now comes straight from the
    // profile) — the button used to be disabled until an age chip was picked;
    // now there's nothing left to gate on. Deliberately don't click it — this
    // file never enters matchmaking; ensureFriends() in the other real/ specs
    // drives the actual roulette round-trip.
    await expect(pageA.getByRole("button", { name: "Начать чат" })).toBeEnabled();
  });

  test("Профиль shows the account's real #ID and a Выйти option", async () => {
    await switchTab(pageA, "Профиль");
    await expect(pageA.getByText(`#${ACCOUNTS.a.hashId}`)).toBeVisible();
    // Assert-only, never click: logging out here would break every later
    // test in this serial block, which all assume pageA stays signed in.
    await expect(pageA.getByRole("button", { name: "Выйти" })).toBeVisible();
  });

  test("Wallet opens from Профиль → «Монеты и подписка» and shows a tier", async () => {
    await switchTab(pageA, "Профиль");
    await pageA.getByRole("button", { name: "Монеты и подписка" }).click();

    await expect(pageA.getByRole("heading", { name: "Монеты и подписка" })).toBeVisible();
    await expect(
      pageA.getByText(/Бесплатный|Premium|Super Premium/).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Wallet is a same-screen overlay (AnoonWallet's onClose), not a nav-stack
    // route — its own «Назад» closes it straight back to Профиль.
    await pageA.getByRole("button", { name: "Назад" }).click();
    await expect(pageA.getByRole("heading", { name: "Монеты и подписка" })).toBeHidden();
  });

  test("Settings opens from Профиль → «Настройки»", async () => {
    await switchTab(pageA, "Профиль");
    await pageA.getByRole("button", { name: "Настройки" }).click();

    await expect(pageA.getByRole("heading", { name: "Настройки" })).toBeVisible();
    await expect(pageA.getByText("Сменить пароль").first()).toBeVisible();
    // Settings renders TWO switches — «Уведомления» (only when the browser
    // supports push) and «Звук и вибрация» (always). An unscoped getByRole
    // matches both and fails Playwright's strict mode, so name the always-on
    // one; each Switch sets aria-label={label}.
    await expect(pageA.getByRole("switch", { name: "Звук и вибрация" })).toBeVisible();

    await pageA.getByRole("button", { name: "Назад" }).click();
    await expect(pageA.getByRole("heading", { name: "Настройки" })).toBeHidden();
  });

  test("Notifications tab renders", async () => {
    await switchTab(pageA, "Уведомления");
    await expect(pageA.getByRole("heading", { name: "Уведомления" })).toBeVisible();
  });

  test("Invite opens from Чаты → «Пригласить друга» and shows the real #ID (no QR — BUG-20)", async () => {
    await switchTab(pageA, "Чаты");
    // ForwardIcon is a bare `<svg aria-label=...>`, not a form control, so
    // `getByLabel` isn't guaranteed to pick it up — target the attribute directly.
    await pageA.locator('[aria-label="Пригласить друга"]').click();

    await expect(pageA.getByRole("heading", { name: "Пригласить друга" })).toBeVisible();
    // BUG-20 removed the QR code and split the old single "Мой код #hashId"
    // text node into two separate elements ("Мой код" label + the #ID itself).
    await expect(pageA.getByText("Мой код")).toBeVisible();
    await expect(pageA.getByText(`#${ACCOUNTS.a.hashId}`)).toBeVisible();

    await pageA.getByRole("button", { name: "Назад" }).click();
    await expect(pageA.getByRole("heading", { name: "Пригласить друга" })).toBeHidden();
  });

  test("Home renders again after the tour, with zero console errors on either side", async () => {
    await switchTab(pageA, "Рулетка");
    await expectHome(pageA);
    // pageB was never touched after login (still sitting on Chats) — go to
    // Home there too before asserting.
    await switchTab(pageB, "Рулетка");
    await expectHome(pageB);

    assertNoErrors(guardA);
    assertNoErrors(guardB);
  });
});
