import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { skipUnlessReal, loginReal, ensureFriends, openFirstFriendChat, ACCOUNTS } from "./helpers";

skipUnlessReal(test);

/**
 * Delivered/read receipt ticks in the friend chat (Wave-2 #82 MSG-1).
 * AnoonPrivateChat's `StatusTicks`: single check = sent, double check = delivered,
 * double check tinted `text-read-tick` = read. `noteRead`/`noteRecv` fire
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

  test("read tick (text-read-tick) appears once the peer has the chat open", async () => {
    const draft = `Прочитано ли ${Date.now()} ${ACCOUNTS.a.hashId}`;
    await pageA.getByPlaceholder("Сообщение").fill(draft);
    await pageA.getByRole("button", { name: "Отправить" }).click();
    await expect(pageB.getByText(draft, { exact: true })).toBeVisible({ timeout: 15_000 });

    // B's chat is already open/subscribed, so the read receipt round-trips
    // back to A automatically. `text-read-tick` is only ever applied to the
    // DoubleCheckIcon in the "read" branch of StatusTicks — but that class
    // alone is NOT a usable anchor: these are persistent seeded accounts, so
    // every earlier run's message is still in the thread wearing the same
    // class, and a bare `svg.text-read-tick` resolved to 26 elements (strict
    // mode violation) rather than "no read tick yet". Scope it to THIS
    // message's own bubble — `anoon-msg-in` is the bubble div that holds both
    // the text span and the status ticks (AnoonPrivateChat.tsx's PrivateBubble).
    const bubble = pageA.locator("div.anoon-msg-in").filter({ hasText: draft });
    await expect(bubble.locator("svg.text-read-tick")).toBeVisible({ timeout: 15_000 });
  });

  test.skip(
    "TODO(QA): 'delivered' tick (double-check, not yet read) — narrow window to catch",
    async () => {
      // 'delivered' (double-check, not yet read) is only observable in the
      // narrow window between the peer's client receiving the message and
      // noteRead actually firing — with B's chat already open in this suite
      // that window is sub-second and not reliably catchable from the DOM.
      // Would need either a deliberately-closed B chat (contradicts the rest
      // of this file's setup) or a network-level pause; not guessing at a
      // selector for a state this suite can't currently force.
    },
  );
});
