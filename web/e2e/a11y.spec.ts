import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

// A11y-прогон ключевых экранов. Падаем только на serious/critical нарушениях
// (moderate/minor фиксим отдельно; часть — стили Liquid Glass вне нашего контроля).
const SEVERE = ["serious", "critical"];

function severe(violations: { impact?: string | null }[]) {
  return violations.filter((v) => v.impact && SEVERE.includes(v.impact));
}

test("a11y: онбординг без serious/critical", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");
  const res = await new AxeBuilder({ page }).analyze();
  const bad = severe(res.violations);
  if (bad.length) console.log("VIOLATIONS", JSON.stringify(bad.map((v) => ({ id: v.id, impact: v.impact })), null, 2));
  expect(bad).toEqual([]);
});

test("a11y: чат без serious/critical", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "anoon-session",
      JSON.stringify({ state: { hasProfile: true, nickname: "Тест", publicId: "00001", synced: false }, version: 0 }),
    );
  });
  await page.goto("/chat/p1234");
  await page.getByPlaceholder("Сообщение…").waitFor();
  const res = await new AxeBuilder({ page }).analyze();
  const bad = severe(res.violations);
  if (bad.length) console.log("VIOLATIONS", JSON.stringify(bad.map((v) => ({ id: v.id, impact: v.impact })), null, 2));
  expect(bad).toEqual([]);
});
