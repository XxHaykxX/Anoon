import { expect, type Page } from "@playwright/test";
import {
  gotoAnoon,
  expectHome,
  expectChats,
  switchTab,
  AGE_18_21,
  attachErrorGuard,
  assertNoErrors,
  type ErrorGuard,
} from "../helpers";

/**
 * Shared infra for the **real 2-user** e2e suite (Wave-2 QA-3 #106).
 *
 * Unlike the rest of tests/e2e (mock mode, no backend — see ../helpers.ts),
 * every spec under this directory needs a LIVE stack:
 *
 *   1. The self-hosted Tinode server (server-stack/, anoon-tinode, :6061/gRPC 16061)
 *   2. The companion service (:6062)
 *   3. The Next.js dev server built with real mode on:
 *        NEXT_PUBLIC_USE_TINODE=1 npm run dev
 *
 * Then run just this directory:
 *   E2E_REAL=1 BASE_URL=http://localhost:3001 npx playwright test tests/e2e/real
 *
 * `E2E_REAL` is a separate gate from the dev-server env var — the suite has no
 * way to introspect what the *server* was built with, so every file here calls
 * {@link skipUnlessReal} up front and turns into a no-op (not a failure) when
 * the flag is absent, e.g. during a plain `npm run test:e2e` run.
 *
 * Uses two FIXED seeded accounts rather than dynamic registration:
 * admin1/admin1 (#00011, male) and admin2/admin2 (#00012, female). Since these
 * are persistent (a suite run doesn't create fresh ones each time), every
 * setup step here is written to be idempotent — see {@link ensureFriends} —
 * so re-running the suite against a backend that already has them friended
 * doesn't fail on "already exists" states.
 */

export const E2E_REAL = process.env.E2E_REAL === "1";

/** Call at the top of every real-mode spec file (module scope, before `test(...)`). */
export function skipUnlessReal(test: { skip: (cond: boolean, reason: string) => void }): void {
  test.skip(
    !E2E_REAL,
    "Real 2-user suite requires a live companion+Tinode backend and a dev server " +
      "built with NEXT_PUBLIC_USE_TINODE=1 — set E2E_REAL=1 to run (see helpers.ts header).",
  );
}

/** The two seeded accounts every real/ spec logs into. */
export const ACCOUNTS = {
  a: { login: "admin1", password: "admin1", hashId: "00011", gender: "male" as const },
  b: { login: "admin2", password: "admin2", hashId: "00012", gender: "female" as const },
};

/**
 * Log into an existing seeded account through the actual login form (real
 * `signInWithBasic({isNew:false})`, see AnoonLogin.tsx). Tinode's basic scheme
 * accepts a bare username (AnoonLogin's `emailValid` regex allows `[a-z0-9_.-]{3,}`
 * alongside real emails), so "admin1"/"admin2" go straight into the email field.
 */
export async function loginReal(page: Page, who: keyof typeof ACCOUNTS): Promise<void> {
  const acc = ACCOUNTS[who];
  await gotoAnoon(page);
  // «Пропустить» is the shortest path to the login screen; the onboarding CTA
  // reaches the same place after the carousel.
  await page.getByRole("button", { name: "Пропустить" }).click();
  await page.getByPlaceholder("Почта или ник").fill(acc.login);
  await page.getByPlaceholder("Пароль").fill(acc.password);
  const submit = page.getByRole("button", { name: "Войти", exact: true });
  await expect(submit).toBeEnabled();
  await submit.click();

  // Generous timeout — round-trips companion + Tinode auth for real.
  // BUG-24 made «Чаты» (not Home) the post-login landing screen — AnoonLogin.tsx's
  // real branch calls `nav.go("friends")` after signInWithBasic resolves.
  await expect(page.getByRole("heading", { name: "Чаты" })).toBeVisible({ timeout: 20_000 });
}

/**
 * Read the signed-in account's own #ID from the Profile tab (the `#00042`
 * style hash id AnoonProfile.tsx renders read-only next to the «#ID» label).
 * Selector is anchored on the `font-mono` id paragraph — there's no
 * data-testid yet; if AnoonProfile.tsx's markup changes, prefer adding one
 * over patching this selector further.
 */
