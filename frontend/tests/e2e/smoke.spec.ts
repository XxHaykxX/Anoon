import { test, expect } from "@playwright/test";
import {
  gotoAnoon,
  signInMock,
  switchTab,
  bottomNav,
  expectHome,
  attachErrorGuard,
  assertNoErrors,
} from "./helpers";

/**
 * Smoke coverage: the app boots, every reachable screen renders its key heading,
 * the bottom tab bar switches sections, and nothing throws / logs a real error
 * while walking the route graph.
 */
test.describe("smoke", () => {
  test("boots at /anoon on the onboarding screen", async ({ page }) => {
    const guard = attachErrorGuard(page);
    await gotoAnoon(page);
    // First-slide CTA is «Далее» («Начать» only appears on the last slide).
    await expect(page.getByRole("button", { name: "Далее" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Пропустить" })).toBeVisible();
    assertNoErrors(guard);
  });

  test("bottom nav switches Chats / Notifications / Profile / Roulette", async ({ page }) => {
    const guard = attachErrorGuard(page);
    await signInMock(page);

    await switchTab(page, "Чаты");
    await expect(page.getByRole("heading", { name: "Чаты" })).toBeVisible();
    await expect(bottomNav(page).getByRole("button", { name: "Чаты" })).toHaveAttribute(
      "aria-current",
      "true",
    );

    await switchTab(page, "Уведомления");
    await expect(page.getByRole("heading", { name: "Уведомления" })).toBeVisible();

    await switchTab(page, "Профиль");
    await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();

    await switchTab(page, "Рулетка");
    await expectHome(page);

    assertNoErrors(guard);
  });

  test("walk the reachable route graph without runtime errors", async ({ page }) => {
    const guard = attachErrorGuard(page);

    // Onboarding → Login → Forgot-password + Register entry points render.
    await gotoAnoon(page);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page.getByText("Анонимный чат-рулетка", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Забыл пароль?" }).click();
    await expect(page.getByRole("heading", { name: "Восстановление пароля" })).toBeVisible();

    // Fresh boot → sign in (mock) to reach the authed tabs (avoids fragile
    // back-navigation from the forgot-password screen).
    await signInMock(page);

    // BUG-24: Chats (not Home) is the post-login landing screen now — the
    // «Установить» button lives in Home's header, so go there first.
    await switchTab(page, "Рулетка");
    await expectHome(page);

    // Home → Install → back (Install has its own «Назад», no bottom nav).
    await page.getByRole("button", { name: "Установить" }).click();
    await expect(page.getByRole("heading", { name: "Установить" })).toBeVisible();
    await page.getByRole("button", { name: "Назад" }).click();
    await expectHome(page);

    // Friends → Requests (via the floating «Заявки» button) → back.
    await switchTab(page, "Чаты");
    await expect(page.getByRole("heading", { name: "Чаты" })).toBeVisible();
    await page.getByRole("button", { name: "Заявки", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Заявки в друзья" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Назад" }).click();
    await expect(page.getByRole("heading", { name: "Чаты" })).toBeVisible();

    // Friends → Invite → back. The trigger is an <svg> with aria-label
    // «Пригласить друга» (not a <button>), so match by accessible label.
    await page.getByLabel("Пригласить друга").click();
    await expect(page.getByRole("heading", { name: "Пригласить друга" })).toBeVisible();
    await page.getByRole("button", { name: "Назад" }).click();
    await expect(page.getByRole("heading", { name: "Чаты" })).toBeVisible();

    // Notifications tab.
    await switchTab(page, "Уведомления");
    await expect(page.getByRole("heading", { name: "Уведомления" })).toBeVisible();

    // Profile → Settings → Banned demo screen → back.
    await switchTab(page, "Профиль");
    await expect(page.getByRole("heading", { name: "Профиль" })).toBeVisible();
    await page.getByRole("button", { name: "Настройки" }).click();
    await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
    await page.getByRole("button", { name: "Экран блокировки (демо)" }).click();
    await expect(page.getByRole("heading", { name: "Доступ заблокирован" })).toBeVisible();

    assertNoErrors(guard);
  });
});
