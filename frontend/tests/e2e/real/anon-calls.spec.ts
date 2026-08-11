import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { skipUnlessReal, loginReal, switchTab, ACCOUNTS } from "./helpers";

skipUnlessReal(test);

/**
 * Real 2-user calling INSIDE an anonymous roulette chat — the one call path
 * nothing covered before (calls.spec.ts only ever calls between friends, where
 * both sides already hold each other's real #ID).
 *
 * Why it deserves its own file rather than a case in calls.spec.ts: the whole
 * point here is what the callee is NOT allowed to learn. An anonymous call is
 * addressed by the per-match alias companion minted for the pair («~K7X2QM»),
 * companion re-stamps `from` with the caller's alias for that same match
 * (relayCallSignal in internal/api/callsignal.go), and the ringing screen must
 * therefore show «Собеседник» + that alias — never the caller's real #ID and
 * never their display name. If the signaling ever regressed to carrying #IDs
 * (the H2 pseudonym work is exactly what stopped it), a friend-chat call test
 * would stay green while anonymity was gone, because in a friend chat the #ID
 * is legitimately known. That is what this file watches.
 *
 * Same shared-matchmaking-queue caveat as reveal.spec.ts: pairing goes through
 * companion's real queue, so a third queued user in a compatible bucket can
 * take one of the two seeded accounts instead. Safe to retry; a timeout on the
 * composer is not automatically a regression.
 *
 * Deliberately does NOT reveal: the alias only exists before a reveal, so the
 * whole assertion set would evaporate the moment these two became "friends" in
 * this match. The pair is left un-revealed and the match is ended in afterAll.
 */
test.use({
  permissions: ["notifications", "microphone", "camera"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

/** Same reasoning as calls.spec.ts: hand-built contexts inherit no `test.use` permissions. */
const CALL_CONTEXT = {
  permissions: ["notifications", "microphone", "camera"],
  viewport: { width: 390, height: 844 },
};

/**
 * The alias companion mints per match: «~» plus six symbols from a 32-char
 * alphabet with I/O/0/1 dropped (store/roulette.go's `aliasAlphabet`). Asserting
 * the shape — not just "starts with ~" — is what makes «this is not a #ID»
 * a real check rather than a spelling one.
 */
const ALIAS = /^~[A-Z2-9]{6}$/;

/**
 * The full-screen ringing overlay (IncomingCall's `absolute inset-0 z-50` root).
 * Every identity assertion is scoped to it: the anon chat UNDERNEATH also
 * renders «Собеседник» in its header, so an unscoped `getByText` matches twice
 * and fails Playwright's strict mode instead of testing the ringer.
 */
function ringer(page: Page) {
  return page.locator("div.z-50").filter({ has: page.getByLabel("Отклонить звонок") });
}

test.describe.serial("anon roulette: calling by alias", () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser }) => {
    contextA = await browser.newContext(CALL_CONTEXT);
    contextB = await browser.newContext(CALL_CONTEXT);
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();

    await loginReal(pageA, "a");
    await loginReal(pageB, "b");

    for (const page of [pageA, pageB]) {
      await switchTab(page, "Рулетка");
      await page.getByRole("button", { name: "Начать чат" }).click();
    }
    await expect(pageA.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });
    await expect(pageB.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });
  });

  test.afterAll(async () => {
    // End the match rather than just closing the browser, and end it the way
    // the UI does — «Меню чата» → «Завершить разговор», which is what fires
    // /roulette/end. Tapping «Назад» only walks off the screen: the pairing
    // stays open, and the server's own cleanup gives up the moment these
    // accounts sign in again, which is precisely what the next spec does.
    //
    // This file runs FIRST in the suite, so the row it left was inherited by
    // everything after it. Once a reload restores an unfinished anonymous chat,
    // that meant an unrelated friend-chat test reloaded straight into this
    // conversation — call records and all — and timed out looking for a nav bar.
    await pageA
      ?.getByRole("button", { name: "Меню чата" })
      .click({ timeout: 5_000 })
      .catch(() => {});
    await pageA
      ?.getByRole("button", { name: "Завершить разговор" })
      .click({ timeout: 5_000 })
      .catch(() => {});
    await contextA?.close();
    await contextB?.close();
  });

  test("the anon chat header identifies the peer by alias, not by #ID", async () => {
    // Guards the premise of everything below: if this were already a #ID the
    // call assertions would pass while proving nothing.
    const header = pageA.locator(".border-b.border-border").first();
    await expect(header.getByText(ALIAS)).toBeVisible({ timeout: 15_000 });
    await expect(header.getByText(`#${ACCOUNTS.b.hashId}`)).toHaveCount(0);
  });

  test("audio call by alias: the ringer shows the alias, not who is calling", async () => {
    await pageA.getByLabel("Аудиозвонок").click();
    await expect(pageA.getByLabel("Завершить звонок")).toBeVisible({ timeout: 10_000 });

    const accept = pageB.getByLabel("Принять звонок");
    await expect(accept).toBeVisible({ timeout: 15_000 });
    const ringB = ringer(pageB);
    await expect(ringB.getByText("Входящий аудио-звонок")).toBeVisible();

    // The identity contract. `Собеседник` is AnoonApp's fallback for a `from`
    // that matches no friend row — which an alias never does, by construction,
    // even when the caller IS already a friend from an earlier reveal.
    await expect(ringB.getByText("Собеседник", { exact: true })).toBeVisible();
    await expect(ringB.getByText(ALIAS)).toBeVisible();
    // The caller's real handle must not appear anywhere on the ringing screen.
    await expect(ringB.getByText(`#${ACCOUNTS.a.hashId}`)).toHaveCount(0);

    await accept.click();
    await expect(pageB.getByLabel("Завершить звонок")).toBeVisible({ timeout: 10_000 });

    await pageA.getByLabel("Завершить звонок").click();
    await expect(pageA.getByLabel("Завершить звонок")).toBeHidden({ timeout: 10_000 });
    await expect(pageB.getByLabel("Завершить звонок")).toBeHidden({ timeout: 10_000 });
  });

  test("video call by alias, called the other way round, declined", async () => {
    // Reverse direction proves the alias resolves both ways: companion mints a
    // separate alias per side of the match, so B→A exercises a different
    // lookup than A→B did above.
    await pageB.getByLabel("Видеозвонок").click();
    await expect(pageB.getByLabel("Завершить звонок")).toBeVisible({ timeout: 10_000 });

    const decline = pageA.getByLabel("Отклонить звонок");
    await expect(decline).toBeVisible({ timeout: 15_000 });
    const ringA = ringer(pageA);
    await expect(ringA.getByText("Входящий видео-звонок")).toBeVisible();
    await expect(ringA.getByText("Собеседник", { exact: true })).toBeVisible();
    await expect(ringA.getByText(ALIAS)).toBeVisible();
    await expect(ringA.getByText(`#${ACCOUNTS.b.hashId}`)).toHaveCount(0);

    await decline.click();
    await expect(pageA.getByLabel("Отклонить звонок")).toBeHidden();
    await expect(pageB.getByLabel("Завершить звонок")).toBeHidden({ timeout: 10_000 });
  });
});
