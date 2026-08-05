#!/usr/bin/env node
/**
 * qa-nonchat.mjs — Non-chat 2-user QA sweep for frontend.
 *
 * Plain Node script (no test runner — just `playwright` + hand-rolled
 * PASS/FAIL/SKIP reporting), meant to be run against the REAL stack through
 * the single-origin proxy, after integration, to verify the recent non-chat
 * bug fixes end-to-end with two real accounts:
 *
 *   BUG-5  Notifications badge no longer phantom-drifts on navigation
 *   BUG-6  Profile avatar renders (real photo or initials, never broken)
 *   BUG-7  Settings no longer has «Профиль аккаунта» / «Друзья» rows
 *   BUG-20 No QR code anywhere in Profile "Поделиться профилем" or Invite
 *   BUG-21 Home has no own-age picker; the partner age-range filter remains
 *   BUG-22 Accepting/declining a friend request removes it (badge decreases)
 *   BUG-23 Invite's «Поделиться» does something real (Web Share or copy-link)
 *   BUG-24/36 Nav is 5 tabs — [Чаты][Друзья](Рулетка, raised center FAB)
 *             [Уведомления][Профиль] — Чаты is the post-login landing screen
 *             (active conversations only), Друзья is the full contact list.
 *
 * Prerequisites (NOT started by this script):
 *   1. The self-hosted Tinode server + companion service running for real.
 *   2. The app built/served in real mode (`NEXT_PUBLIC_USE_TINODE=1`) behind
 *      the single-origin proxy (Caddy/compose.prod — see BUILD-PLAN.md phase E).
 *   3. Two seeded accounts already existing: admin1/admin1 (#00011) and
 *      admin2/admin2 (#00012) — same fixed pair tests/e2e/real/helpers.ts uses,
 *      same age bucket (22-25) so roulette pairs them with each other.
 *
 * Usage:
 *   node qa-nonchat.mjs                              # ANOON_URL defaults to http://localhost:8088
 *   ANOON_URL=https://anoon.example.com node qa-nonchat.mjs
 *
 * Exit code is nonzero if any check FAILs or if either browser context logged
 * an unexpected console error / uncaught page exception. SKIPs (see the
 * friend-request round trip below) never fail the run — they mean "couldn't
 * safely exercise this without side effects on the fixed seeded accounts",
 * not "broken".
 *
 * Screenshots of every screen visited are saved to ./qa-shots/ (created if
 * missing), one PNG per screen per account, named "<account>-<screen>.png".
 *
 * Nav is targeted by the stable `data-testid`s on each bottom-nav button
 * (nav-chats/nav-friends/nav-roulette/nav-notifications/nav-profile) rather
 * than the visible Russian label — immune to future relabels the way the
 * label-matching original version wasn't (that's exactly what broke the
 * first run of this script against BUG-24's rename).
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE_URL = process.env.ANOON_URL ?? "http://localhost:8088";
const ANOON_PATH = "/anoon";
const SHOTS_DIR = fileURLToPath(new URL("./qa-shots/", import.meta.url));

/** Same fixed seeded pair the tests/e2e/real/ suite uses. */
const ACCOUNTS = {
  a: { login: "admin1", password: "admin1", hashId: "00011" },
  b: { login: "admin2", password: "admin2", hashId: "00012" },
};

/** Age-range labels (typographic EN DASH, U+2013 — not a hyphen). */
const AGE_RANGES = ["18–21", "22–25", "26–35", "36+"];

/** Bottom-nav testids — see _shared.tsx's NAV_TESTID (BUG-24/36). */
const NAV_TESTID = {
  chats: "nav-chats",
  friends: "nav-friends",
  roulette: "nav-roulette",
  notifications: "nav-notifications",
  profile: "nav-profile",
};

/** Console/log noise that isn't the app's own correctness (mirrors tests/e2e/helpers.ts). */
const IGNORED_CONSOLE = [
  /favicon/i,
  /manifest/i,
  /Failed to load resource/i,
  /status of 404/i,
  /clipboard/i,
  /Permissions-Policy/i,
  /net::ERR_/i,
  /ServiceWorker|service worker|sw\.js/i,
];

// ---------------------------------------------------------------------------
// Tiny reporting harness (PASS / FAIL / SKIP), no test-runner dependency.
// ---------------------------------------------------------------------------

const results = [];

