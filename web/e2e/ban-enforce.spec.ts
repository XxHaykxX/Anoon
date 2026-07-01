import { test, expect, request as pwRequest } from "@playwright/test";

// Верификация энфорса бана: админ банит → юзер не может слать сообщения (403) + presence banned.
// Затем разбан → снова можно. Гоняет против прода.

const WEB = process.env.WEB_URL ?? "https://anoon-web.vercel.app";
const ADMIN = process.env.ADMIN_URL ?? "https://anoon-admin.vercel.app";
const ADMIN_PASS = process.env.ADMIN_PASS ?? "";

// Токен берём из реального heartbeat-запроса приложения (/api/presence) — надёжнее localStorage.
async function tokenOf(page: import("@playwright/test").Page): Promise<string | null> {
  const waitReq = page.waitForRequest(
    (r) => r.url().includes("/api/presence") && r.method() === "POST",
    { timeout: 35_000 },
  );
  await page.reload({ waitUntil: "domcontentloaded" }); // триггерит mount-beat
  const req = await waitReq;
  const auth = req.headers()["authorization"] ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

test("бан энфорсится: 403 на отправку + presence banned, разбан снимает", async ({ page, browser }) => {
  test.skip(!ADMIN_PASS, "нужен ADMIN_PASS в env (не хардкодим пароль в репо)");
  test.setTimeout(120_000);

  // Онбординг реального юзера.
  await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Например: Синий Кот").fill("Бан Тест");
  await page.getByRole("button", { name: /Начать общение|Входим/ }).click();
  const publicId = await expect
    .poll(
      async () =>
        page.evaluate(() => {
          try {
            const s = JSON.parse(localStorage.getItem("anoon-session") || "{}").state;
            return s?.synced ? s.publicId : null;
          } catch {
            return null;
          }
        }),
      { timeout: 25_000 },
    )
    .toBeTruthy()
    .then(() => page.evaluate(() => JSON.parse(localStorage.getItem("anoon-session") || "{}").state.publicId as string));

  const token = await tokenOf(page);
  expect(token, "должен быть supabase token").toBeTruthy();

  // Admin: найти profileId по publicId и забанить.
  const admin = await pwRequest.newContext({ baseURL: ADMIN });
  const login = await admin.post("/api/auth/login", { data: { email: "admin@anoon.app", password: ADMIN_PASS, totp: "" } });
  expect(login.status()).toBe(200);
  const usersResp = await admin.get("/api/admin/users");
  const users = (await usersResp.json()).data as Array<{ id: string; publicId: string }>;
  const target = users.find((u) => u.publicId === publicId);
  expect(target, "юзер найден в админке").toBeTruthy();

  const banResp = await admin.patch(`/api/admin/users/${target!.id}`, {
    data: { banned: true, reason: "e2e тест" },
  });
  expect(banResp.status()).toBe(200);

  // Юзер: отправка сообщения → 403 banned.
  const web = await pwRequest.newContext({ baseURL: WEB });
  const msgResp = await web.post("/api/messages", {
    headers: { authorization: `Bearer ${token}` },
    data: { peer: publicId, kind: "text", text: "не должно пройти" },
  });
  console.log("MSG status:", msgResp.status());
  expect(msgResp.status(), "отправка забаненного → 403").toBe(403);

  // presence → banned:true.
  const pres1 = await web.post("/api/presence", { headers: { authorization: `Bearer ${token}` }, data: {} });
  const pres1Body = await pres1.json();
  console.log("PRESENCE banned:", pres1Body.banned);
  expect(pres1Body.banned).toBe(true);

  // Разбан.
  const unbanResp = await admin.patch(`/api/admin/users/${target!.id}`, { data: { banned: false } });
  expect(unbanResp.status()).toBe(200);

  // presence → banned:false.
  const pres2 = await web.post("/api/presence", { headers: { authorization: `Bearer ${token}` }, data: {} });
  expect((await pres2.json()).banned).toBe(false);

  await admin.dispose();
  await web.dispose();
  void browser;
});
