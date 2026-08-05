import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { skipUnlessReal, loginReal, switchTab } from "./helpers";

skipUnlessReal(test);

/**
 * Real 2-user roulette: matchmaking → anon chat → reveal proposal → both
 * sides become friends (Wave-2 reveal flow, AnoonRevealPrompt / AnoonAnonChat).
 *
 * Flakier than the other real/ specs by nature: unlike media/reactions/
 * reply-edit-delete/receipts/avatar/calls (which friend the two seeded
 * accounts directly via search), pairing here happens through companion's
 * SHARED matchmaking queue — if any other real user (or a concurrently-run
 * QA pass) is queued with a compatible age/gender bucket at the same moment,
 * *that* person could get matched with admin1 or admin2 instead of each
 * other, and this spec will time out waiting for the composer. Safe to
 * retry; not safe to assume "flaky" always means a real regression.
 *
 * admin1 is male / admin2 is female (see helpers.ts's ACCOUNTS) — matchmaking
 * always pairs opposite genders (AnoonHome.tsx's note). Neither side picks a
 * peer-age filter, maximizing (not guaranteeing) that they land on each other
 * if the bucket is otherwise empty.
 *
 * NOTE (BUG-21): own age is no longer a manual Home pick — it's derived from
 * each account's real profile age (see ageRangeFor() in AnoonHome.tsx), so
 * admin1/admin2 are no longer guaranteed to share the same own-age
 * matchmaking bucket the way clicking the same chip used to force. If their
 * seeded profile ages fall in different buckets, this spec may pair slower
 * or time out more often than before — a real flakiness risk from BUG-21,
 * not something this file can fix (matchmaking-bucket logic is out of
 * e2e-helper scope).
 *
 * NOTE: admin1/admin2 may already be friends from a previous run of the other
 * real/ specs (which friend them via search) — if so, `requestReveal`/accepting
 * a reveal on an already-friended pair should just no-op the "become friends"
 * side effect rather than error; this spec only asserts the UI's own success
 * banner, not the friends-list state, so it doesn't need to special-case that.
 */
test.describe.serial("anon roulette: match, reveal proposal → friends", () => {
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
    // BUG-24 made Chats (not Home) the post-login landing screen — go to
    // Home first. BUG-21 removed the own-age gate, so «Начать чат» is enabled
    // immediately once there.
    for (const page of [pageA, pageB]) {
      await switchTab(page, "Рулетка");
      await page.getByRole("button", { name: "Начать чат" }).click();
    }

    // Real matchmaking round-trip — generous timeout for queue processing,
    // well beyond the ~1.5s mock-mode auto-match the rest of the suite uses.
    await expect(pageA.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });
    await expect(pageB.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });
  });

  test("send a message anonymously", async () => {
    const draft = `Аноним-привет ${Date.now()}`;
    await pageA.getByPlaceholder("Сообщение").fill(draft);
    await pageA.getByRole("button", { name: "Отправить" }).click();
    await expect(pageB.getByText(draft, { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test("reveal proposal → accept → both sides become friends", async () => {
    // Header button label is «Раскрыть» (not the older "Раскрыть профиль").
    await pageA.getByRole("button", { name: "Раскрыть", exact: true }).click();

    await expect(pageB.getByText("Собеседник хочет открыть профиль")).toBeVisible({
      timeout: 15_000,
    });
    await pageB.getByRole("button", { name: "Открыть", exact: true }).click();

    await expect(pageA.getByText("Профили открыты — вы теперь друзья").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(pageB.getByText("Профили открыты — вы теперь друзья").first()).toBeVisible();
  });

  test.skip(
    "TODO(QA): decline/block a reveal request",
    async () => {
      // Not covered here — this file's pair always accepts so the rest of the
      // real/ suite's friending assumption (admin1/admin2 end up friends) is
      // satisfied. A decline/block variant would need a THIRD seeded account
      // (declining un-friends nobody, but blocking ends the match/leaves
      // roulette entirely) so it doesn't interfere with the shared pair the
      // other specs in this directory depend on.
    },
  );
});
