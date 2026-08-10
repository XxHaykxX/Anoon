import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { TINY_JPEG_BUFFER } from "../real/helpers";

/**
 * ONE-OFF prod check (#42): does a photo sent in an anon chat actually render
 * for the other person ON THE LIVE SERVER, where media goes through Caddy and
 * an https origin rather than the local single-origin proxy.
 *
 * Not part of any suite: it registers two throwaway accounts on the live
 * backend, and the caller deletes them afterwards (docs/SESSION-2026-08-11.md).
 * Gated on E2E_PROD so a stray `playwright test` can never create prod users.
 *
 *   E2E_PROD=1 BASE_URL=https://5-129-206-152.sslip.io \
 *     npx playwright test tests/e2e/prod --project=chromium
 */
const E2E_PROD = process.env.E2E_PROD === "1";
test.skip(!E2E_PROD, "Prod photo check is opt-in: set E2E_PROD=1 (it registers live accounts).");

const CONTEXT = {
  permissions: ["clipboard-read", "clipboard-write", "notifications"],
  viewport: { width: 390, height: 844 },
};

/** Unique per run: registration is real, and a re-run must not collide. */
const stamp = process.env.QA_STAMP ?? "x";
const ACCOUNTS = {
  a: { email: `qa.foto.a.${stamp}@anoon.test`, name: "КуА Фото", age: "27", gender: "Мужчина" },
  b: { email: `qa.foto.b.${stamp}@anoon.test`, name: "КуБэ Фото", age: "26", gender: "Женщина" },
};

async function register(page: Page, who: keyof typeof ACCOUNTS) {
  const acc = ACCOUNTS[who];
  await page.goto("/anoon");
  await page.getByRole("button", { name: "Слайд 4" }).click();
  await page.getByRole("button", { name: "Начать" }).click();
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  await expect(page.getByRole("heading", { name: "Регистрация" })).toBeVisible();

  await page.getByPlaceholder("you@example.com").fill(acc.email);
  await page.getByPlaceholder("Минимум 6 символов").fill("qafoto123");
  await page.getByPlaceholder("Как вас зовут").fill(acc.name);
  await page.getByPlaceholder("18+").fill(acc.age);
  await page.getByRole("button", { name: acc.gender }).click();
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();

  // Real mode lands straight on «Чаты» — there is no verification gate.
  await expect(page.getByRole("heading", { name: "Чаты" })).toBeVisible({ timeout: 45_000 });
}

test.describe.serial("prod: a photo in an anon chat renders for the peer", () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser }) => {
    contextA = await browser.newContext(CONTEXT);
    contextB = await browser.newContext(CONTEXT);
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();
    await register(pageA, "a");
    await register(pageB, "b");
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
  });

  test("both land in the same anon chat", async () => {
    for (const page of [pageA, pageB]) {
      await page.getByRole("button", { name: "Рулетка" }).click();
      await page.getByRole("button", { name: "Начать чат" }).click();
    }
    await expect(pageA.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });
    await expect(pageB.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });
  });

  test("the photo loads for the peer, not just for the sender", async () => {
    await pageA
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({ name: "prod-photo.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG_BUFFER });

    const bubbleB = pageB.getByRole("button", { name: "Открыть изображение" }).last();
    await expect(bubbleB).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByText("не удалось загрузить")).toBeHidden();

    // The assertion with teeth: the <img> resolved to real bytes over https,
    // which is the half that only prod can prove (signed file URL + Caddy).
    const img = bubbleB.locator("img");
    await expect(img).toHaveJSProperty("complete", true, { timeout: 30_000 });
    await expect(img).not.toHaveJSProperty("naturalWidth", 0);
  });
});
