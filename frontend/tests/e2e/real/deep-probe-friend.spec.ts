import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  skipUnlessReal,
  loginReal,
  ensureFriends,
  openFirstFriendChat,
  switchTab,
} from "./helpers";

skipUnlessReal(test);

/**
 * Latency probe for the FRIEND chat, covering the two arrival paths the anon
 * probe cannot reach:
 *
 *   • the receiver has JUST opened the chat (the subscribe is still settling —
 *     the reported "message arrives late right after entering the chat");
 *   • the receiver is not in the chat at all, so the message has to reach the
 *     «Чаты» list instead of an open thread.
 *
 * Numbers are asserted, not just awaited: the failure this is written against
 * is "it eventually shows up", which any generous wait passes.
 */
const CONTEXT = { viewport: { width: 390, height: 844 } };

async function relayLatency(from: Page, to: Page, text: string): Promise<number> {
  await from.getByPlaceholder("Сообщение").fill(text);
  const started = Date.now();
  await from.keyboard.press("Enter");
  await expect(to.getByText(text)).toBeVisible({ timeout: 30_000 });
  return Date.now() - started;
}

test.describe.serial("friend chat: arrival latency, open and closed", () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  const stamp = Date.now();

  test.beforeAll(async ({ browser }) => {
    contextA = await browser.newContext(CONTEXT);
    contextB = await browser.newContext(CONTEXT);
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

  test("both sides in the chat: messages are live", async () => {
    const samples = [
      await relayLatency(pageA, pageB, `friend-a2b-${stamp}-0`),
      await relayLatency(pageB, pageA, `friend-b2a-${stamp}-0`),
      await relayLatency(pageA, pageB, `friend-a2b-${stamp}-1`),
    ];
    console.log(`[probe] friend chat latencies: ${samples.join(", ")}ms`);
    expect(Math.max(...samples)).toBeLessThan(3_000);
  });

  test("a message sent the instant the receiver opens the chat still lands live", async () => {
    // B leaves and comes straight back, and A writes while B's subscribe is
    // still in flight. This is the reported "entered the chat, the message came
    // in late" shape: nothing is retried, so anything the subscribe misses is
    // only seen on the next open.
    await pageB.getByLabel("Назад").last().click();
    await switchTab(pageB, "Чаты");
    await openFirstFriendChat(pageB);

    const latency = await relayLatency(pageA, pageB, `friend-on-open-${stamp}`);
    console.log(`[probe] message sent right after the receiver opened: ${latency}ms`);
    expect(latency, "a message racing the receiver's subscribe must not be dropped").toBeLessThan(
      5_000,
    );
  });

  test("receiver is NOT in the chat: the «Чаты» row updates without a manual refresh", async () => {
    await pageB.getByLabel("Назад").last().click();
    await switchTab(pageB, "Чаты");

    const text = `friend-while-away-${stamp}`;
    await pageA.getByPlaceholder("Сообщение").fill(text);
    const started = Date.now();
    await pageA.keyboard.press("Enter");

    // The conversation row's preview is the only place this can surface for a
    // user who is looking at the list.
    await expect(pageB.getByText(text).first()).toBeVisible({ timeout: 30_000 });
    const latency = Date.now() - started;
    console.log(`[probe] chats-list preview while away: ${latency}ms`);
    expect(latency, "the list must reflect a new message without reopening it").toBeLessThan(5_000);
  });

  test("…and opening the chat shows it exactly once", async () => {
    await openFirstFriendChat(pageB);
    await expect(pageB.getByText(`friend-while-away-${stamp}`)).toHaveCount(1);
  });

  test("a message typed while OUR OWN connection is down is not silently lost", async () => {
    // The other half of the phone case: the user writes in a dead spot. The
    // send cannot succeed, so the only two honest outcomes are "it goes out
    // when the connection returns" or "it is visibly marked as unsent". A
    // bubble that looks delivered and never left the device is the failure.
    const text = `sender-offline-${stamp}`;
    await contextA.setOffline(true);
    await pageA.getByPlaceholder("Сообщение").fill(text);
    await pageA.keyboard.press("Enter");
    // It must at least appear locally — losing the typed text outright would be
    // worse than either outcome above.
    await expect(pageA.getByText(text)).toBeVisible({ timeout: 15_000 });
    await pageA.waitForTimeout(2_000);

    await contextA.setOffline(false);
    await expect(pageB.getByText(text)).toBeVisible({ timeout: 45_000 });
    console.log("[probe] message written offline reached the peer after reconnect");
  });

  test("a message sent while the receiver's connection is down arrives when it returns", async () => {
    // The phone case behind "messages arrive late": the screen locks, the
    // socket dies, and whatever was sent meanwhile has to land when the app is
    // back — without the user reloading. Nothing here retries by itself, so if
    // the reconnect does not refetch, the message simply is not there.
    const text = `friend-offline-${stamp}`;
    await contextB.setOffline(true);
    await pageA.getByPlaceholder("Сообщение").fill(text);
    await pageA.keyboard.press("Enter");
    await expect(pageA.getByText(text)).toBeVisible({ timeout: 15_000 });
    await pageB.waitForTimeout(4_000);
    // Proof the offline half actually took effect — otherwise the reconnect
    // latency below measures nothing at all.
    await expect(pageB.getByText(text)).toHaveCount(0);

    const started = Date.now();
    await contextB.setOffline(false);
    await expect(pageB.getByText(text)).toBeVisible({ timeout: 60_000 });
    const latency = Date.now() - started;
    console.log(`[probe] delivered after reconnect: ${latency}ms`);
    expect(latency, "a reconnect must resync the thread promptly").toBeLessThan(20_000);
  });
});