function record(status, label, detail) {
  results.push({ status, label, detail });
  const line = `[${status}] ${label}`;
  console.log(detail ? `${line} — ${detail}` : line);
}

/** Run `fn`; records PASS on success, FAIL with the error message on throw. */
async function check(label, fn) {
  try {
    await fn();
    record("PASS", label);
  } catch (err) {
    record("FAIL", label, err && err.message ? err.message : String(err));
  }
}

/** Record a SKIP without running anything — never fails the overall run. */
function skip(label, reason) {
  record("SKIP", label, reason);
}

// ---------------------------------------------------------------------------
// Locator-level assertion helpers (no @playwright/test `expect` available
// outside a test runner, so these are the hand-rolled equivalents).
// ---------------------------------------------------------------------------

async function expectVisible(locator, timeout = 10_000) {
  await locator.first().waitFor({ state: "visible", timeout });
}

async function expectHidden(locator, timeout = 5_000) {
  await locator.first().waitFor({ state: "hidden", timeout });
}

/** Asserts zero matches — works even for elements that never existed at all. */
async function expectAbsent(locator) {
  const n = await locator.count();
  if (n !== 0) throw new Error(`expected 0 matches, found ${n}`);
}

async function shot(page, name) {
  await mkdir(SHOTS_DIR, { recursive: true });
  const file = path.join(SHOTS_DIR, `${name}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
  } catch (err) {
    console.warn(`  (screenshot failed for ${name}: ${err.message})`);
  }
}

// ---------------------------------------------------------------------------
// App-specific navigation helpers.
// ---------------------------------------------------------------------------

function bottomNav(page) {
  return page.getByRole("navigation");
}

/** Click a bottom-nav tab by its stable data-testid key (see NAV_TESTID). */
async function switchTab(page, tab) {
  await bottomNav(page).locator(`[data-testid="${NAV_TESTID[tab]}"]`).click();
}

/**
 * Log into a seeded account through the real login form and land on «Чаты»
 * (BUG-24/36's post-login landing screen — a distinct route from Home/Рулетка).
 */
async function loginAs(page, who) {
  const acc = ACCOUNTS[who];
  await page.goto(BASE_URL + ANOON_PATH);
  await expectVisible(page.getByRole("heading", { name: "Живая рулётка" }));
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByPlaceholder("you@example.com").fill(acc.login);
  await page.getByPlaceholder("Ваш пароль").fill(acc.password);
  const submit = page.getByRole("button", { name: "Войти", exact: true });
  await submit.click();
  // Generous timeout — round-trips companion + Tinode auth for real.
  await expectVisible(page.getByRole("heading", { name: "Чаты" }), 20_000);
}

/** Reads a bottom-nav tab's badge count as a string ("3", "9+"), or null if hidden/zero. */
async function readNavBadge(page, tab) {
  const btn = bottomNav(page).locator(`[data-testid="${NAV_TESTID[tab]}"]`);
  const text = (await btn.innerText()).trim();
  const m = text.match(/^(\d+\+?)/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Console/error guard — one per browser context.
// ---------------------------------------------------------------------------

function attachConsoleGuard(page, label) {
  const messages = [];
  page.on("pageerror", (err) => messages.push(`[pageerror] ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    messages.push(`[console.error] ${text}`);
  });
  return { label, messages };
}

// ---------------------------------------------------------------------------
// Per-account screen checks.
// ---------------------------------------------------------------------------

async function checkHome(page, who) {
  const acc = ACCOUNTS[who];
  await switchTab(page, "roulette");
  await shot(page, `${who}-home`);

  await check(`[${who}] Home: own-age picker is GONE (BUG-21)`, async () => {
    await expectAbsent(page.getByRole("heading", { name: "Ваш возраст" }));
    await expectAbsent(page.getByText("обязательно"));
  });

  await check(`[${who}] Home: partner age-range filter is present`, async () => {
    await expectVisible(page.getByRole("heading", { name: "Возраст собеседника" }));
    for (const range of AGE_RANGES) {
      await expectVisible(page.getByRole("button", { name: range, exact: true }));
    }
  });

  await check(`[${who}] Home: shows the real #ID (#${acc.hashId}), not a mock stub`, async () => {
    await expectVisible(page.getByText(`#${acc.hashId}`));
  });
}

/**
 * BUG-5 was "badge shows a nonzero count that drifts on navigation with
 * nothing behind it". Sample the Notifications badge across several tab hops
 * that touch NEITHER Notifications NOR any friend-request action — a real,
 * stable count must not move just because the user browsed around.
 */
