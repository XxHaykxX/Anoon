import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { skipUnlessReal, loginReal } from "./helpers";

skipUnlessReal(test);

/**
 * A refused companion call must be VISIBLE, not drawn as a success (#26).
 *
 * Five calls in `CompanionClient` used to swallow refusals: friendRequest and
 * friendRespond returned as if they had worked, friendsList/listBlocks answered
 * a failure with `[]` (indistinguishable from "you have none"), and end()
 * dropped it. That is the same family of bug as the fabricated reveal — the
 * client asserting something the backend never agreed to.
 *
 * These specs fake the refusal with `page.route` rather than by breaking the
 * backend: a 500 on one endpoint is exactly what the client has to survive, and
 * it keeps the shared seeded accounts untouched (the intercepted requests never
 * reach companion, so no state changes and the rest of the real/ suite is
 * unaffected).
 */
test.describe.serial("refused companion calls surface to the user", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("a refused friend request rolls back «Отправлено» and says so", async () => {
    await page.route("**/api/friends/request", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }),
    );
    await loginReal(page, "a");

    // Same bare-svg-aria-label entry point friends-directory.spec.ts uses.
    await page.locator('[aria-label="Поиск друзей"]').click();
    await expect(page.getByRole("heading", { name: "Найти друга" })).toBeVisible();
    // Any seeded #ID that is not already a friend of admin1 — the row only has
    // to offer «Добавить»; whether the request would succeed is beside the
    // point, since the route interceptor answers it.
    await page.getByPlaceholder("Например, 00042").fill("00005");

    const add = page.getByRole("button", { name: "Добавить" }).first();
    await expect(add).toBeVisible({ timeout: 15_000 });
    await add.click();

    // Anchored on the text, not on role=alert: the page carries other alert
    // nodes (an empty one shows up in the a11y snapshot), so the role alone is
    // not unique.
    await expect(page.getByText("Не удалось отправить заявку. Попробуйте ещё раз")).toBeVisible({
      timeout: 10_000,
    });
    // The optimistic label must be gone: a request that was refused is not
    // pending, and leaving «Запрос отправлен» invites the user to wait for
    // something that will never arrive.
    await expect(page.getByText("Запрос отправлен")).toHaveCount(0);
    await expect(add).toBeVisible();
    await page.unroute("**/api/friends/request");
  });

  test("a block list that cannot be read does not render as «Список пуст»", async () => {
    await page.route("**/api/friends/blocks", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }),
    );
    // Back out of the search screen (shell-provided top bar — its only back
    // affordance, same as friends-directory.spec.ts), then Профиль → Настройки
    // → Заблокированные.
    await page.getByRole("button", { name: "Назад" }).click();
    await expect(page.getByRole("heading", { name: "Найти друга" })).toBeHidden();
    await page.getByRole("button", { name: "Профиль" }).click();
    await page.getByText("Настройки", { exact: true }).click();
    await page.getByText("Заблокированные", { exact: true }).click();

    await expect(page.getByText("Не удалось загрузить список")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Список пуст")).toHaveCount(0);
    await page.unroute("**/api/friends/blocks");
  });
});
