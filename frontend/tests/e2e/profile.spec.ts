import { test, expect } from "@playwright/test";
import { signInMock, switchTab, attachErrorGuard, assertNoErrors } from "./helpers";

/** Profile: edit nick/age, save, copy link, then log out back to onboarding. */
test("edit profile, copy link, and log out", async ({ page }) => {
  const guard = attachErrorGuard(page);
  await signInMock(page);

  await switchTab(page, "Профиль");
  await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();

  // Edit nick + age (mock user starts as "solar_fox" / age "24").
  const nick = page.getByPlaceholder("Придумайте ник");
  await nick.fill("auto_tester");
  const age = page.getByPlaceholder("Возраст");
  await age.fill("30");

  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();

  // Copy the share link (clipboard permission granted in the config; the app
  // shows the confirmation regardless of whether the write resolves).
  await page.getByRole("button", { name: "Скопировать ссылку" }).click();
  await expect(page.getByText("Скопировано", { exact: false })).toBeVisible();

  // Log out → onboarding.
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("heading", { name: "Живая рулётка" })).toBeVisible();

  assertNoErrors(guard);
});

/** Profile → Settings → change nick → back via «Назад». */
test("profile opens settings and saves a nick", async ({ page }) => {
  await signInMock(page);
  await switchTab(page, "Профиль");
  await page.getByRole("button", { name: "Настройки" }).click();

  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
  await page.getByPlaceholder("Новый ник").fill("changed_nick");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();

  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
});
