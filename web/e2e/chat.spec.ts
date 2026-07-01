import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Заранее кладём профиль в persist-стор (формат zustand persist).
  await page.addInitScript(() => {
    localStorage.setItem(
      "anoon-session",
      JSON.stringify({ state: { hasProfile: true, nickname: "Тест", publicId: "00001", synced: false }, version: 0 }),
    );
  });
});

test("чат: отправленный текст появляется", async ({ page }) => {
  await page.goto("/chat/p1234");
  const input = page.getByPlaceholder("Сообщение…");
  await input.fill("привет");
  await input.press("Enter");
  await expect(page.getByText("привет")).toBeVisible();
});

// Медиа/голос/push требуют secure-context (микрофон/PushManager) и/или бэкенда — вне e2e-скелета.
test.skip("медиа-upload / запись голоса / push — нужен secure-context + бэкенд", async () => {});
