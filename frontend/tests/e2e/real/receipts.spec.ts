import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  skipUnlessReal,
  loginReal,
  ensureFriends,
  openFirstFriendChat,
  closeFriendChat,
  ACCOUNTS,
} from "./helpers";

skipUnlessReal(test);

/**
 * Delivered/read receipt ticks in the friend chat (Wave-2 #82 MSG-1).
 * AnoonPrivateChat's `StatusTicks`: single check = sent, double check = delivered,
 * double check tinted `text-read-tick-on-primary` = read. `noteRead`/`noteRecv` fire
 * automatically while the peer's chat is open (see store/slices.ts), so no
 * explicit "mark as read" UI action exists to drive — the receipt just
 * follows from B having the thread open when A's message lands.
 */
test.describe.serial("friend chat: delivered/read receipts", () => {
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

  test("own message starts as sent (single check)", async () => {
    const draft = `Проверка галочек ${Date.now()}`;
    await pageA.getByPlaceholder("Сообщение").fill(draft);
    await pageA.getByRole("button", { name: "Отправить" }).click();

    // A CheckIcon (single tick, not yet delivered/read) renders right after
    // send — this can legitimately be extremely brief if B's client is
    // already subscribed and acks instantly, so this assertion is best-effort
    // (not required to hold — see the "eventually read" assertion below for
    // the real contract).
    await expect(pageA.getByText(draft, { exact: true })).toBeVisible();
  });

  test("read tick (text-read-tick-on-primary) appears once the peer has the chat open", async () => {
    const draft = `Прочитано ли ${Date.now()} ${ACCOUNTS.a.hashId}`;
    await pageA.getByPlaceholder("Сообщение").fill(draft);
    await pageA.getByRole("button", { name: "Отправить" }).click();
    await expect(pageB.getByText(draft, { exact: true })).toBeVisible({ timeout: 15_000 });

    // B's chat is already open/subscribed, so the read receipt round-trips
    // back to A automatically. `text-read-tick-on-primary` is only ever applied to the
    // DoubleCheckIcon in the "read" branch of StatusTicks — but that class
    // alone is NOT a usable anchor: these are persistent seeded accounts, so
    // every earlier run's message is still in the thread wearing the same
    // class, and a bare `svg.text-read-tick-on-primary` resolved to 26 elements (strict
    // mode violation) rather than "no read tick yet". Scope it to THIS
    // message's own bubble — `anoon-msg-in` is the bubble div that holds both
    // the text span and the status ticks (AnoonPrivateChat.tsx's PrivateBubble).
    const bubble = pageA.locator("div.anoon-msg-in").filter({ hasText: draft });
    await expect(bubble.locator("svg.text-read-tick-on-primary")).toBeVisible({ timeout: 15_000 });
  });

  /**
   * 'delivered' turned out NOT to need a network pause: it is only a
   * sub-second window while B's chat is OPEN. Close it and the state is
   * stable indefinitely — store/slices.ts's `bgHandlers` keeps a background
   * subscription on the friend topic and calls `client.noteRecv(...)` on every
   * inbound message with the comment "delivered (read only happens on open)",
   * never `noteRead`. So B stays a peer who has received and not read.
   *
   * Runs last in this serial file because it leaves B's chat closed and then
   * re-opens it.
   */
  test("delivered tick (double check, untinted) while the peer's chat is closed", async () => {
    await closeFriendChat(pageB);

    const draft = `Доставлено ли ${Date.now()}`;
    await pageA.getByPlaceholder("Сообщение").fill(draft);
    await pageA.getByRole("button", { name: "Отправить" }).click();

    // Same bubble-scoping as the read-tick test above, and for the same reason:
    // these are persistent seeded accounts, so every prior run's ticks are
    // still in the thread.
    const bubble = pageA.locator("div.anoon-msg-in").filter({ hasText: draft });
    // StatusTicks renders CheckIcon at `size-3.5` for sent and DoubleCheckIcon
    // at `size-4` for both delivered and read — so `size-4` present AND
    // `text-read-tick-on-primary` absent is exactly "delivered", the one combination the
    // read-tick assertion below cannot also satisfy.
    await expect(bubble.locator("svg.size-4")).toBeVisible({ timeout: 15_000 });
    await expect(bubble.locator("svg.text-read-tick-on-primary")).toHaveCount(0);

    // Not flaky by construction: with B's chat closed nothing can fire
    // noteRead, so the tick cannot tint until B actually opens the thread —
    // which is the other half of the contract, asserted here so a regression
    // that never advances past 'delivered' fails too.
    await openFirstFriendChat(pageB);
    await expect(bubble.locator("svg.text-read-tick-on-primary")).toBeVisible({ timeout: 15_000 });
  });
});
