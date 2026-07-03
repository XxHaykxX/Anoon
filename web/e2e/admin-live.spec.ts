import { test, expect, request as pwRequest } from "@playwright/test";

// Верификация #36 (online по полу) и #37 (история/живые чаты) на проде.
// #36: web-heartbeat при маунте → online в admin overview растёт.
// #37: два реальных юзера обмениваются сообщением → Conversation виден в admin/chats.

const WEB = process.env.WEB_URL ?? "https://anoon-web.vercel.app";
const ADMIN = process.env.ADMIN_URL ?? "https://anoon-admin.vercel.app";
const ADMIN_PASS = process.env.ADMIN_PASS ?? "lVRmXO6cb6i4";

async function onboard(page: import("@playwright/test").Page, nick: string) {
  await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Например: Синий Кот").fill(nick);
  await page.getByRole("button", { name: /Начать общение|Входим/ }).click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          try {
            return JSON.parse(localStorage.getItem("anoon-session") || "{}").state;
          } catch {
            return null;
          }
        }),
      { timeout: 25_000, message: "профиль не синкнулся" },
    )
    .toMatchObject({ synced: true });
  return page.evaluate(() => JSON.parse(localStorage.getItem("anoon-session") || "{}").state.publicId as string);
}

// Аутентифицированный admin-запросный контекст.
async function adminApi() {
  const ctx = await pwRequest.newContext({ baseURL: ADMIN });
  const resp = await ctx.post("/api/auth/login", {
    data: { email: "admin@anoon.app", password: ADMIN_PASS, totp: "" },
  });
  expect(resp.status(), "admin login").toBe(200);
  return ctx;
}

test("#36 online по полу + #37 история чатов", async ({ browser }) => {
  test.setTimeout(120_000);

  // Два реальных юзера.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const idA = await onboard(pageA, "Живой Тест A");
  const idB = await onboard(pageB, "Живой Тест B");
  expect(idA).toBeTruthy();
  expect(idB).toBeTruthy();

  // #37: B открывает чат с A по #ID и шлёт сообщение → Conversation + Message.
  await pageB.goto(`${WEB}/chat/${idA}`, { waitUntil: "domcontentloaded" });
  // Дождаться гидратации composer (иначе onChange у input ещё не навешен).
  await expect(pageB.getByRole("button", { name: "Прикрепить фото или видео" })).toBeVisible({ timeout: 15_000 });
  await pageB.waitForTimeout(1000);
  const input = pageB.getByLabel("Текст сообщения");
  await input.click();
  await input.type("привет из теста живых чатов", { delay: 20 });
  const sendBtn = pageB.getByRole("button", { name: "Отправить" });
  await expect(sendBtn).toBeVisible({ timeout: 10_000 });
  await sendBtn.click();
  await pageB.waitForTimeout(3000);

  const admin = await adminApi();

  // #36: overview — есть онлайн (A и B только что бились heartbeat при маунте).
  const ovResp = await admin.get("/api/admin/overview");
  expect(ovResp.status()).toBe(200);
  const ov = await ovResp.json();
  console.log("OVERVIEW:", JSON.stringify(ov));
  expect(ov.online, "online должно быть >=1").toBeGreaterThanOrEqual(1);

  // online-список отдаётся.
  const onlineResp = await admin.get("/api/admin/overview?online=1");
  expect(onlineResp.status()).toBe(200);
  const online = await onlineResp.json();
  expect(Array.isArray(online.profiles)).toBeTruthy();

  // #37: chats — есть диалог A↔B с сообщением.
  const chatsResp = await admin.get("/api/admin/chats");
  expect(chatsResp.status()).toBe(200);
  const chats = await chatsResp.json();
  console.log("CHATS count:", chats.conversations?.length);
  const conv = (chats.conversations ?? []).find(
    (c: { a: { publicId: string }; b: { publicId: string } }) =>
      (c.a.publicId === idA && c.b.publicId === idB) || (c.a.publicId === idB && c.b.publicId === idA),
  );
  expect(conv, "диалог A↔B должен существовать").toBeTruthy();
  expect(conv.messages, "в диалоге есть сообщения").toBeGreaterThanOrEqual(1);

  // Сообщения диалога читаются.
  const msgResp = await admin.get(`/api/admin/chats?id=${conv.id}`);
  expect(msgResp.status()).toBe(200);
  const msgData = await msgResp.json();
  expect(msgData.messages.some((m: { text?: string }) => (m.text ?? "").includes("живых чатов"))).toBeTruthy();

  await admin.dispose();
  await ctxA.close();
  await ctxB.close();
});
