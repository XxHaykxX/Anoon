import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  skipUnlessReal,
  loginReal,
  ensureFriends,
  openFirstFriendChat,
  getFirstFriendTopic,
  openFriendChatByTopic,
  closeFriendChat,
  switchTab,
  ACCOUNTS,
  attachErrorGuard,
  assertNoErrors,
  type ErrorGuard,
} from "./helpers";

skipUnlessReal(test);

/**
 * Real 2-user QA matrix, part 2 (#119): the Friends-tab directory itself —
 * both sides' list rows, #ID search (BUG-1/#108's `friendsSearch` unwrap is
 * fixed as of this writing, so this now expects a working result, not the
 * old "Ничего не найдено" regression), and reopening a friend chat by its
 * exact Tinode topic rather than row order (guards against BUG-3/#110-style
 * "wrong/stale topic" regressions).
 */
test.describe.serial("real: friends list, #ID search, reopen by topic", () => {
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
    await ensureFriends(pageA, pageB);
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
  });

  test("friends list shows a row on both sides", async () => {
    await switchTab(pageA, "Чаты");
    await switchTab(pageB, "Чаты");
    await expect(pageA.locator(".anoon-cv-row").first()).toBeVisible({ timeout: 15_000 });
    await expect(pageB.locator(".anoon-cv-row").first()).toBeVisible({ timeout: 15_000 });
  });

  test("friend search by #ID finds the peer and reports the existing friendship", async () => {
    await switchTab(pageA, "Чаты");
    // Same bare-svg-aria-label caveat as the invite icon in home-and-pages.spec.ts.
    await pageA.locator('[aria-label="Поиск друзей"]').click();

    await expect(pageA.getByRole("heading", { name: "Найти друга" })).toBeVisible();
    // BUG-45 rewrote this screen's copy: the placeholder was «#ID или ник»,
    // but search by nickname was dropped (companion matches the exact #ID only),
    // so the hint became a sample id. See AnoonFriendSearch.tsx.
    await pageA.getByPlaceholder("Например, 00042").fill(ACCOUNTS.b.hashId);

    // Debounced 300ms in AnoonFriendSearch before it round-trips to companion.
    // `exact` matters: the result card prints the id twice — as the display
    // name and as the muted id chip — so a substring match hits both and fails
    // strict mode. (That second element used to read «##00012»; see the
    // normalisation in AnoonFriendSearch.resultToPerson.)
    await expect(
      pageA.getByText(`#${ACCOUNTS.b.hashId}`, { exact: true }).first(),
    ).toBeVisible({ timeout: 10_000 });
    // ensureFriends() already paired A/B before this test — the result card
    // must reflect that (not offer a "Добавить" button for an existing friend).
    // `.first()`: a friend row renders BOTH strings (the muted note «уже в
    // друзьях» and the «В друзьях» chip), and getByText's default substring
    // match makes "В друзьях" hit the note too — an unscoped `.or()` union is
    // several elements and trips strict mode.
    await expect(
      pageA.getByText("уже в друзьях").or(pageA.getByText("В друзьях")).first(),
    ).toBeVisible();

    // Shell-provided top bar (AnoonApp.tsx's NEEDS_TOP_BAR) supplies this
    // screen's only back affordance.
    await pageA.getByRole("button", { name: "Назад" }).click();
    await expect(pageA.getByRole("heading", { name: "Найти друга" })).toBeHidden();
  });

  test("reopening the friend chat by its exact data-topic still works, both directions", async () => {
    const topic = await getFirstFriendTopic(pageA);
    expect(topic.length).toBeGreaterThan(0);

    await openFriendChatByTopic(pageA, topic);
    await openFirstFriendChat(pageB);

    const first = `Топик ${topic} раунд 1 · ${Date.now()}`;
    await pageA.getByPlaceholder("Сообщение").fill(first);
    await pageA.getByRole("button", { name: "Отправить" }).click();
    await expect(pageB.getByText(first, { exact: true })).toBeVisible({ timeout: 15_000 });

    // Leave and re-enter via the same topic — the "re-" in "reopen": proves
    // the row's data-topic keeps pointing at the same live subscription
    // rather than a stale/renamed one (the BUG-3/#110 failure mode).
    await closeFriendChat(pageA);
    await openFriendChatByTopic(pageA, topic);
    await expect(pageA.getByText(first, { exact: true })).toBeVisible({ timeout: 15_000 });

    const second = `Топик ${topic} раунд 2 · ${Date.now()}`;
    await pageB.getByPlaceholder("Сообщение").fill(second);
    await pageB.getByRole("button", { name: "Отправить" }).click();
    await expect(pageA.getByText(second, { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test("zero console errors on either side across the directory tour", async () => {
    assertNoErrors(guardA);
    assertNoErrors(guardB);
  });
});
