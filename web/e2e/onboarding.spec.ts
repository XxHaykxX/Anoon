import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

test("онбординг: ник → экран поиска", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "anoon" })).toBeVisible();

  await page.getByPlaceholder("Например: Синий Кот").fill("Тест Кот");
  await page.getByRole("button", { name: /Начать общение|Входим/ }).click();

  // Фолбэк-мок (anonymous auth выкл) → сразу экран поиска с кнопкой «Найти».
  await expect(page.getByRole("button", { name: /Найти|Ищем/ })).toBeVisible();
});
