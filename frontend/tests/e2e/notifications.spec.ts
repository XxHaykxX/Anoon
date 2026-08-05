import { test, expect } from "@playwright/test";
import { signInMock, switchTab, attachErrorGuard, assertNoErrors } from "./helpers";

/**
 * Notifications screen: accept and decline incoming friend requests, and mark
 * the feed as read. Uses the offline mock request/feed data.
 */
test("accept and decline friend requests", async ({ page }) => {
  const guard = attachErrorGuard(page);
  await signInMock(page);
  await switchTab(page, "Уведомления");
  await expect(page.getByRole("heading", { name: "Уведомления" })).toBeVisible();

  // The request row name is exactly "Собеседник #04821"; the feed item that
  // mentions the same id is a longer string, so exact matching targets the row.
  const firstReq = page.getByText("Собеседник #04821", { exact: true });
  await expect(firstReq).toBeVisible();

  // Accept the first request → row disappears.
  await page.getByRole("button", { name: "Принять" }).first().click();
  await expect(firstReq).toBeHidden();

  // Decline the next remaining request → row disappears.
  const secondReq = page.getByText("Собеседник #01390", { exact: true });
  await expect(secondReq).toBeVisible();
  await page.getByRole("button", { name: "Отклонить" }).first().click();
  await expect(secondReq).toBeHidden();

  assertNoErrors(guard);
});

test("mark all notifications as read", async ({ page }) => {
  await signInMock(page);
  await switchTab(page, "Уведомления");

  const markAll = page.getByRole("button", { name: "Прочитать все" });
  await expect(markAll).toBeVisible();
  await markAll.click();
  // Once everything is read the action button is gone (unreadCount === 0).
  await expect(markAll).toBeHidden();
});

test("dismiss the enable-push banner", async ({ page }) => {
  await signInMock(page);
  await switchTab(page, "Уведомления");

  await expect(page.getByText("Включите уведомления")).toBeVisible();
  // «Включить» requests browser notification permission (granted in config) and
  // hides the banner.
  await page.getByRole("button", { name: "Включить" }).click();
  await expect(page.getByText("Включите уведомления")).toBeHidden();
});
