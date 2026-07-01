import { test, expect, devices } from "@playwright/test";

// Мобильная проверка админки: логин + все разделы на iPhone-вьюпорте.
// Ловим горизонтальное переполнение (наезд колонок), проверяем drawer и галерею.
// Цель — прод (или ADMIN_URL). Требует api-режим + реальные креды.

const ADMIN = process.env.ADMIN_URL ?? "https://anoon-admin.vercel.app";
const PASS = process.env.ADMIN_PASS ?? "lVRmXO6cb6i4";

test.use({ ...devices["iPhone 13"] });

// Переполнение по горизонтали в px (0–1 = ок).
async function overflowPx(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("админка на телефоне: логин + все разделы без наезда колонок", async ({ page }) => {
  test.setTimeout(120_000);

  // Логин.
  await page.goto(`${ADMIN}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill("admin@anoon.app");
  await page.locator('input[type="password"]').fill(PASS);
  const [loginResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/login") && r.request().method() === "POST", { timeout: 30_000 }),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
  expect(loginResp.status(), "логин должен вернуть 200").toBe(200);
  // Дать куке/identity осесть (иначе клиентский редирект с корня гонится с навигацией).
  await page.waitForTimeout(1500);

  const sections = [
    { href: "/overview", label: "Обзор" },
    { href: "/reports", label: "Жалобы" },
    { href: "/users", label: "Пользователи" },
    { href: "/bans", label: "Баны" },
    { href: "/media", label: "Файлы" },
    { href: "/gallery", label: "Галерея" },
    { href: "/audit", label: "Журнал" },
  ];

  for (const s of sections) {
    await page.goto(`${ADMIN}${s.href}`, { waitUntil: "domcontentloaded" });
    // Не должно выкинуть на логин (сессия валидна).
    expect(page.url(), `${s.label}: не залогинен`).not.toContain("/login");
    // Даём анимации/данным осесть.
    await page.waitForTimeout(1000);
    const ov = await overflowPx(page);
    console.log(`[${s.label}] overflow=${ov}px`);
    await page.screenshot({ path: `test-results/admin-mobile-${s.href.slice(1)}.png`, fullPage: true });
    // Допускаем ≤2px (субпиксельное округление).
    expect(ov, `Горизонтальное переполнение на ${s.label}`).toBeLessThanOrEqual(2);
  }

  // Drawer открывается по бургеру и содержит навигацию.
  await page.goto(`${ADMIN}/overview`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Открыть меню" }).click();
  await expect(page.getByRole("link", { name: "Галерея" })).toBeVisible();
  await page.screenshot({ path: "test-results/admin-mobile-drawer.png" });
  // Переход по ссылке из drawer.
  await page.getByRole("link", { name: "Галерея" }).click();
  await page.waitForURL((u) => u.pathname === "/gallery", { timeout: 15_000 });
  await expect(page).toHaveURL(/\/gallery$/);

  // PWA: manifest отдаётся.
  const mani = await page.request.get(`${ADMIN}/manifest.webmanifest`);
  expect(mani.ok()).toBeTruthy();
  const sw = await page.request.get(`${ADMIN}/sw.js`);
  expect(sw.ok()).toBeTruthy();
});
