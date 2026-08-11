import { test, expect } from "@playwright/test";
import { skipUnlessAdmin, loginAs } from "./helpers";

skipUnlessAdmin(test);

/**
 * The "Чаты" section (#48): a moderator reads a reported conversation whole —
 * the owner's answer to Q7a on 2026-08-11. Until then the section served
 * fixtures behind a TODO, so what these tests are really pinning is that it now
 * reads the LIVE conversations out of Tinode via the ROOT bot.
 *
 * Two failures this is built to catch, both of which look like an empty-ish but
 * working panel rather than a bug:
 *
 *   - the counters silently going flat. They come from ROOT's `me` subscription
 *     list, and Tinode answers a limited {get} for it in NO order — the first
 *     working version of the endpoint returned 498 topics from a month ago and
 *     every row read "0 сообщений". A conversation with messages must therefore
 *     report a non-zero count, not just render.
 *   - the section quietly falling back to the fixtures. Every assertion below
 *     is cross-checked against what the panel's own route returns, and the mock
 *     conversations (c1/c2, nicknames "Лиса"/"Кот") match nothing here.
 */

type Conversation = {
  id: string;
  a: { id: string; publicId: string };
  b: { id: string; publicId: string };
  messages: number;
};
type ChatMessage = { id: string; senderId: string; kind: string; text: string | null };

test.describe("admin panel: чтение переписок", () => {
  test("no session: the chats API answers 401", async ({ context }) => {
    const res = await context.request.get("/api/admin/chats");
    expect(res.status(), "private messages must never be served to an anonymous caller").toBe(401);
  });

  test("the list is the companion's conversations, with real counters", async ({ browser }) => {
    const ctx = await browser.newContext();
    await loginAs(ctx, "super_admin");
    const page = await ctx.newPage();

    const res = await ctx.request.get("/api/admin/chats");
    expect(res.status()).toBe(200);
    const { conversations } = (await res.json()) as { conversations: Conversation[] };
    expect(conversations.length, "the stand has roulette pairings to show").toBeGreaterThan(0);

    // A topic id is the one value a fixture cannot fake: they are Tinode's own
    // `grp…`/`usr…` names, generated per match.
    expect(conversations[0].id).toMatch(/^(grp|usr)/);
    // At least one conversation must carry messages. Zero everywhere is exactly
    // what the broken-counters bug looked like.
    expect(
      conversations.some((c) => c.messages > 0),
      "no conversation reports a single message — the ROOT topic read is not landing",
    ).toBe(true);

    await page.goto("/chats");
    await expect(page.getByRole("heading", { name: "Чаты" })).toBeVisible();
    for (const c of conversations.slice(0, 3)) {
      await expect(page.getByText(`#${c.a.publicId} · #${c.b.publicId}`, { exact: false }).first()).toBeVisible({
        timeout: 15_000,
      });
    }
    await ctx.close();
  });

  test("opening a conversation shows its messages, whole", async ({ browser }) => {
    const ctx = await browser.newContext();
    await loginAs(ctx, "super_admin");
    const page = await ctx.newPage();

    const list = (await (await ctx.request.get("/api/admin/chats")).json()) as {
      conversations: Conversation[];
    };
    const index = list.conversations.findIndex((c) => c.messages > 0);
    expect(index, "need one conversation with messages to read").toBeGreaterThanOrEqual(0);
    const chatty = list.conversations[index];

    const res = await ctx.request.get(`/api/admin/chats?id=${encodeURIComponent(chatty.id)}`);
    expect(res.status()).toBe(200);
    const { messages } = (await res.json()) as { messages: ChatMessage[] };
    expect(messages.length, "a conversation with a count must give up its messages").toBeGreaterThan(0);

    await page.goto("/chats");
    // By position, not by label: on a stand where the same two accounts were
    // matched over and over, every row reads "#00011 · #00012" and picking by
    // name opens an arbitrary one of them. The rows are the only elements
    // carrying aria-current, and they render in the order the route returned.
    await page.locator("button[aria-current]").nth(index).click();
    const text = messages.find((m) => m.kind === "text" && m.text)?.text;
    if (text) {
      await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(page.getByText("Сообщений нет")).toHaveCount(0);
    }
    await ctx.close();
  });

  test("an attachment actually loads (the panel proxies it, Tinode refuses direct)", async ({ browser }) => {
    // A message's attachment is a path on TINODE's origin. Rendered as-is it
    // asks the panel for a file the panel does not have, and asking Tinode
    // directly is a 403 — the operator has no Tinode account. Both failures
    // look identical in the UI: a broken image where the evidence should be.
    const ctx = await browser.newContext();
    await loginAs(ctx, "super_admin");

    const media = (await (await ctx.request.get("/api/admin/media?all=1&pageSize=5")).json()) as {
      files: { url: string }[];
    };
    const url = media.files?.[0]?.url;
    expect(url, "the stand has uploaded media to serve").toBeTruthy();
    expect(url, "attachment URLs must be rewritten onto the panel's own route").toContain(
      "/api/admin/file?ref=",
    );

    const file = await ctx.request.get(url);
    expect(file.status()).toBe(200);
    expect((await file.body()).length, "an empty 200 is a broken image with better manners").toBeGreaterThan(0);

    // The ref is data out of a chat message, so the path it points at is not
    // ours to trust.
    const traversal = await ctx.request.get("/api/admin/file?ref=%2Fetc%2Fpasswd");
    expect(traversal.status()).toBe(400);
    await ctx.close();
  });

  test("a moderator may read chats too — the section is not super_admin-only", async ({ browser }) => {
    // Q7a is about what a moderator sees; gating the section to super_admins
    // would make the decision meaningless in practice.
    const ctx = await browser.newContext();
    await loginAs(ctx, "moderator");
    const res = await ctx.request.get("/api/admin/chats");
    expect(res.status()).toBe(200);
    await ctx.close();
  });
});