export async function getMyHashId(page: Page): Promise<string> {
  await switchTab(page, "Профиль");
  const idText = await page.locator("p.font-mono").first().innerText();
  return idText.replace(/^#/, "").trim();
}

/**
 * Make sure `pageA` and `pageB` (admin1/admin2) are friends, pairing them via
 * roulette + reveal only if they aren't already. Idempotent on purpose:
 * these are fixed seeded accounts, so a second suite run against the same
 * backend must not fail just because a prior run already friended them.
 *
 * KNOWN BACKEND/FRONTEND CONTRACT BUG (reported, NOT fixed here — out of
 * tests/e2e scope): `CompanionClient.friendsSearch` (src/lib/companion.ts:371)
 * types + returns `this.request<FriendSearchResult[]>(...)` — i.e. it expects
 * `GET /friends/search?q=` to resolve to a bare array. The live companion at
 * :8088 instead returns `{"results": [...]}` (confirmed via network capture:
 * `GET /friends/search?q=00012` → `200 {"results":[{"displayName":"#00012","hashId":"#00012"}]}`
 * for every query tried — "00012", "#00012", "12", "admin2", "Admin2" all hit
 * the correct single match server-side). Casting that object straight to
 * `FriendSearchResult[]` means AnoonFriendSearch.tsx's `rows.map(resultToPerson)`
 * throws (`rows.map is not a function`) as an unhandled rejection, `realResults`
 * never updates, and the UI shows "Ничего не найдено" for every query — the
 * friend-search screen is completely non-functional against this backend.
 * (Secondary, lower-severity: even unwrapped, the result objects are also
 * missing `avatarTone`/`relation` that `FriendSearchResult` expects — degrades
 * gracefully to "Добавить" but the contract should carry them.)
 *
 * Until that's fixed, this helper uses the roulette+reveal path instead (the
 * same mechanism reveal.spec.ts exercises directly), which the team
 * independently verified works end-to-end.
 */
export async function ensureFriends(pageA: Page, pageB: Page): Promise<void> {
  // Fast path: this suite only ever pairs these same two accounts, so any
  // existing friend row is assumed to be each other.
  await switchTab(pageA, "Чаты");
  const hasFriend = await pageA
    .locator(".anoon-cv-row")
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);
  if (hasFriend) return;

  await switchTab(pageA, "Рулетка");
  await switchTab(pageB, "Рулетка");
  // BUG-21 removed the own-age gate — «Начать чат» is enabled immediately, no
  // age chip to pick first. NOTE: this also means matchmaking's own-age bucket
  // is now whatever each seeded account's real profile age resolves to (see
  // ageRangeFor() in AnoonHome.tsx), not a bucket both sides could force to
  // match by clicking the same chip — if admin1/admin2 land in different
  // buckets, this queue join may pair slower or with a third party instead of
  // each other. Flagged, not fixed here (matchmaking bucket logic is out of
  // e2e-helper scope); reveal.spec.ts has the same dependency.
  for (const page of [pageA, pageB]) {
    await page.getByRole("button", { name: "Начать чат" }).click();
  }
  // Real matchmaking round-trip — generous timeout for queue processing.
  await expect(pageA.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });
  await expect(pageB.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 60_000 });

  await pageA.getByRole("button", { name: "Раскрыть", exact: true }).click();
  await expect(pageB.getByText("Собеседник хочет открыть профиль")).toBeVisible({ timeout: 15_000 });
  await pageB.getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(pageA.getByText("Профили открыты — вы теперь друзья").first()).toBeVisible({ timeout: 15_000 });
  await expect(pageB.getByText("Профили открыты — вы теперь друзья").first()).toBeVisible();

  // Leave the (now-revealed) anon chat back to Home so callers land somewhere
  // predictable — every real/ spec's next step is its own switchTab anyway.
  await pageA.getByRole("button", { name: "Назад" }).click();
  await pageB.getByRole("button", { name: "Назад" }).click();
}

/**
 * From the Friends tab, open the (only) friend's private chat by row order.
 *
 * STALE NOTE, CORRECTED 2026-08-06: this used to warn that `page.reload()`
 * silently logs the page out, because the session lived only in an in-memory
 * zustand store. It is persisted now — a Tinode auth token under localStorage
 * `anoon:session` — and a reload comes back signed in (verified live, and
 * asserted by persistence-and-viewer.spec.ts, which reloads on purpose). What
 * a reload does still cost is time: re-auth plus a re-subscribe, so wait for
 * real content afterwards rather than assuming the screen is ready.
 *
 * Waits for the composer as proof the chat actually subscribed, not just that
 * the row was clickable.
 */
