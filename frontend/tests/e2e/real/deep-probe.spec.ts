import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  skipUnlessReal,
  loginReal,
  switchTab,
  TINY_JPEG_BUFFER,
  STUB_MP4_BUFFER,
} from "./helpers";

skipUnlessReal(test);

/**
 * Deep probe for the three reported anon-chat defects the rest of real/ does
 * not cover:
 *
 *   1. delivery latency — "a message sent right after landing in the chat shows
 *      up late on the other side";
 *   2. attachments in the ANON chat (media.spec.ts only covers the friend
 *      chat), including a SECOND video after a first one;
 *   3. a reload on BOTH sides at once — the case where each client read the
 *      other as offline and ended a chat neither had left.
 *
 * Latency is measured, not merely awaited: the assertion is a budget, so a
 * regression from "instant" to "a poll interval later" fails here instead of
 * passing quietly under a 20s wait.
 */
const MEDIA_CONTEXT = {
  permissions: ["clipboard-read", "clipboard-write", "notifications", "microphone"],
  viewport: { width: 390, height: 844 },
};

/** Send `text` from `from` and return how long it took to appear on `to`. */
async function relayLatency(from: Page, to: Page, text: string): Promise<number> {
  await from.getByPlaceholder("Сообщение").fill(text);
  const started = Date.now();
  await from.keyboard.press("Enter");
  await expect(to.getByText(text)).toBeVisible({ timeout: 20_000 });
  return Date.now() - started;
}

test.describe.serial("anon chat: latency, attachments, double reload", () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  const stamp = Date.now();

  test.beforeAll(async ({ browser }) => {
    contextA = await browser.newContext(MEDIA_CONTEXT);
    contextB = await browser.newContext(MEDIA_CONTEXT);
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();
    await loginReal(pageA, "a");
    await loginReal(pageB, "b");
  });

  test.afterAll(async () => {
    // Ending the match is not politeness, it is cleanup the rest of the suite
    // depends on: an anon pairing left open on the server is restored by the
    // NEXT spec's first reload (restoreActiveMatch), which then finds itself in
    // «Собеседник · ~XXXX» instead of the friend chat it was testing. The route
    // is menu → «Завершить разговор» (the composer has no such button), and it
    // is tried on both sides because either one ends it for both.
    for (const page of [pageA, pageB]) {
      await page
        ?.getByRole("button", { name: "Меню чата" })
        .click({ timeout: 5_000 })
        .then(() =>
          page.getByRole("button", { name: "Завершить разговор" }).click({ timeout: 5_000 }),
        )
        .catch(() => {
          /* already ended, or never in a chat */
        });
    }
    await contextA?.close();
    await contextB?.close();
  });

  test("both land in one anon chat", async () => {
    for (const page of [pageA, pageB]) {
      await switchTab(page, "Рулетка");
      await page.getByRole("button", { name: "Начать чат" }).click();
    }
    await expect(pageA.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });
    await expect(pageB.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });
  });

  test("the FIRST message after matching crosses without a poll-interval stall", async () => {
    // The reported symptom is specifically about the first message of a fresh
    // chat: whatever the receiving side has not finished wiring up yet shows as
    // a multi-second gap here and nowhere else.
    const first = await relayLatency(pageA, pageB, `probe-first-${stamp}`);
    console.log(`[probe] first A→B message: ${first}ms`);
    expect(first, "first message after matching should arrive live, not on a poll").toBeLessThan(
      3_000,
    );
  });

  test("steady-state messages stay live in both directions", async () => {
    const samples: number[] = [];
    for (let i = 0; i < 4; i++) {
      samples.push(await relayLatency(pageA, pageB, `probe-a2b-${stamp}-${i}`));
      samples.push(await relayLatency(pageB, pageA, `probe-b2a-${stamp}-${i}`));
    }
    const worst = Math.max(...samples);
    console.log(`[probe] steady-state latencies: ${samples.join(", ")}ms (worst ${worst}ms)`);
    expect(worst, "a live socket delivery should never take seconds").toBeLessThan(3_000);
  });

  test("photo attaches in the anon chat, both sides", async () => {
    await pageA
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({ name: "probe.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG_BUFFER });
    await expect(pageA.getByRole("button", { name: "Открыть изображение" }).last()).toBeVisible({
      timeout: 20_000,
    });
    await expect(pageB.getByRole("button", { name: "Открыть изображение" }).last()).toBeVisible({
      timeout: 20_000,
    });
    await expect(pageB.getByText("не удалось загрузить")).toBeHidden();
  });

  test("video attaches in the anon chat — and a SECOND one right after it", async () => {
    const videoInput = pageA.locator('input[type="file"][accept="video/*"]');

    await videoInput.setInputFiles({
      name: "probe-1.mp4",
      mimeType: "video/mp4",
      buffer: STUB_MP4_BUFFER,
    });
    await expect(pageA.locator("video")).toHaveCount(1, { timeout: 20_000 });
    await expect(pageB.locator("video")).toHaveCount(1, { timeout: 20_000 });

    // The reported "video does not send after [the first one]": the second pick
    // must reach both sides too, not just re-render the first bubble.
    await videoInput.setInputFiles({
      name: "probe-2.mp4",
      mimeType: "video/mp4",
      buffer: STUB_MP4_BUFFER,
    });
    await expect(pageA.locator("video")).toHaveCount(2, { timeout: 20_000 });
    await expect(pageB.locator("video")).toHaveCount(2, { timeout: 20_000 });
  });

  test("an oversized video is refused by SIZE, immediately and in words", async () => {
    // The reported "video doesn't send": a phone-sized clip was uploaded for as
    // long as it took, then rejected with a bare 413 the UI could only render
    // as «Не удалось отправить». Now the pick is refused up front and the
    // message names the limit.
    const started = Date.now();
    await pageA.locator('input[type="file"][accept="video/*"]').setInputFiles({
      name: "too-big.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(33 * 1024 * 1024, 1),
    });
    await expect(pageA.getByText(/больше 32 МБ/)).toBeVisible({ timeout: 10_000 });
    const elapsed = Date.now() - started;
    console.log(`[probe] oversized video refused in ${elapsed}ms`);
    // Refused locally: no upload was attempted, so this cannot take upload time.
    expect(elapsed, "an oversized file must be refused before uploading").toBeLessThan(8_000);
    // …and nothing was posted to the peer.
    await expect(pageB.locator("video")).toHaveCount(2);
  });

  test("BOTH sides reload at the same moment and both come back into the chat", async () => {
    // Each client asks companion whether the peer is still there, and ends the
    // pairing when the answer is no. Reloading together means both sockets are
    // down at once, so an instantaneous online check answers "no" to both —
    // and the chat neither of them left is torn down. Hub.RecentlyOnline is
    // what makes this pass.
    await Promise.all([pageA.reload(), pageB.reload()]);

    await expect(pageA.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 45_000 });
    await expect(pageB.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 45_000 });
    await expect(pageA.getByText("Собеседник вышел из чата")).toHaveCount(0);
    await expect(pageB.getByText("Собеседник вышел из чата")).toHaveCount(0);

    // Still a working conversation, not just a restored screen.
    const after = await relayLatency(pageA, pageB, `probe-after-reload-${stamp}`);
    console.log(`[probe] post-double-reload A→B: ${after}ms`);
  });
});
