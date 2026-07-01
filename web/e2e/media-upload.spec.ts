import { test, expect } from "@playwright/test";

// Верификация #38: реальный аплоад медиа в Supabase Storage на проде.
// Онбординг (ждём synced===true) → чат → выбрать фото → отправить →
// проверить, что mediaPath проставился (Storage OK) и НЕТ stale/«Медиа недоступно».
// Цель — прод web (или WEB_URL). Требует включённого anonymous auth.

const WEB = process.env.WEB_URL ?? "https://anoon-web.vercel.app";

// 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("медиа: аплоад фото доходит до Storage (mediaPath), без «недоступно»", async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Например: Синий Кот").fill("Медиа Тест");
  await page.getByRole("button", { name: /Начать общение|Входим/ }).click();

  // Ждём реальный синк профиля (иначе аплоад падает — корень #38).
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          try {
            return JSON.parse(localStorage.getItem("anoon-session") || "{}").state?.synced === true;
          } catch {
            return false;
          }
        }),
      { timeout: 25_000, message: "профиль не синкнулся (synced!==true)" },
    )
    .toBe(true);

  // В чат (peer произвольный — аплоад не зависит от собеседника).
  await page.goto(`${WEB}/chat/veriftest01`, { waitUntil: "domcontentloaded" });

  // Дождаться гидратации composer (иначе onChange у file-input ещё не навешен).
  await expect(page.getByRole("button", { name: "Прикрепить фото или видео" })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);

  // Выбрать фото.
  await page.locator('input[type="file"]').setInputFiles({ name: "verif.png", mimeType: "image/png", buffer: PNG });
  // Дождаться превью (probe изображения асинхронный) и отправить.
  const sendBtn = page.getByRole("button", { name: "Отправить вложения" });
  await expect(sendBtn).toBeVisible({ timeout: 15_000 });
  await sendBtn.click();

  // Ждём результат аплоада в сторе.
  const status = await expect
    .poll(
      async () =>
        page.evaluate(() => {
          try {
            const byPeer = JSON.parse(localStorage.getItem("anoon-chat") || "{}").state?.byPeer || {};
            const msgs = Object.values(byPeer).flat() as Array<{ kind: string; stale?: boolean; mediaPath?: string }>;
            const media = msgs.filter((m) => m.kind !== "text");
            if (!media.length) return "no-media";
            if (media.some((m) => m.stale)) return "stale";
            if (media.some((m) => m.mediaPath)) return "uploaded";
            return "pending";
          } catch {
            return "err";
          }
        }),
      { timeout: 40_000, message: "аплоад не завершился" },
    )
    .toBe("uploaded");

  void status;
  // «Медиа недоступно» не должно появиться.
  await expect(page.getByText("Медиа недоступно")).toHaveCount(0);
});
