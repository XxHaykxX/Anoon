import { test, expect } from "@playwright/test";
import { gotoAnoon, expectHome, attachErrorGuard, assertNoErrors } from "./helpers";

/**
 * Onboarding carousel → register form → (mock) onboarding chain → Home.
 *
 * In mock mode (`!USE_TINODE`) «Зарегистрироваться» does NOT hit a backend — it
 * steps client-side through verify-email → gender → profile-setup → Home.
 */
test("onboarding → register → mock onboarding chain → home", async ({ page }) => {
  const guard = attachErrorGuard(page);
  await gotoAnoon(page);

  // Advance the carousel to the last slide, then «Начать» → register.
  // Jumping via the last progress dot is the most robust way to reach it.
  await page.getByRole("button", { name: "Слайд 4" }).click();
  await page.getByRole("button", { name: "Начать" }).click();

  await expect(page.getByRole("heading", { name: "Регистрация" })).toBeVisible();

  // Fill the form (all fields required to enable the submit).
  await page.getByPlaceholder("you@example.com").fill("newuser@anoon.chat");
  await page.getByPlaceholder("Минимум 6 символов").fill("secret123");
  await page.getByPlaceholder("Как вас зовут").fill("Тестовый Пользователь");
  await page.getByPlaceholder("18+").fill("24");
  await page.getByRole("button", { name: "Мужчина" }).click();

  const submit = page.getByRole("button", { name: "Зарегистрироваться" });
  await expect(submit).toBeEnabled();
  await submit.click();

  // Mock chain: verify-email → gender → profile-setup → home.
  await expect(page.getByRole("heading", { name: "Подтвердите почту" })).toBeVisible();
  await page.getByRole("button", { name: "Я подтвердил — продолжить" }).click();

  await expect(page.getByRole("heading", { name: "Выберите пол" })).toBeVisible();
  await page.getByRole("button", { name: "Женщина" }).click();
  await page.getByRole("button", { name: "Понимаю, что пол изменить будет нельзя" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();

  await expect(page.getByRole("heading", { name: "Заполните профиль" })).toBeVisible();
  await page.getByPlaceholder("Ваше имя").fill("Тест");
  await page.getByRole("button", { name: "Готово" }).click();

  await expectHome(page);
  assertNoErrors(guard);
});

test("register submit stays disabled until every field is valid", async ({ page }) => {
  await gotoAnoon(page);
  await page.getByRole("button", { name: "Слайд 4" }).click();
  await page.getByRole("button", { name: "Начать" }).click();

  const submit = page.getByRole("button", { name: "Зарегистрироваться" });
  await expect(submit).toBeDisabled();

  // Fill everything except gender — should still be disabled.
  await page.getByPlaceholder("you@example.com").fill("x@y.zz");
  await page.getByPlaceholder("Минимум 6 символов").fill("secret123");
  await page.getByPlaceholder("Как вас зовут").fill("Имя");
  await page.getByPlaceholder("18+").fill("30");
  await expect(submit).toBeDisabled();

  await page.getByRole("button", { name: "Мужчина" }).click();
  await expect(submit).toBeEnabled();
});
