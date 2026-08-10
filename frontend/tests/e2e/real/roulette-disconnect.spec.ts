import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { skipUnlessReal, loginReal, switchTab } from "./helpers";

skipUnlessReal(test);

/**
 * The half of #40 that no click can reach: the peer does not press anything,
 * their SOCKET dies — a closed tab, a killed app, a phone that lost signal.
 *
 * That path produces no `peer:leaving` frame at all (the client that would
 * send it is gone) and no POST /roulette/end, so before this fix the remaining
 * user sat in a live-looking chat with nobody on the other end, forever. What
 * answers now is companion's own bookkeeping: last socket gone, a grace period
 * for the reload case, then the anon match is ended and the peer is told with
 * reason=peer_disconnected.
 *
 * The wait is deliberately generous: the grace is 20s server-side
 * (wsDisconnectGrace in internal/api/roulette.go) and this asserts on what
 * happens after it, so a slower box must not turn a correct server into a red
 * test. Shortening the grace to make the suite faster would be testing a
 * different product than the one that ships.
 */
test.describe.serial("anon roulette: a peer whose socket dies is reported as gone", () => {
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

  test("A's browser vanishes → B is told, without A ever asking to leave", async () => {
    // No «Завершить разговор», no navigation, no beforeunload courtesy: the
    // context is destroyed, which is as close to "the tab was closed" as a test
    // can get.
    await contextA.close();

    await expect(pageB.getByText("Собеседник вышел из чата")).toBeVisible({ timeout: 60_000 });
    await expect(pageB.getByRole("button", { name: "Новый собеседник" })).toBeEnabled();

    // Leave the queue and the screen behind, so the next spec starts clean.
    await pageB.getByRole("button", { name: "На главную" }).click();
  });
});
