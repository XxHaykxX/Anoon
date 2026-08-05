import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import {
  skipUnlessReal,
  loginReal,
  ensureFriends,
  openFirstFriendChat,
  TINY_JPEG_BUFFER,
  STUB_MP4_BUFFER,
} from "./helpers";

skipUnlessReal(test);

/**
 * Photo/video/voice attachments in the friend chat (Wave-2 #76-78: LargeFileHelper
 * upload, ChatMediaBubble/VoiceRecorder, wired into AnoonPrivateChat).
 *
 * Deliberately bypasses AttachMenu's visible "Фото"/"Видео" tiles: they just
 * call `photoInputRef.current?.click()` on a HIDDEN native `<input type=file>`,
 * and Playwright's `setInputFiles` can target that hidden input directly —
 * same onChange handler, no OS-native file-picker dialog to fight.
 */
test.use({
  permissions: ["clipboard-read", "clipboard-write", "notifications", "microphone"],
  // --use-fake-ui-for-media-STREAM is the flag that auto-accepts the permission
  // prompt; `--use-fake-ui-for-media-permissions` is not a Chromium flag.
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

/**
 * `test.use({ permissions })` only configures the `context` FIXTURE — the
 * contexts built below with `browser.newContext()` inherit none of it, so the
 * mic must be granted here or the voice-message test's getUserMedia rejects.
 * The explicit viewport keeps them inside the 390×844 phone frame.
 */
const MEDIA_CONTEXT = {
  permissions: ["clipboard-read", "clipboard-write", "notifications", "microphone"],
  viewport: { width: 390, height: 844 },
};

test.describe.serial("friend chat: photo, video, voice attachments", () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser }) => {
    contextA = await browser.newContext(MEDIA_CONTEXT);
    contextB = await browser.newContext(MEDIA_CONTEXT);
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

  test("photo attachment renders on both sides", async () => {
    await pageA
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({ name: "e2e-photo.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG_BUFFER });

    const bubbleA = pageA.getByRole("button", { name: "Открыть изображение" }).last();
    const bubbleB = pageB.getByRole("button", { name: "Открыть изображение" }).last();
    await expect(bubbleA).toBeVisible({ timeout: 15_000 });
    await expect(bubbleB).toBeVisible({ timeout: 15_000 });

    // Downloadability: the underlying <img> resolves to a real, loadable src
    // (authedFileUrl'd Tinode file ref) rather than erroring into ChatMediaBubble's
    // "не удалось загрузить" broken-note fallback.
    await expect(pageB.getByText("не удалось загрузить")).toBeHidden();
    const img = bubbleB.locator("img");
    await expect(img).toHaveJSProperty("complete", true, { timeout: 15_000 });
    await expect(img).not.toHaveJSProperty("naturalWidth", 0);
  });

  test("video attachment renders on both sides", async () => {
    await pageB
      .locator('input[type="file"][accept="video/*"]')
      .setInputFiles({ name: "e2e-clip.mp4", mimeType: "video/mp4", buffer: STUB_MP4_BUFFER });

    await expect(pageB.locator("video").last()).toBeVisible({ timeout: 15_000 });
    await expect(pageA.locator("video").last()).toBeVisible({ timeout: 15_000 });
  });

  test("voice message renders on both sides", async () => {
    await pageA.getByRole("button", { name: "Записать голосовое сообщение" }).click();
    await pageA.waitForTimeout(1200);
    await pageA.getByRole("button", { name: "Отправить голосовое сообщение" }).click();

    // Assert the WAVEFORM bubble, not the <audio> element: VoiceMessage renders
    // `<audio className="hidden">` and Chromium's UA sheet also hides
    // `audio:not([controls])`, so `locator("audio")` can never be visible — it
    // measured 0×0 with display:none even on a fully loaded track. The custom
    // bubble around it is the actual UI.
    await expect(pageA.getByTestId("chat-voice").last()).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByTestId("chat-voice").last()).toBeVisible({ timeout: 15_000 });
    // …and that the track really resolved, asserted on the hidden element.
    // Do NOT assert readyState === 4: `preload="metadata"` only guarantees
    // HAVE_METADATA (1). Chromium over-fetches short clips today, so 4 passes
    // by accident — a longer recording or a stricter build would flake.
    // `error === null` + a readyState past NOTHING are what preload does promise.
    const audioB = pageB.locator("audio").last();
    await expect(audioB).toHaveJSProperty("error", null);
    await expect
      .poll(() => audioB.evaluate((a) => (a as HTMLAudioElement).readyState))
      .toBeGreaterThan(0);
  });

  test.skip(
    "TODO(QA): explicit \"download\" affordance for file attachments",
    async () => {
      // ChatMediaBubble's generic "file" kind renders an <a download> link,
      // but AnoonPrivateChat's real-mode AttachMenu only offers "Фото"/"Video"
      // (file/location/contact/poll/music/gif were product-cut per its own
      // comment) — there's no UI path to attach a generic file in the friend
      // chat to exercise that download link from. If a future pass adds a
      // file-attach option, this is where to drive `getAttribute("download")`
      // + a real click-through instead of trusting the anchor exists.
    },
  );
});
