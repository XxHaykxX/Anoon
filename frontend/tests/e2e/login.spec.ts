import { test, expect } from "@playwright/test";
import { gotoAnoon, expectChats, attachErrorGuard, assertNoErrors } from "./helpers";

/** Onboarding «Войти» → login form → (mock) Chats (BUG-24 landing screen). */
test("onboarding → login → chats", async ({ page }) => {
  const guard = attachErrorGuard(page);
  await gotoAnoon(page);

  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByText("Анонимный чат-рулетка", { exact: false })).toBeVisible();

  const submit = page.getByRole("button", { name: "Войти", exact: true });
  // Disabled until a valid email + 6-char password are present.
  await expect(submit).toBeDisabled();

  await page.getByPlaceholder("you@example.com").fill("tester@anoon.chat");
  await page.getByPlaceholder("Ваш пароль").fill("secret123");
  await expect(submit).toBeEnabled();
  await submit.click();

  await expectChats(page);
  assertNoErrors(guard);
});

test("login can also be reached via «Пропустить»", async ({ page }) => {
  await gotoAnoon(page);
  await page.getByRole("button", { name: "Пропустить" }).click();
  await expect(page.getByPlaceholder("Ваш пароль")).toBeVisible();
});
