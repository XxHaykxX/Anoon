import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  skipUnlessReal,
  loginReal,
  ensureFriends,
  openFirstFriendChat,
  TINY_JPEG_BUFFER,
} from "./helpers";

skipUnlessReal(test);

/**
 * The two tails carried over from 2026-08-05 that were "written, built, never
 * watched run": own messages surviving a page reload, and the reworked media
 * viewer (§6.1 of that session's notes).
 *
 * Both are about a SECOND pass over the same data — the fix for missing own
 * messages let the local echo reach the handler that used to drop it, so the
 * risk it introduced is the mirror image: the same message drawn twice. Every
 * assertion here is therefore a COUNT, not a visibility check; `toBeVisible`
 * passes just as happily on a duplicate.
 */
const CHAT_CONTEXT = {
  permissions: ["clipboard-read", "clipboard-write", "notifications"],
  viewport: { width: 390, height: 844 },
};

test.describe.serial("friend chat: reload persistence + media viewer", () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  const marker = `хвост-${Date.now()}`;

  test.beforeAll(async ({ browser }) => {
    contextA = await browser.newContext(CHAT_CONTEXT);
    contextB = await browser.newContext(CHAT_CONTEXT);
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

  test("a sent message is drawn exactly once on both sides", async () => {
    await pageA.getByPlaceholder("Сообщение").fill(marker);
    await pageA.getByRole("button", { name: "Отправить" }).click();

    // Wait for the peer's copy first: by the time the server has echoed it all
    // the way to B, A's own optimistic bubble has had every chance to be
    // duplicated by the same echo coming back. Counting before that would pass
    // on a race rather than on the reconciliation actually working.
    await expect(pageB.getByText(marker, { exact: true })).toHaveCount(1, { timeout: 20_000 });
    await expect(pageA.getByText(marker, { exact: true })).toHaveCount(1);
  });

  test("the session and own messages survive a page reload", async () => {
    await pageA.reload();

    // The session is persisted (localStorage `anoon:session`, a Tinode auth
    // token), so a reload must NOT land on the login screen. Asserted as the
    // absence of the login button rather than the presence of one particular
    // screen: the app may restore either the chat list or the chat itself.
    await expect(pageA.getByRole("button", { name: "Войти", exact: true })).toHaveCount(0, {
      timeout: 20_000,
    });

    if (!(await pageA.getByPlaceholder("Сообщение").isVisible().catch(() => false))) {
      await openFirstFriendChat(pageA);
    }
    // The tail itself: own messages come back from history, and exactly once —
    // a reload re-subscribes to the topic, so a de-duplication that only worked
    // on the live path would show them twice here.
    await expect(pageA.getByText(marker, { exact: true })).toHaveCount(1, { timeout: 20_000 });
  });

  test("media viewer: opens, loads, closes, and reopens with a fresh token", async () => {
    await pageA
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({ name: "viewer.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG_BUFFER });

    const shot = pageA.getByRole("button", { name: "Открыть изображение" }).last();
    await expect(shot).toBeVisible({ timeout: 20_000 });
    await shot.click();

    const viewer = pageA.getByTestId("media-viewer");
    await expect(viewer).toBeVisible({ timeout: 10_000 });
    const item = pageA.getByTestId("media-viewer-item");
    // Decoded, not merely mounted: naturalWidth stays 0 on a src the browser
    // refused (which is what an unsigned/stale Tinode file ref produces).
    await expect(item).toHaveJSProperty("complete", true, { timeout: 15_000 });
    await expect(item).not.toHaveJSProperty("naturalWidth", 0);

    await pageA.getByTestId("media-viewer-close").click();
    await expect(viewer).toBeHidden();

    // Reopening is the path the rework touched: the URL is rebuilt with the
    // auth token each time, so a viewer that cached a one-shot URL loads a
    // broken image on the second open while the first looked fine.
    await shot.click();
    await expect(viewer).toBeVisible({ timeout: 10_000 });
    await expect(pageA.getByTestId("media-viewer-item")).toHaveJSProperty("complete", true, {
      timeout: 15_000,
    });
    await expect(pageA.getByTestId("media-viewer-item")).not.toHaveJSProperty("naturalWidth", 0);
    await pageA.getByTestId("media-viewer-close").click();
  });
});
