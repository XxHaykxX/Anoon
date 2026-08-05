import { test, expect } from "@playwright/test";
import {
  signInMock,
  startRouletteToChat,
  attachErrorGuard,
  assertNoErrors,
} from "./helpers";

/**
 * From an anonymous chat: open the chat menu, file a report, then block the peer.
 * Both actions resolve through companion mock fallbacks, so the success UI shows
 * with no backend.
 */
test("report a peer from chat, then block", async ({ page }) => {
  const guard = attachErrorGuard(page);
  await signInMock(page);
  await startRouletteToChat(page);

  // Open the chat overflow menu → «Пожаловаться» (navigates to the report sheet).
  await page.getByRole("button", { name: "Меню чата" }).click();
  await page.getByRole("button", { name: "Пожаловаться" }).click();

  await expect(page.getByRole("heading", { name: "Пожаловаться" })).toBeVisible();

  const send = page.getByRole("button", { name: "Отправить" });
  await expect(send).toBeDisabled(); // needs a reason first
  await page.getByRole("button", { name: "Спам / реклама" }).click();
  await expect(send).toBeEnabled();
  await send.click();

  await expect(page.getByText("Спасибо, жалоба отправлена")).toBeVisible();
  await page.getByRole("button", { name: "Готово" }).click();

  // Back on the anon chat (remounts fresh, so the reveal card is pending again).
  await expect(page.getByPlaceholder("Сообщение")).toBeVisible();

  // Dismiss the inline reveal card first so its «Заблокировать» button is gone —
  // otherwise it collides with the identically-named menu item below.
  await page.getByRole("button", { name: "Отклонить" }).click();

  // Now block the peer via the chat menu → transient confirmation banner.
  await page.getByRole("button", { name: "Меню чата" }).click();
  await page.getByRole("button", { name: "Заблокировать" }).click();
  await expect(page.getByText("Собеседник заблокирован")).toBeVisible();

  assertNoErrors(guard);
});

/** The report sheet can be dismissed with «Закрыть» without sending. */
test("report sheet closes without sending", async ({ page }) => {
  await signInMock(page);
  await startRouletteToChat(page);

  await page.getByRole("button", { name: "Меню чата" }).click();
  await page.getByRole("button", { name: "Пожаловаться" }).click();
  await expect(page.getByRole("heading", { name: "Пожаловаться" })).toBeVisible();

  await page.getByRole("button", { name: "Закрыть" }).click();
  // Returns to the chat.
  await expect(page.getByPlaceholder("Сообщение")).toBeVisible();
});
