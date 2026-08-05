import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { skipUnlessReal, loginReal, ensureFriends, openFirstFriendChat } from "./helpers";

skipUnlessReal(test);

/**
 * Real 2-user WebRTC calling (Wave-2 #80/#81): ring → accept → hangup, for
 * both audio and video, between the two seeded accounts. Own file (separate
 * from the other friend-chat specs) because it needs its own fake-media
 * launch args and is slow/flaky enough to want isolated retries without
 * dragging the rest of the suite down with it.
 *
 * What this DOES assert (deterministic, no real network/ICE needed):
 *   - the caller's outgoing CallScreen mounts immediately on click
 *   - the callee's IncomingCall ringer mounts once the `call:offer` WS frame
 *     arrives, with the right peer name + media-kind label
 *   - accepting mounts CallScreen on the callee's side too
 *   - hanging up tears the overlay down on BOTH sides (`call:hangup` frame)
 *
 * What it does NOT assert: that the two peer connections actually reach
 * "connected" (real ICE/STUN negotiation — see `stun.l.google.com` in
 * lib/tinode.ts's RTC_CONFIG). Two headless Chromium instances on the same
 * host usually connect via a host ICE candidate even with no internet route,
 * but that's an infra assumption, not a UI contract — TODO(QA): if a future
 * pass wants to assert actual audio/video flowing, drive it through
 * `getStats()` on the RTCPeerConnection rather than the UI, since the DOM
 * gives no visible signal for "media is flowing" beyond the timer starting.
 */
test.use({
  permissions: [
    "clipboard-read",
    "clipboard-write",
    "notifications",
    "microphone",
    "camera",
  ],
  launchOptions: {
    // --use-fake-device-for-media-stream only supplies fake devices; the flag
    // that auto-accepts the permission prompt is --use-fake-ui-for-media-STREAM.
    // (`--use-fake-ui-for-media-permissions` is not a Chromium flag at all.)
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

/**
 * `test.use({ permissions })` above only configures the `context` FIXTURE.
 * These specs build their own contexts with `browser.newContext()`, which
 * inherits none of it — without granting mic/camera here getUserMedia rejects,
 * CallScreen bails before sending `call:offer`, and the callee never rings.
 * The explicit viewport keeps those contexts inside the 390×844 phone frame.
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

test.describe.serial("friend chat: audio + video calls", () => {
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

  test("audio call: ring, accept, hang up", async () => {
    await pageA.getByLabel("Аудиозвонок").click();
    await expect(pageA.getByLabel("Завершить звонок")).toBeVisible({ timeout: 10_000 });

    const incomingAccept = pageB.getByLabel("Принять звонок");
    await expect(incomingAccept).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText("Входящий аудио-звонок")).toBeVisible();
    await incomingAccept.click();

    await expect(pageB.getByLabel("Завершить звонок")).toBeVisible({ timeout: 10_000 });

    await pageA.getByLabel("Завершить звонок").click();
    await expect(pageA.getByLabel("Завершить звонок")).toBeHidden({ timeout: 10_000 });
    await expect(pageB.getByLabel("Завершить звонок")).toBeHidden({ timeout: 10_000 });
  });

  test("video call: ring, accept, hang up (from the callee side this time)", async () => {
    await pageB.getByLabel("Видеозвонок").click();
    await expect(pageB.getByLabel("Завершить звонок")).toBeVisible({ timeout: 10_000 });

    const incomingAccept = pageA.getByLabel("Принять звонок");
    await expect(incomingAccept).toBeVisible({ timeout: 15_000 });
    await expect(pageA.getByText("Входящий видео-звонок")).toBeVisible();
    await incomingAccept.click();

    await expect(pageA.getByLabel("Завершить звонок")).toBeVisible({ timeout: 10_000 });

    // Callee hangs up this time — same teardown contract either direction.
    await pageA.getByLabel("Завершить звонок").click();
    await expect(pageA.getByLabel("Завершить звонок")).toBeHidden({ timeout: 10_000 });
    await expect(pageB.getByLabel("Завершить звонок")).toBeHidden({ timeout: 10_000 });
  });

  test("declining an incoming call tears down the caller's screen too", async () => {
    await pageA.getByLabel("Аудиозвонок").click();
    await expect(pageA.getByLabel("Завершить звонок")).toBeVisible({ timeout: 10_000 });

    const decline = pageB.getByLabel("Отклонить звонок");
    await expect(decline).toBeVisible({ timeout: 15_000 });
    await decline.click();

    await expect(pageB.getByLabel("Отклонить звонок")).toBeHidden();
    await expect(pageA.getByLabel("Завершить звонок")).toBeHidden({ timeout: 10_000 });
  });
});
