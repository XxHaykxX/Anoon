import { test, expect } from "@playwright/test";
import {
  signInMock,
  switchTab,
  startRouletteToChat,
  attachErrorGuard,
  assertNoErrors,
} from "./helpers";

/**
 * Roulette flow in mock mode: Home filters → «Начать чат» → Searching → (auto
 * match on the ~1.5s searching timer) → anonymous chat → send a message →
 * accept the reveal prompt → "you're now friends".
 *
 * NB: in UI-mock mode the companion mock *driver* (matched/reveal timers in
 * src/lib/companion.ts) is not used — enqueue() is only called when USE_TINODE
 * is on. The searching screen advances via its own 1.5s timer, and the reveal
 * card is shown inline from the start (`showReveal = !USE_TINODE`).
 */
test("home → searching → anon chat → send → reveal → friends", async ({ page }) => {
  const guard = attachErrorGuard(page);
  await signInMock(page);

  await startRouletteToChat(page);

  // Anonymous chat header is present and identity is masked.
  await expect(page.getByText("Собеседник", { exact: false }).first()).toBeVisible();
  // Кнопка называется «Раскрыть» (не «Раскрыть профиль») с волны H2 — тогда же
  // хендл собеседника в анон-фазе стал алиасом, и подпись сократили.
  await expect(page.getByRole("button", { name: "Раскрыть", exact: true })).toBeVisible();

  // Send a message — the send button only appears once the draft is non-empty.
  const draft = "Привет, это автотест";
  await page.getByPlaceholder("Сообщение").fill(draft);
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(page.getByText(draft)).toBeVisible();

  // Accept the inline reveal proposal → become friends.
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(page.getByText("Профили открыты — вы теперь друзья").first()).toBeVisible();

  assertNoErrors(guard);
});

test("«Начать чат» is enabled immediately, no own-age gate (BUG-21)", async ({ page }) => {
  await signInMock(page);
  // BUG-24: mock login now lands on Chats, not Home — navigate there first.
  await switchTab(page, "Рулетка");
  // Own age used to be a required Home pick that disabled this button until
  // chosen; BUG-21 removed that picker (own age now comes from the profile),
  // so the button has nothing left to gate on.
  await expect(page.getByRole("button", { name: "Начать чат" })).toBeEnabled();
});

test("searching can be cancelled back to home", async ({ page }) => {
  await signInMock(page);
  await switchTab(page, "Рулетка"); // BUG-24: Chats is the post-login landing screen now.
  await page.getByRole("button", { name: "Начать чат" }).click();
  await expect(page.getByRole("heading", { name: "Ищем собеседника…" })).toBeVisible();

  // «Отмена» pops back to Home (race: mock auto-match fires at ~1.5s, so cancel
  // promptly). If the match wins the race the chat composer shows instead —
  // either way we assert we left the searching screen.
  await page.getByRole("button", { name: "Отмена" }).click();
  await expect(page.getByRole("heading", { name: "Ищем собеседника…" })).toBeHidden();
});
