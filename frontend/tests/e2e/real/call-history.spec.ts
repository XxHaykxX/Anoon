import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { skipUnlessReal, loginReal, ensureFriends, openFirstFriendChat } from "./helpers";

skipUnlessReal(test);

/**
 * The trace a finished call leaves behind (#41). It used to be a system line
 * injected into an in-memory list: it never reached the other party, and it
 * died with the tab. It is now a message in the conversation's own topic, which
 * answers both — so this spec asserts the three things that follow from that
 * and could not be true before:
 *
 *   1. the CALLER sees «Исходящий …»
 *   2. the CALLEE sees the same call as «Входящий …» — the record on the wire
 *      carries no direction, each side derives its own
 *   3. it is still there after a reload, on both sides
 *
 * Each is preceded by a positive assertion on the live path (the call itself
 * rings and connects), so "no line" can never be read out of a dead stand.
 */
const CALL_CONTEXT = {
  permissions: [
    "clipboard-read",
    "clipboard-write",
    "notifications",
    "microphone",
    "camera",
  ],
  viewport: { width: 390, height: 844 },
};

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test.describe.serial("friend chat: a finished call is recorded in the conversation", () => {
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
    await ensureFriends(pageA, pageB);
    await openFirstFriendChat(pageA);
    await openFirstFriendChat(pageB);
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
  });

  /**
   * Counted, not matched by text: the records PERSIST now, so a thread carries
   * every call these two seeded accounts ever made — including previous runs of
   * this very suite. Asserting a line "is visible" hits Playwright's strict mode
   * on the pile of identical ones; what this spec actually claims is that the
   * call just made ADDED one, and that a reload does not take it away.
   */
  const outgoing = () => pageA.getByText(/Исходящий аудиозвонок/);
  const incoming = () => pageB.getByText(/Входящий аудиозвонок/);
  let outgoingAfterCall = 0;
  let incomingAfterCall = 0;

  test("A calls B, B accepts, A hangs up — each side gets its own direction", async () => {
    const outgoingBefore = await outgoing().count();
    const incomingBefore = await incoming().count();

    // LIVENESS: the call has to actually happen before its record means anything.
    await pageA.getByLabel("Аудиозвонок").click();
    await expect(pageA.getByLabel("Завершить звонок")).toBeVisible({ timeout: 15_000 });
    const accept = pageB.getByLabel("Принять звонок");
    await expect(accept).toBeVisible({ timeout: 20_000 });
    await accept.click();
    await expect(pageB.getByLabel("Завершить звонок")).toBeVisible({ timeout: 15_000 });

    await pageA.getByLabel("Завершить звонок").click();
    await expect(pageA.getByLabel("Завершить звонок")).toBeHidden({ timeout: 15_000 });
    await expect(pageB.getByLabel("Завершить звонок")).toBeHidden({ timeout: 15_000 });

    await expect.poll(() => outgoing().count(), { timeout: 20_000 }).toBe(outgoingBefore + 1);
    // The half that no purely local system line could ever produce: the callee
    // gets the same call, named from THEIR side.
    await expect.poll(() => incoming().count(), { timeout: 20_000 }).toBe(incomingBefore + 1);
    outgoingAfterCall = outgoingBefore + 1;
    incomingAfterCall = incomingBefore + 1;
  });

  test("both sides still have it after a reload", async () => {
    expect(outgoingAfterCall, "the call test must have run first").toBeGreaterThan(0);
    for (const page of [pageA, pageB]) {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Чаты" })).toBeVisible({ timeout: 45_000 });
      await openFirstFriendChat(page);
    }
    await expect.poll(() => outgoing().count(), { timeout: 30_000 }).toBe(outgoingAfterCall);
    await expect.poll(() => incoming().count(), { timeout: 30_000 }).toBe(incomingAfterCall);
  });
});
