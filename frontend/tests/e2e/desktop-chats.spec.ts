import { test, expect, type Page } from "@playwright/test";
import { signInMock, expectChats } from "./helpers";

/**
 * «Чаты» on both branches (#34).
 *
 * Phone (390×844): tapping a chat row REPLACES the list with the conversation —
 * one screen at a time, as before.
 * Desktop (≥1024px): the same tap fills the right pane and the list stays put —
 * two panes, Telegram Desktop style.
 *
 * Both cases also cover the mock-mode regression they used to hide: a row tap
 * did nothing at all without a live backend, so the private chat was reachable
 * only through the row's chevron.
 */

const SHOTS =
  process.env.SHOT_DIR ??
  "C:/Users/Admin/AppData/Local/Temp/claude/C--Users-Admin-Desktop-anoon/301f5431-1eb6-4fb5-9407-7dc908142967/scratchpad";

/** First conversation row in the list. */
function firstRow(page: Page) {
  return page.locator('[data-testid="friend-row"]').first();
}

/**
 * Screen-enter animations run 250ms (SCREEN_ANIM in AnoonApp). Shooting before
 * they settle produced half-faded screenshots that are useless as evidence.
 */
async function shoot(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("список → переписка занимает весь экран", async ({ page }) => {
    await signInMock(page);
    await expect(firstRow(page)).toBeVisible();
    await shoot(page, "chats-390-list");

    await firstRow(page).click();

    // The conversation took over: composer in, list heading out.
    await expect(page.getByPlaceholder("Сообщение")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Чаты" })).toHaveCount(0);
    await shoot(page, "chats-390-thread");
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("две панели: список слева, переписка справа", async ({ page }) => {
    await signInMock(page);
    // Right pane starts empty rather than on some arbitrary chat.
    await expect(page.getByText("Выберите чат, чтобы начать переписку")).toBeVisible();
    await shoot(page, "chats-1440-empty");

    await firstRow(page).click();

    await expect(page.getByPlaceholder("Сообщение")).toBeVisible();
    // The whole point of two panes: the list did NOT go anywhere.
    await expectChats(page);
    await expect(firstRow(page)).toBeVisible();
    await shoot(page, "chats-1440-thread");

    // Switching peers keeps both panes — no route change, no full-screen chat.
    await page.locator('[data-testid="friend-row"]').nth(1).click();
    await expect(page.getByPlaceholder("Сообщение")).toBeVisible();
    await expectChats(page);
  });
});
