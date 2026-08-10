import { test, expect } from "@playwright/test";
import { gotoAnoon, expectChats, attachErrorGuard, assertNoErrors } from "./helpers";

/** Onboarding «Начать» → login form → (mock) Chats (BUG-24 landing screen). */
test("onboarding → login → chats", async ({ page }) => {
  const guard = attachErrorGuard(page);
  await gotoAnoon(page);

  // «Начать» lands on the LOGIN screen, not registration: signing in is the
  // commoner intent, and the sign-up link sits at the bottom of that screen.
  await page.getByRole("button", { name: "Слайд 4" }).click();
  await page.getByRole("button", { name: "Начать" }).click();
  await expect(page.getByRole("heading", { name: "Добро пожаловать в Anoon" })).toBeVisible();

  const submit = page.getByRole("button", { name: "Войти", exact: true });
  // Disabled until a valid email + 6-char password are present.
  await expect(submit).toBeDisabled();

  await page.getByPlaceholder("Почта или ник").fill("tester@anoon.chat");
  await page.getByPlaceholder("Пароль").fill("secret123");
  await expect(submit).toBeEnabled();
  await submit.click();

  await expectChats(page);
  assertNoErrors(guard);
});

test("login can also be reached via «Пропустить»", async ({ page }) => {
  await gotoAnoon(page);
  await page.getByRole("button", { name: "Пропустить" }).click();
  await expect(page.getByPlaceholder("Пароль")).toBeVisible();
});
