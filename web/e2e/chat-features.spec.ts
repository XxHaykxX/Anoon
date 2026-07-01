import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "anoon-session",
      JSON.stringify({ state: { hasProfile: true, nickname: "Тест", publicId: "00001", synced: false }, version: 0 }),
    );
  });
});

test("эмодзи-пикер вставляет символ в поле", async ({ page }) => {
  await page.goto("/chat/p1234");
  await page.getByRole("button", { name: "Эмодзи" }).click();
  await page.getByRole("button", { name: "🔥" }).click();
  await expect(page.getByPlaceholder("Сообщение…")).toHaveValue(/🔥/);
});

test("ответ на сообщение показывает цитату", async ({ page }) => {
  await page.goto("/chat/p1234");
  const input = page.getByPlaceholder("Сообщение…");
  // Несколько сообщений: отвечаем на нижнее (меню не перекрывается хедером).
  await input.fill("ноль");
  await input.press("Enter");
  await input.fill("первое");
  await input.press("Enter");
  await expect(page.getByText("первое")).toBeVisible();

  await page.getByRole("button", { name: "Действия с сообщением" }).last().click();
  await page.getByRole("menuitem", { name: "Ответить" }).click();
  // Полоса ответа появилась.
  await expect(page.getByText(/Ответ: первое/)).toBeVisible();

  await input.fill("второе");
  await input.press("Enter");
  await expect(page.getByText("второе")).toBeVisible();
});

test("удаление своего сообщения убирает его", async ({ page }) => {
  await page.goto("/chat/p1234");
  const input = page.getByPlaceholder("Сообщение…");
  await input.fill("удали меня");
  await input.press("Enter");
  await expect(page.getByText("удали меня")).toBeVisible();

  await page.getByRole("button", { name: "Действия с сообщением" }).last().click();
  await page.getByRole("menuitem", { name: "Удалить" }).click();
  await expect(page.getByText("удали меня")).toHaveCount(0);
});