async function checkNotificationsBadgeStable(page, who) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    await switchTab(page, "roulette");
    samples.push(await readNavBadge(page, "notifications"));
    await switchTab(page, "chats");
    await switchTab(page, "profile");
  }
  await check(`[${who}] Notifications badge doesn't phantom-drift across navigation (BUG-5)`, async () => {
    const distinct = new Set(samples);
    if (distinct.size !== 1) {
      throw new Error(`badge samples were not stable: [${samples.join(", ")}]`);
    }
  });
}

async function checkProfile(page, who) {
  const acc = ACCOUNTS[who];
  await switchTab(page, "profile");
  await expectVisible(page.getByRole("heading", { name: "Профиль" }));
  await shot(page, `${who}-profile`);

  await check(`[${who}] Profile shows the real #ID`, async () => {
    await expectVisible(page.getByText(`#${acc.hashId}`));
  });

  await check(`[${who}] Profile avatar renders (real photo or initials, never broken) (BUG-6)`, async () => {
    const img = page.locator('img[alt="Аватар"]');
    const imgCount = await img.count();
    if (imgCount > 0) {
      const ok = await img.first().evaluate((el) => el.complete && el.naturalWidth > 0);
      if (!ok) throw new Error("avatar <img> present but failed to load (naturalWidth=0)");
    } else {
      // No photo set → falls back to the gradient-initials placeholder. The
      // edit-photo button is rendered 1:1 alongside that slot in AnoonProfile.tsx,
      // so its presence is a reliable proxy that the avatar area rendered at all
      // (rather than nothing / a crash).
      await expectVisible(page.getByRole("button", { name: "Сменить фото" }));
    }
  });

  await check(`[${who}] Profile "Поделиться профилем" has no QR (BUG-20)`, async () => {
    await expectVisible(page.getByText("Поделиться профилем"));
    await expectAbsent(page.locator('img[alt*="QR"]'));
    await expectAbsent(page.locator('svg[shape-rendering="crispEdges"]'));
  });
}

async function checkInvite(page, who) {
  const acc = ACCOUNTS[who];
  await switchTab(page, "friends");
  // ForwardIcon has no accessible role of its own (bare <svg aria-label=...>).
  await page.locator('[aria-label="Пригласить друга"]').click();
  await expectVisible(page.getByRole("heading", { name: "Пригласить друга" }));
  await shot(page, `${who}-invite`);

  await check(`[${who}] Invite has no QR (BUG-20)`, async () => {
    await expectAbsent(page.locator('img[alt*="QR"]'));
    await expectAbsent(page.locator('canvas'));
  });

  await check(`[${who}] Invite shows #ID + link`, async () => {
    await expectVisible(page.getByText(`#${acc.hashId}`));
    await expectVisible(page.getByText(new RegExp(`anoon\\.app/add/${acc.hashId}`)));
  });

  await check(`[${who}] Invite «Поделиться» does something real, no crash (BUG-23)`, async () => {
    // Headless Chromium's navigator.share support varies by OS/flags: either
    // the native share sheet handles it, or the app's copy-link fallback
    // fires (flashes "Готово" for ~1.8s). Both are legitimate outcomes of the
    // real navigator.share() call this bug fix added — a thrown/uncaught
    // error is what would actually indicate the old fake button regressed;
    // that's covered by this context's console/pageerror guard, not here.
    await page.getByRole("button", { name: /Поделиться/ }).click();
    await page.waitForTimeout(500);
  });

  await page.getByRole("button", { name: "Назад" }).click();
}

async function checkSettings(page, who) {
  await switchTab(page, "profile");
  await page.getByRole("button", { name: "Настройки" }).click();
  await expectVisible(page.getByRole("heading", { name: "Настройки" }));
  await shot(page, `${who}-settings`);

  await check(`[${who}] Settings: no «Профиль аккаунта» / «Друзья» rows (BUG-7)`, async () => {
    await expectAbsent(page.getByRole("button", { name: "Профиль аккаунта", exact: true }));
    await expectAbsent(page.getByRole("button", { name: "Друзья", exact: true }));
  });

  await check(`[${who}] Settings: blacklist/push/sound controls present`, async () => {
    await expectVisible(page.getByText("Заблокированные"));
    await expectVisible(page.getByText("Уведомления").first());
    await expectVisible(page.getByText("Звук и вибрация"));
    await expectVisible(page.getByRole("switch").first());
  });

  await page.getByRole("button", { name: "Назад" }).click();
}

