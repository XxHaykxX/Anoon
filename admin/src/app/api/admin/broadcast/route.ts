import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { profiles } from "@/data/fixtures";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-session";
import { companionBroadcast, companionEnabled } from "@/lib/companion-client";

export const runtime = "nodejs";

const WEB_URL = process.env.WEB_URL ?? "https://anoon-web.vercel.app";
// companion теперь тоже умеет POST /admin/broadcast (см. COMPANION-ADMIN-API.md §5): при
// ADMIN_BACKEND=companion шлём туда напрямую; иначе (по умолчанию) остаёмся на WEB_URL-прокси
// (web-push/VAPID). companion честно фильтрует по полу (опциональное поле gender:
// "male"|"female", отсутствие = всем) — маппинг ниже.
// В mock-режиме симулируем «отправлено» вместо похода на бэкенд. Роль в mock-auth
// всегда super_admin (см. providers/auth-provider.ts), сессионной cookie там нет —
// серверную проверку роли в этом режиме не делаем (нечего проверять).
const MOCK = process.env.NEXT_PUBLIC_DATA_MODE !== "api";
const MOCK_GENDER: Record<string, "male" | "female"> = { p1: "female", p2: "male", p3: "female", p4: "male" };

// POST /api/admin/broadcast { title, body, url?, gender? } — массовая push-рассылка.
// Только super_admin (действие массовое, высокого доверия).
export async function POST(req: Request) {
  if (MOCK) {
    const body = (await req.json().catch(() => ({}))) as { gender?: string };
    const total = profiles.filter((p) => !body.gender || body.gender === "all" || MOCK_GENDER[p.id] === body.gender).length;
    return NextResponse.json({ sent: total, total });
  }

  const jar = await cookies();
  const session = await verifySession(jar.get(ADMIN_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "super_admin") return NextResponse.json({ error: "только super_admin" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (companionEnabled()) {
    try {
      const title = typeof body.title === "string" ? body.title : "";
      const text = typeof body.body === "string" && body.body ? body.body : undefined;
      const url = typeof body.url === "string" && body.url ? body.url : undefined;
      // UI шлёт gender: "all"|"male"|"female" (см. broadcast/page.tsx AUDIENCES) — companion
      // принимает только male|female, "all"/пусто = не передаём поле (значит всем).
      const gender = body.gender === "male" || body.gender === "female" ? body.gender : undefined;
      const { sent, failed } = await companionBroadcast({ title, body: text, url, gender });
      return NextResponse.json({ sent, total: sent + failed });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "companion недоступен" }, { status: 502 });
    }
  }

  const secret = process.env.ADMIN_BROADCAST_SECRET;
  if (!secret) return NextResponse.json({ error: "ADMIN_BROADCAST_SECRET не задан" }, { status: 500 });

  const res = await fetch(`${WEB_URL}/api/push/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": secret },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (!res) return NextResponse.json({ error: "web недоступен" }, { status: 502 });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
