import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { skipUnlessReal, loginReal, switchTab } from "./helpers";

skipUnlessReal(test);

/**
 * The other half of the disconnect story (see roulette-disconnect.spec.ts):
 * the socket dies and the SAME user comes straight back. A page reload, an app
 * the OS unloaded, a tunnel blip — the pairing itself never ended (companion's
 * `wsDisconnectGrace` exists for exactly this), but the client used to forget
 * it, dropping the user into «Чаты» while the peer kept talking to nobody.
 *
 * Every assertion here is preceded by a positive one on the same path: a
 * "the chat did not come back" failure is indistinguishable from "the stand is
 * down" unless the test has already shown, in the same run, that matching works
 * and a message crosses. So each step proves the live path first.
 */
test.describe.serial("anon roulette: a reload puts the user back in the chat", () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  const fromA = `a-before-reload-${Date.now()}`;
  const fromB = `b-before-reload-${Date.now()}`;

  test.beforeAll(async ({ browser }) => {
    contextA = await browser.newContext();
    contextB = await browser.newContext();
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();
    await loginReal(pageA, "a");
    await loginReal(pageB, "b");
  });

  test.afterAll(async () => {
    // End the conversation before walking away. Closing the browser is NOT
    // enough: the pairing lives on the server, and this file is the one spec
    // that deliberately leaves both parties sitting inside it. Since a reload
    // now restores an unfinished anonymous chat, whatever ran next inherited
    // this one — a later friend-chat test reloaded and landed in «Собеседник ·
    // ~XXXXXX» instead of «Чаты», then timed out waiting for a nav bar that
    // was never going to render.
    await pageA
      ?.getByRole("button", { name: "Завершить разговор" })
      .click({ timeout: 5_000 })
      .catch(() => {
        /* already ended by the test body — nothing to clean up */
      });
    await contextA?.close();
    await contextB?.close();
  });

  // LIVENESS. Nothing below this means anything if matching itself is broken.
  test("both join the queue, land in one chat, and messages cross", async () => {
    for (const page of [pageA, pageB]) {
      await switchTab(page, "Рулетка");
      await page.getByRole("button", { name: "Начать чат" }).click();
    }
    await expect(pageA.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });
    await expect(pageB.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });

    await pageA.getByPlaceholder("Сообщение").fill(fromA);
    await pageA.keyboard.press("Enter");
    await expect(pageB.getByText(fromA)).toBeVisible({ timeout: 20_000 });

    await pageB.getByPlaceholder("Сообщение").fill(fromB);
    await pageB.keyboard.press("Enter");
    await expect(pageA.getByText(fromB)).toBeVisible({ timeout: 20_000 });
  });

  test("A reloads → A is back in the same chat, with both sides of it", async () => {
    await pageA.reload();

    // Back INSIDE the chat, not on «Чаты»: the composer is the proof the anon
    // topic re-subscribed, not merely that a screen rendered.
    await expect(pageA.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 45_000 });
    // The peer's message and — the part an anon topic cannot answer on its own,
    // since it blanks `from` on every message it delivers — OUR OWN.
    await expect(pageA.getByText(fromB)).toBeVisible({ timeout: 20_000 });
    await expect(pageA.getByText(fromA)).toBeVisible({ timeout: 20_000 });
  });

  test("B never saw A leave, and the two can still talk", async () => {
    await expect(pageB.getByText("Собеседник вышел из чата")).toHaveCount(0);

    const afterReload = `a-after-reload-${Date.now()}`;
    await pageA.getByPlaceholder("Сообщение").fill(afterReload);
    await pageA.keyboard.press("Enter");
    await expect(pageB.getByText(afterReload)).toBeVisible({ timeout: 20_000 });

    // Leave the match behind so the next spec starts clean. The shell overlays
    // the chat's own back chevron with a hit target that runs closeAnon() (see
    // AnoonApp) — that, not the chevron, is the way out of a match.
    await pageA.getByLabel("Назад").last().click();
    await expect(pageA.getByRole("button", { name: "Начать чат" })).toBeVisible({
      timeout: 20_000,
    });
  });
});