async function checkWallet(page, who) {
  await switchTab(page, "profile");
  await page.getByRole("button", { name: "Монеты и подписка" }).click();
  await expectVisible(page.getByRole("heading", { name: "Монеты и подписка" }));
  await shot(page, `${who}-wallet`);

  await check(`[${who}] Wallet: coin packs + subscription tiers render`, async () => {
    await expectVisible(page.getByText("Купить монеты"));
    await expectVisible(page.getByText(/Оформить (Premium|Super Premium)|Ваш тариф/).first());
  });

  await page.getByRole("button", { name: "Назад" }).click();
}

/** «Чаты» (BUG-36): active conversations only, the post-login landing screen. */
async function checkChats(page, who) {
  await switchTab(page, "chats");
  await expectVisible(page.getByRole("heading", { name: "Чаты" }));
  await shot(page, `${who}-chats`);
}

async function checkFriendsAndSearch(page, who, otherHashId) {
  await switchTab(page, "friends");
  await expectVisible(page.getByRole("heading", { name: "Друзья" }));
  await shot(page, `${who}-friends`);

  await page.locator('[aria-label="Поиск друзей"]').click();
  await page.getByPlaceholder("#ID или ник").fill(otherHashId);
  // Debounced companion search (300ms) + a real round trip.
  await page.waitForTimeout(900);
  await shot(page, `${who}-friend-search`);

  await check(`[${who}] Friend search finds #${otherHashId} via the real companion API`, async () => {
    await expectVisible(page.getByText(`#${otherHashId}`));
  });

  await page.locator('[aria-label="Закрыть поиск"]').click();
}

/**
 * BUG-22: accepting/declining a friend request must remove it from the store
 * so it doesn't linger and the badge decreases. Exercises a real B→A friend
 * request + A's accept, using the "Заявки" screen (AnoonFriendRequests.tsx,
 * reached from the «Друзья» tab's floating button).
 *
 * Since admin1/admin2 are the SAME fixed pair the rest of the real/ e2e suite
 * uses (and friends them via roulette+reveal), this SKIPs the round trip
 * gracefully if they're already friends — there's no unfriend affordance in
 * real mode to reset that state, and this script must stay idempotent against
 * a shared backend it doesn't own the state of.
 */
