import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { skipUnlessAdmin, loginAs } from "./helpers";

skipUnlessAdmin(test);

/**
 * First automated pass over the admin panel (docs/qa/QA-ADMIN.md §1). Two
 * things it is deliberately built to catch, because both are load-bearing and
 * both have failed silently before:
 *
 *   - the default-deny session gate (proxy.ts + the per-route checks added in
 *     #19). A regression here does not look broken — the panel simply serves
 *     data to anyone who knows the URL.
 *   - the SERVER-side role gate. The UI hides what a moderator may not do, but
 *     hiding a button is not a boundary; these tests bypass the UI and ask the
 *     route directly, which is the only version of the check that matters.
 *
 * It also pins that the panel is actually reading the live companion and not
 * the fixtures: every list assertion is cross-checked against what
 * /api/admin/* returns, and a mock-mode build (mockDataProvider, zero network)
 * would show fixture rows that no longer match.
 *
 * Not covered here, and still manual in QA-ADMIN.md: the login FORM (the
 * operator record lives in a Supabase project that no longer resolves — see
 * helpers.ts), the ban→Tinode session-teardown pairing, broadcast delivery
 * (needs VAPID keys), and everything under §2 (attested mode), which needs
 * companion restarted with COMPANION_ADMIN_TOKEN_SECRET set.
 */

