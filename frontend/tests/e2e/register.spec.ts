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

  // Advance the carousel to the last slide, then «Начать» → LOGIN. Signing in
  // is the commoner intent after onboarding, and «Войти через Google» skips the
  // form entirely; registration is one link below. Jumping via the last
  // progress dot is the most robust way to reach the last slide.
  await page.getByRole("button", { name: "Слайд 4" }).click();
  await page.getByRole("button", { name: "Начать" }).click();
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();

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
  // Экран теперь просит КОД из письма, и кнопка отключена, пока поле пусто
  // (AnoonVerifyEmail: `disabled={!token.trim() || confirming}`). В мок-режиме
  // код никем не проверяется — важно лишь, что он введён.
  await page.getByPlaceholder("Вставьте код из письма").fill("mock-token");
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

/**
 * Кнопка НАМЕРЕННО остаётся нажимаемой на неполной форме: выключенная кнопка не
 * может объяснить, чего не хватает, — а пустая форма раньше молчала в ответ на
 * тык. Проверка не ослаблена: то, что неполная форма не уходит дальше, здесь
 * проверяется переходом (экран остаётся «Регистрация»), а не атрибутом disabled.
 */
test("register submit объясняет, чего не хватает, и не пускает дальше", async ({ page }) => {
  await gotoAnoon(page);
  await page.getByRole("button", { name: "Слайд 4" }).click();
  await page.getByRole("button", { name: "Начать" }).click();
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();

  const submit = page.getByRole("button", { name: "Зарегистрироваться" });
  const nextScreen = page.getByRole("heading", { name: "Подтвердите почту" });

  // Пустая форма: тык отвечает сообщениями у каждого невалидного поля.
  await submit.click();
  await expect(page.getByText("Введите почту в виде you@example.com")).toBeVisible();
  await expect(page.getByText("Пароль от 6 символов")).toBeVisible();
  await expect(page.getByText("Введите имя")).toBeVisible();
  await expect(page.getByText("Возраст от 18 до 100")).toBeVisible();
  await expect(page.getByText("Выберите пол")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Регистрация" })).toBeVisible();
  await expect(nextScreen).toHaveCount(0);

  // Всё, кроме пола: жалоба ровно на пол, и дальше по-прежнему не пускает.
  await page.getByPlaceholder("you@example.com").fill("x@y.zz");
  await page.getByPlaceholder("Минимум 6 символов").fill("secret123");
  await page.getByPlaceholder("Как вас зовут").fill("Имя");
  await page.getByPlaceholder("18+").fill("30");
  await submit.click();
  await expect(page.getByText("Выберите пол")).toBeVisible();
  await expect(page.getByText("Введите имя")).toHaveCount(0);
  await expect(nextScreen).toHaveCount(0);

  // Возраст вне 18–100 — тоже стоп (форма 18+, это не косметика).
  await page.getByPlaceholder("18+").fill("17");
  await page.getByRole("button", { name: "Мужчина" }).click();
  await submit.click();
  await expect(page.getByText("Возраст от 18 до 100")).toBeVisible();
  await expect(nextScreen).toHaveCount(0);

  // И только полностью валидная форма уходит дальше — тот же локатор,
  // которым выше доказывалось, что перехода НЕ было.
  await page.getByPlaceholder("18+").fill("30");
  await expect(page.getByText("Возраст от 18 до 100")).toHaveCount(0);
  await submit.click();
  await expect(nextScreen).toBeVisible();
});
