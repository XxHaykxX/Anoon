import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { skipUnlessReal, loginReal, ensureFriends, openFirstFriendChat } from "./helpers";

skipUnlessReal(test);

/**
 * Reply/quote, edit, and delete (у меня / у всех) on friend-chat messages
 * (Wave-2 #85 MSG-4, #86 MSG-5). All three are reached through the same
 * long-press → `MessageActions` sheet as reactions.spec.ts's second test.
 */
test.describe.serial("friend chat: reply, edit, delete", () => {
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

  /** Long-press a bubble (pointerdown → wait past the 420ms gate → pointerup). */
  async function longPress(page: Page, bubble: ReturnType<Page["getByText"]>): Promise<void> {
    // `hover()` scrolls into view and auto-waits for the element to stop
    // moving; a boundingBox() measured up front races the thread's repin as
    // media above finishes loading, and the press lands on an older bubble.
    await bubble.hover();
    await page.mouse.down();
    await page.waitForTimeout(550);
    await page.mouse.up();
  }

  test("reply: quoted message shows on both sides", async () => {
    const original = `Ответь мне ${Date.now()}`;
    await pageA.getByPlaceholder("Сообщение").fill(original);
    await pageA.getByRole("button", { name: "Отправить" }).click();
    const bubbleOnB = pageB.getByText(original, { exact: true });
    await expect(bubbleOnB).toBeVisible({ timeout: 15_000 });

    await longPress(pageB, bubbleOnB);
    await pageB.getByRole("button", { name: "Ответить" }).click();
    const replyText = `Ответ от B ${Date.now()}`;
    await pageB.getByPlaceholder("Сообщение").fill(replyText);
    await pageB.getByRole("button", { name: "Отправить" }).click();

    // The quote strip repeats the original text above the new bubble on both sides.
    await expect(pageA.getByText(replyText, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(pageA.getByText(original).nth(1)).toBeVisible();
  });

  test("edit: peer sees the updated text and «изменено»", async () => {
    const original = `Опечатка ${Date.now()}`;
    await pageA.getByPlaceholder("Сообщение").fill(original);
    await pageA.getByRole("button", { name: "Отправить" }).click();
    const bubbleOnA = pageA.getByText(original, { exact: true });
    await expect(bubbleOnA).toBeVisible();
    await expect(pageB.getByText(original, { exact: true })).toBeVisible({ timeout: 15_000 });

    await longPress(pageA, bubbleOnA);
    await pageA.getByRole("button", { name: "Редактировать" }).click();
    const fixed = `Исправлено ${Date.now()}`;
    const composer = pageA.getByPlaceholder("Изменить сообщение");
    await expect(composer).toHaveValue(original);
    await composer.fill(fixed);
    await pageA.getByRole("button", { name: "Отправить" }).click();

    await expect(pageA.getByText(fixed, { exact: true })).toBeVisible();
    await expect(pageB.getByText(fixed, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(pageA.getByText("изменено")).toBeVisible();
    await expect(pageB.getByText("изменено")).toBeVisible({ timeout: 15_000 });
  });

  test("delete «у меня»: local-only, peer keeps the message", async () => {
    const draft = `Удалю у себя ${Date.now()}`;
    await pageB.getByPlaceholder("Сообщение").fill(draft);
    await pageB.getByRole("button", { name: "Отправить" }).click();
    const bubbleOnB = pageB.getByText(draft, { exact: true });
    await expect(bubbleOnB).toBeVisible();
    await expect(pageA.getByText(draft, { exact: true })).toBeVisible({ timeout: 15_000 });

    await longPress(pageB, bubbleOnB);
    await pageB.getByRole("button", { name: "Удалить у меня" }).click();

    await expect(bubbleOnB).toBeHidden();
    // A never asked to delete anything — the message must still be there.
    await expect(pageA.getByText(draft, { exact: true })).toBeVisible();
  });

  test("delete «у всех»: tombstone on both sides", async () => {
    const draft = `Удалю у всех ${Date.now()}`;
    await pageA.getByPlaceholder("Сообщение").fill(draft);
    await pageA.getByRole("button", { name: "Отправить" }).click();
    const bubbleOnA = pageA.getByText(draft, { exact: true });
    await expect(bubbleOnA).toBeVisible();
    await expect(pageB.getByText(draft, { exact: true })).toBeVisible({ timeout: 15_000 });

    await longPress(pageA, bubbleOnA);
    await pageA.getByRole("button", { name: "Удалить у всех" }).click();

    await expect(pageA.getByText("сообщение удалено").first()).toBeVisible();
    await expect(pageB.getByText("сообщение удалено").first()).toBeVisible({ timeout: 15_000 });
  });
});