test.describe("admin panel: session gate, role gate, live companion data", () => {
  test("no session: pages redirect to login and APIs answer 401", async ({ page, context }) => {
    // Nothing minted on this context on purpose.
    await page.goto("/users");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: /Войти/ })).toBeVisible();

    // The API half, which is the one that fails quietly: #19 was two GET routes
    // that answered with real data when the session check was misconfigured.
    for (const path of ["/api/admin/users", "/api/admin/overview", "/api/admin/users/1"]) {
      const res = await context.request.get(path);
      expect(res.status(), `${path} must refuse an anonymous caller`).toBe(401);
    }
  });

  test("super_admin: the user list is the companion's, row for row", async ({ browser }) => {
    const ctx = await browser.newContext();
    await loginAs(ctx, "super_admin");
    const page = await ctx.newPage();

    // What the backend says, read through the panel's own route (so the shared
    // secret, the operator headers and the companion round-trip are all
    // exercised) rather than by talking to companion directly.
    const res = await ctx.request.get("/api/admin/users?_start=0&_end=1000");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { data: { publicId: string }[]; total?: number };
    expect(body.data.length, "companion should return the seeded accounts").toBeGreaterThan(0);

    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Пользователи" })).toBeVisible();
    // The #ID column is the one value that cannot be invented by a fixture that
    // happens to look plausible: assert the exact ids companion just returned.
    for (const u of body.data.slice(0, 3)) {
      await expect(page.getByText(`#${u.publicId}`, { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
    }
    await ctx.close();
  });

  test("a user's detail card opens (the single-row GET companion was missing)", async ({ browser }) => {
    const ctx = await browser.newContext();
    await loginAs(ctx, "super_admin");
    const page = await ctx.newPage();

    const users = (await (await ctx.request.get("/api/admin/users?_start=0&_end=1")).json()) as {
      data: { id: string; publicId: string }[];
    };
    const u = users.data[0]!;

    await page.goto(`/users/${u.id}`);
    // «Пользователь не найден» is what this page showed for every user while
    // companion had no GET /admin/users/{id} — getOne threw, Refine returned
    // nothing, and the card rendered its empty state. Assert the real content.
    await expect(page.getByText(`#${u.publicId}`, { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Пользователь не найден")).toHaveCount(0);

    // «Медиа пользователя» is fed by Refine's useList, which speaks a different
    // contract to the same /api/admin/media route than the Files/Gallery pages
    // do — it wants {data,total} and sends its filter as `f_ownerProfileId`.
    // The route only answered the pages' shape, so this block rendered «Медиа
    // нет» for everyone, including an account with 69 files in companion.
    const media = (await (
      await ctx.request.get(`/api/admin/media?f_ownerProfileId=${u.id}&pageSize=5`)
    ).json()) as { data?: unknown[] };
    if ((media.data ?? []).length > 0) {
      await expect(page.getByText("Медиа нет")).toHaveCount(0);
    }
    await ctx.close();
  });

  test("overview cards carry the companion's numbers, not fixtures", async ({ browser }) => {
    const ctx = await browser.newContext();
    await loginAs(ctx, "super_admin");
    const page = await ctx.newPage();

    const overview = (await (await ctx.request.get("/api/admin/overview")).json()) as {
      total: number;
      reportsOpen: number;
      bansActive: number;
    };

    await page.goto("/overview");
    // Scope to the card, not the page: several cards can legitimately show the
    // same number (0 reports, 0 bans), so an unscoped match would pass on the
    // wrong one. The label <p> and the value <p> are siblings inside the card.
    // Card layout (overview/page.tsx StatCard): the label <p> sits in a flex row
    // next to the icon, and the value <p> is that row's sibling — so the card is
    // the label's grandparent. Walking up beats filtering divs by content, which
    // matches every ancestor and picks the wrong one at either end.
    const cardValue = (label: string) =>
      page.getByText(label, { exact: true }).locator("xpath=../..").locator("p.text-2xl");
    // toLocaleString("ru-RU") — the card formats thousands with a NBSP.
    const ru = (n: number) => n.toLocaleString("ru-RU");
    await expect(cardValue("Всего пользователей")).toHaveText(ru(overview.total), { timeout: 15_000 });
    await expect(cardValue("Активных банов")).toHaveText(ru(overview.bansActive));
    await ctx.close();
  });

  test("role gate is enforced by the route, not just hidden in the UI", async ({ browser }) => {
    const ctx = await browser.newContext();
    await loginAs(ctx, "moderator");

    const users = (await (await ctx.request.get("/api/admin/users?_start=0&_end=1000")).json()) as {
      data: { id: string; publicId: string }[];
    };
    // Anyone EXCEPT the two accounts the PWA suite logs into: a ban tears down
    // the target's Tinode session, and even a briefly banned admin1/admin2
    // would knock over whatever real/ spec happens to be running.
    const victim = users.data.find((u) => u.publicId !== "00011" && u.publicId !== "00012");
    expect(victim, "need a third seeded account to test banning on").toBeTruthy();

    // A permanent ban (no expiresAt) is super_admin-only. The UI never offers
    // it to a moderator (ban-dialog's allowPermanent={false}) — this asks the
    // route straight out, the way anyone with the cookie and curl would.
    const res = await ctx.request.patch(`/api/admin/users/${victim!.id}`, {
      data: { banned: true },
    });
    expect(res.status(), "a moderator must not be able to ban permanently").toBe(403);
    expect(await res.text()).toContain("super_admin");

    // And the same operator IS allowed the temporary version — otherwise this
    // test would also pass with the whole PATCH route broken.
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const ok = await ctx.request.patch(`/api/admin/users/${victim!.id}`, {
      data: { banned: true, expiresAt: until },
    });
    expect(ok.status(), "a timed ban is within a moderator's rights").toBe(200);
    // Undo it: lifting is super_admin-only, so this needs a second operator.
    const superCtx = await browser.newContext();
    await loginAs(superCtx, "super_admin");
    const unban = await superCtx.request.patch(`/api/admin/users/${victim!.id}`, {
      data: { banned: false },
    });
    expect(unban.status(), "cleanup: the ban must be liftable again").toBe(200);
    await superCtx.close();
    await ctx.close();
  });

  test("broadcast is closed to a moderator and open to a super_admin", async ({ browser }) => {
    const asRole = async (role: "moderator" | "super_admin"): Promise<[BrowserContext, Page]> => {
      const ctx = await browser.newContext();
      await loginAs(ctx, role);
      const page = await ctx.newPage();
      await page.goto("/broadcast");
      return [ctx, page];
    };

    const [modCtx, modPage] = await asRole("moderator");
    await expect(modPage.getByText("Массовая рассылка доступна только super_admin.")).toBeVisible({
      timeout: 15_000,
    });
    await modCtx.close();

    const [supCtx, supPage] = await asRole("super_admin");
    await expect(supPage.getByRole("heading", { name: "Рассылка push-уведомлений" })).toBeVisible({
      timeout: 15_000,
    });
    await supCtx.close();
  });
});
