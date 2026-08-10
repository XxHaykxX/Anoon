import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { skipUnlessReal, loginReal, switchTab } from "./helpers";

skipUnlessReal(test);

/**
 * Real 2-user roulette: one side ends the chat, the OTHER side must be told.
 *
 * This is the regression this file exists for (#40): «Разговор завершён» used
 * to be shown only to whoever tapped «Завершить разговор». The peer got a
 * system line in the thread at best — and nothing at all when the leaver's
 * `peer:leaving` frame never went out (closed tab, dead network) — so their
 * chat simply froze with no way forward. Companion now sends the leave itself
 * from POST /roulette/end, and the peer's screen offers the two exits.
 *
 * Pairing goes through the SHARED matchmaking queue, so the same caveat as
 * reveal.spec.ts applies: a foreign user queued in a compatible bucket can be
 * matched with admin1/admin2 instead of each other. A timeout waiting for the
 * composer is worth a retry before it is called a regression.
 */
test.describe.serial("anon roulette: ending the chat reaches both sides", () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser }) => {
    contextA = await browser.newContext();
    contextB = await browser.newContext();
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();

    await loginReal(pageA, "a");
    await loginReal(pageB, "b");
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
  });

  test("both join the queue and land in the same anon chat", async () => {
    for (const page of [pageA, pageB]) {
      await switchTab(page, "Рулетка");
      await page.getByRole("button", { name: "Начать чат" }).click();
    }
    await expect(pageA.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });
    await expect(pageB.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });
  });

  test("A ends the chat → B is told, with a way out of it", async () => {
    await pageA.getByRole("button", { name: "Меню чата" }).click();
    await pageA.getByRole("button", { name: "Завершить разговор" }).click();

    // The whole point: B did not ask for this and must still learn about it.
    await expect(pageB.getByText("Собеседник вышел из чата")).toBeVisible({ timeout: 15_000 });
    // Both exits, and the primary one is NOT gated on leaving a rating — a
    // frozen chat must not be traded for a screen that holds the way out
    // hostage to a favour.
    const next = pageB.getByRole("button", { name: "Новый собеседник" });
    await expect(next).toBeEnabled();
    await expect(pageB.getByRole("button", { name: "На главную" })).toBeVisible();

    // A gets its own rating screen, as before.
    await expect(pageA.getByText("Разговор завершён")).toBeVisible({ timeout: 15_000 });
  });

  test("B taps «Новый собеседник» and is searching again, not stuck", async () => {
    await pageB.getByRole("button", { name: "Новый собеседник" }).click();
    await expect(pageB.getByText("Собеседник вышел из чата")).toBeHidden();
    // The searching screen owns the cancel button; asserting on it (rather than
    // on the spinner's text) is what tells us the queue was actually re-joined.
    await expect(pageB.getByRole("button", { name: "Отмена" })).toBeVisible({
      timeout: 15_000,
    });
    // Leave the shared queue behind us: a member left waiting would be matched
    // with the next spec's own enqueue and pair the wrong two screens.
    await pageB.getByRole("button", { name: "Отмена" }).click();

    await pageA.getByRole("button", { name: "Пропустить" }).click();
  });
});
