import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { skipUnlessReal, loginReal, ensureFriends, openFirstFriendChat } from "./helpers";

skipUnlessReal(test);

/**
 * Emoji reactions on friend-chat messages (Wave-2 #84 MSG-3). Two entry
 * points exist in AnoonPrivateChat: a double-tap quick-reacts ❤️ directly
 * (`sendChatReaction`), and a long-press opens the full `MessageActions`
 * sheet (reuses `ReactionBar`'s quick-emoji row) for any emoji. Both should
 * sync the resulting pill to the peer.
 */
test.describe.serial("friend chat: emoji reactions", () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser }) => {
    contextA = await browser.newContext();
    contextB = await browser.newContext();
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();

    await loginReal(pageA, "a");
    await loginReal(pageB, "b");
    await ensureFriends(pageA, pageB);

    await openFirstFriendChat(pageA);
    await openFirstFriendChat(pageB);
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
  });

  test("double-tap ❤️ quick-react syncs to the peer as a pill", async () => {
    const draft = `Реакция-двойной-тап ${Date.now()}`;
    await pageA.getByPlaceholder("Сообщение").fill(draft);
    await pageA.getByRole("button", { name: "Отправить" }).click();
    const bubbleOnB = pageB.getByText(draft, { exact: true });
    await expect(bubbleOnB).toBeVisible({ timeout: 15_000 });

    await bubbleOnB.dblclick();

    // The reaction pill (a <button>{emoji}</button> under the bubble) renders
    // on both sides once companion/Tinode round-trips it.
    // `.last()` is required: the seeded accounts are never wiped, so every
    // previous run left its own ❤️ pill in this thread — an unscoped locator
    // matches all of them and fails Playwright's strict mode. The newest
    // message is last in DOM order, so `.last()` is the pill we just created.
    await expect(pageB.getByRole("button", { name: "❤️" }).last()).toBeVisible({ timeout: 10_000 });
    await expect(pageA.getByRole("button", { name: "❤️" }).last()).toBeVisible({ timeout: 10_000 });
  });

  test("long-press → action sheet → pick a non-heart emoji", async () => {
    const draft = `Реакция-долгий-тап ${Date.now()}`;
    await pageA.getByPlaceholder("Сообщение").fill(draft);
    await pageA.getByRole("button", { name: "Отправить" }).click();
    const bubbleOnB = pageB.getByText(draft, { exact: true });
    await expect(bubbleOnB).toBeVisible({ timeout: 15_000 });

    // Long-press = mousedown → hold past MessageActions' 420ms gate → mouseup.
    // `click({ delay })` rather than hover()+mouse.down()/up(): only the
    // element-scoped actions run Playwright's hit-target check, which verifies
    // (and retries) that the pressed point really is THIS bubble at the moment
    // the button goes down. Raw `mouse.down()` presses wherever the cursor
    // happens to be — and the thread keeps moving under it as media bubbles
    // above swap their reserved aspect-ratio box for the real height, which is
    // how an earlier version opened the sheet on an older message.
    // The bubble stops the resulting click from reaching the thread's
    // close-the-sheet onClick, so the sheet survives the mouseup.
    await bubbleOnB.click({ delay: 550 });

    // ReactionBar's quick emojis are aria-labeled `Реакция ${emoji}` — but they
    // also carry an explicit `role="menuitem"` (they sit in a `role="menu"`
    // row), and an explicit role WINS over the implicit `button` of the
    // underlying <button> element. `getByRole("button", …)` therefore matched
    // ZERO elements and the click timed out at 60s. Picking 👍 avoids colliding
    // with the ❤️ pill from the previous test's message.
    await pageB.getByRole("menuitem", { name: "Реакция 👍" }).click();

    // `.last()` for the same reason as the ❤️ pills above: the seeded accounts
    // are never wiped, so every previous run left its own 👍 pill in this
    // thread and an unscoped locator trips strict mode.
    await expect(pageB.getByRole("button", { name: "👍" }).last()).toBeVisible({ timeout: 10_000 });
    await expect(pageA.getByRole("button", { name: "👍" }).last()).toBeVisible({ timeout: 10_000 });
  });
});