/**
 * Land on whichever tab currently holds the friend rows and return their
 * locator.
 *
 * BUG-36 split the old single tab in two: «Чаты» lists only ACTIVE
 * conversations, «Контакты» is the full contact list. A friend whose chat was
 * never opened — or whose match was ended by an earlier spec — has no row under
 * «Чаты» at all, which made every caller here time out on `.anoon-cv-row`.
 * Try «Чаты» first (cheapest, and it is the post-login landing screen), fall
 * back to «Контакты».
 */
async function friendRows(page: Page) {
  await switchTab(page, "Чаты");
  const rows = page.locator(".anoon-cv-row");
  if (await rows.first().isVisible({ timeout: 3_000 }).catch(() => false)) return rows;
  await switchTab(page, "Контакты");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  return rows;
}

export async function openFirstFriendChat(page: Page): Promise<void> {
  const rows = await friendRows(page);
  await rows.first().click();
  await expect(page.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 15_000 });
}

/**
 * Read the (only) friend row's Tinode p2p topic straight off the DOM's
 * `data-topic` attribute (AnoonFriends.tsx renders it on every `.anoon-cv-row`
 * — see line "data-topic={f.topic}"). Reading it directly is simpler and no
 * less faithful to the real contract than sniffing the `{sub topic:...}` WS
 * frame that put it there: the attribute IS the app's own record of which
 * topic the row opens, so asserting through it exercises the same contract.
 */
export async function getFirstFriendTopic(page: Page): Promise<string> {
  const rows = await friendRows(page);
  const topic = await rows.first().getAttribute("data-topic");
  if (!topic) throw new Error("friend row has no data-topic attribute");
  return topic;
}

/**
 * Re-open a friend chat by its exact p2p topic (rather than row order) —
 * proves the row → chat wiring is keyed on the real topic, not just "whichever
 * row is first". Same composer-visible wait as {@link openFirstFriendChat}.
 */
export async function openFriendChatByTopic(page: Page, topic: string): Promise<void> {
  await friendRows(page);
  await page.locator(`.anoon-cv-row[data-topic="${topic}"]`).click();
  await expect(page.getByPlaceholder("Сообщение")).toBeVisible({ timeout: 15_000 });
}

/**
 * Leave an open friend chat back to the Friends list. AnoonPrivateChat's own
 * back chevron (unlike the friend-search/friend-requests shell bar, or the
 * call buttons right next to it) has no `aria-label` — see AnoonPrivateChat.tsx's
 * bare `<ChevronLeftIcon onClick=.../>` — so there's no accessible name to hook
 * a `getByRole` off yet (tracked as pending accessibility sweep #118). Until
 * that lands, scope to the header row and take its first `<svg>`: ChevronLeftIcon
 * is the first element in that row's DOM order, before the avatar/name and
 * before the (button-wrapped, so not a direct svg match at this scope) call
 * icons.
 */
export async function closeFriendChat(page: Page): Promise<void> {
  await page.locator(".border-b.border-border").first().locator("svg").first().click();
  await expect(page.getByPlaceholder("Сообщение")).toBeHidden({ timeout: 10_000 });
}

/**
 * A real, valid 1×1 red-pixel JPEG — small enough to inline as base64, but
 * genuine bytes (not a stub), so the upload path and `<img>` render exercise
 * real decode/display rather than just a "some bytes went through" check.
 */
export const TINY_JPEG_BUFFER = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64",
);

/**
 * Not a decodable video — the app never validates bytes client- or
 * server-side (Tinode's large-file endpoint stores whatever it's given), so
 * this only needs to exercise the upload → `<video src>` render path, not
 * actual playback. `setInputFiles({..., buffer})` accepts it without a file
 * on disk.
 */
export const STUB_MP4_BUFFER = Buffer.from("stub-mp4-bytes-for-e2e");

export { AGE_18_21, expectHome, expectChats, switchTab, attachErrorGuard, assertNoErrors };
export type { ErrorGuard };
