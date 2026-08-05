import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { skipUnlessReal, loginReal, ensureFriends, TINY_JPEG_BUFFER, switchTab } from "./helpers";

skipUnlessReal(test);

/**
 * Avatar photo upload + render everywhere (Wave-2 #87 AV-1): Profile's own
 * header, and the friend's photo replacing the gradient-initials placeholder
 * in AnoonFriends' list and AnoonHome's own card.
 */
test.describe.serial("avatar upload + render in profile and friends", () => {
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
    await ensureFriends(pageA, pageB);
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
  });

  test("uploading a photo replaces A's own gradient placeholder in Profile", async () => {
    await switchTab(pageA, "Профиль");
    await pageA
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({ name: "e2e-avatar.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG_BUFFER });

    // Local blob preview shows immediately; "Загрузка…" clears once setAvatar's
    // real upload resolves and the persisted-ref <img> takes over.
    await expect(pageA.getByText("Загрузка…")).toBeHidden({ timeout: 15_000 });
    // Profile's header avatar becomes a real <img> once avatarRef is set —
    // scoped to the top avatar block, not any other image on the page.
    await expect(pageA.locator("div.flex.flex-col.items-center.gap-3 img").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("home's own card shows the uploaded photo too", async () => {
    await switchTab(pageA, "Рулетка");
    await expect(pageA.locator("img").first()).toBeVisible({ timeout: 10_000 });
  });

  test("B's friend-list row for A shows the real photo, not initials", async () => {
    // NOTE: no page.reload() here — session/auth lives in an in-memory
    // zustand store with no persistence, so reloading silently logs the page
    // out back to onboarding instead of just refetching contacts (confirmed
    // by an earlier run of this suite). AnoonFriends' FriendAvatar reads
    // avatarRefFor(friend.topic) live off the Tinode SDK's cached contact,
    // which updates the moment the `me`-topic gets A's desc-change push —
    // no client action needed, just enough time for the WS event to land.
    await switchTab(pageB, "Чаты");
    const row = pageB.locator(".anoon-cv-row").first();
    await expect(row.locator("img")).toBeVisible({ timeout: 20_000 });
  });
});