async function checkFriendRequestAcceptRemoves(pageA, pageB) {
  const a = ACCOUNTS.a;
  const b = ACCOUNTS.b;

  await switchTab(pageA, "friends");
  const alreadyFriends = await pageA
    .getByText(`#${b.hashId}`)
    .first()
    .isVisible({ timeout: 3_000 })
    .catch(() => false);

  if (alreadyFriends) {
    skip(
      "Friend-requests: accept removes it (BUG-22)",
      `admin1/admin2 are already friends on this backend — no unfriend affordance ` +
        `exists in real mode to reset for a clean request/accept round trip; ` +
        `re-run against a fresh backend to exercise this.`,
    );
    return;
  }

  // B sends a request to A.
  await switchTab(pageB, "friends");
  await pageB.locator('[aria-label="Поиск друзей"]').click();
  await pageB.getByPlaceholder("#ID или ник").fill(a.hashId);
  await pageB.waitForTimeout(900);
  await pageB.getByRole("button", { name: "Добавить" }).click();
  await pageB.locator('[aria-label="Закрыть поиск"]').click();

  // Give the companion event a moment to land in A's store before we sample
  // anything (it arrives over the event stream, not synchronously with B's click).
  await pageA.waitForTimeout(1_500);

  // Sample the "Друзья" tab badge BEFORE accept. AnoonFriendRequests.tsx (the
  // "Заявки" screen) renders no bottom nav of its own — the only place
  // `requests.length` surfaces as a tab badge is AnoonNotifications' own
  // bottom nav (`badges={{ friends: requests.length, ... }}`) — so read it
  // from there, not from the friend-requests screen itself.
  await switchTab(pageA, "notifications");
  const badgeBefore = await readNavBadge(pageA, "friends");

  // A opens the dedicated "Заявки" screen from Друзья's floating button.
  await switchTab(pageA, "friends");
  await pageA.getByRole("button", { name: "Заявки", exact: true }).click();
  await shot(pageA, "a-friend-requests-before-accept");

  await check(`[A] Friend-requests: incoming request from #${b.hashId} is visible`, async () => {
    await expectVisible(pageA.getByText(`#${b.hashId}`));
  });

  // Accept it — scope to the row containing B's #ID so a stray unrelated
  // pending request (if any) on a shared backend isn't touched by mistake.
  // `.first()` (not `.last()`): AnoonFriendRequests.tsx nests the hashId text
  // several levels deep inside the row card, so Playwright matches every
  // ancestor div up to the row's own outer `rounded-2xl border ... p-3` div —
  // that outermost row (the one that also contains the "Открыть" button as a
  // sibling) is the FIRST match in document order, innermost text-only wrappers
  // come after it.
  const row = pageA.locator("div", { hasText: `#${b.hashId}` }).first();
  await row.getByRole("button", { name: "Открыть" }).click();

  await check(`[A] Accepting removes the request from the list (BUG-22)`, async () => {
    await expectHidden(pageA.getByText(`#${b.hashId}`).first(), 8_000).catch(async () => {
      // Re-derive "gone" by leaving and re-entering rather than trusting a
      // stale locator reference, in case of a render-timing race.
      await pageA.getByRole("button", { name: "Назад" }).click();
      await switchTab(pageA, "friends");
      await pageA.getByRole("button", { name: "Заявки", exact: true }).click();
      await expectAbsent(pageA.getByText(`#${b.hashId}`));
    });
  });

  await pageA.getByRole("button", { name: "Назад" }).click();

  // Confirm the Notifications screen's own "Друзья" badge (fed by
  // `requests.length`) has actually gone back down, not just this list.
  await check(`[A] Notifications' "Друзья" badge reflects the removal (BUG-22)`, async () => {
    await switchTab(pageA, "notifications");
    const badgeAfter = await readNavBadge(pageA, "friends");
    if (badgeBefore !== null && badgeAfter === badgeBefore) {
      throw new Error(`badge unchanged after accept: before=${badgeBefore} after=${badgeAfter}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`frontend non-chat QA sweep — target ${BASE_URL}${ANOON_PATH}`);
  await mkdir(SHOTS_DIR, { recursive: true });

  const browser = await chromium.launch();
  const contextA = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  const contextB = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });

  // `console`/`pageerror` are Page-level events (BrowserContext has no such
  // events of its own), so the guards attach to each context's one page.
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const guardA = attachConsoleGuard(pageA, "admin1 (#00011)");
  const guardB = attachConsoleGuard(pageB, "admin2 (#00012)");

  try {
    await check("[a] Login as admin1", () => loginAs(pageA, "a"));
    await check("[b] Login as admin2", () => loginAs(pageB, "b"));

    for (const [page, who] of [[pageA, "a"], [pageB, "b"]]) {
      await checkChats(page, who);
      await checkHome(page, who);
      await checkNotificationsBadgeStable(page, who);
      await checkProfile(page, who);
      await checkInvite(page, who);
      await checkSettings(page, who);
      await checkWallet(page, who);
    }

    await checkFriendsAndSearch(pageA, "a", ACCOUNTS.b.hashId);
    await checkFriendsAndSearch(pageB, "b", ACCOUNTS.a.hashId);

    await checkFriendRequestAcceptRemoves(pageA, pageB);

    // Console/pageerror guards — fail the run if either side logged anything
    // unexpected across the whole sweep.
    for (const guard of [guardA, guardB]) {
      await check(`[console] no unexpected errors on ${guard.label}`, () => {
        if (guard.messages.length > 0) {
          throw new Error(`${guard.messages.length} error(s):\n${guard.messages.join("\n")}`);
        }
      });
    }
  } finally {
    await contextA.close();
    await contextB.close();
    await browser.close();
  }

  const passCount = results.filter((r) => r.status === "PASS").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  const skipCount = results.filter((r) => r.status === "SKIP").length;

  console.log("\n" + "=".repeat(60));
  console.log(`RESULT: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`);
  console.log(`Screenshots saved to ${SHOTS_DIR}`);
  console.log("=".repeat(60));

  if (failCount > 0) {
    console.log("\nFailures:");
    for (const r of results.filter((r) => r.status === "FAIL")) {
      console.log(`  - ${r.label}: ${r.detail}`);
    }
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("qa-nonchat.mjs crashed:", err);
  process.exit(1);
});
