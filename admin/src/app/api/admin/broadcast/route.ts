import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ADMIN_COOKIE, verifySession } from "@/lib/admin-session";

export const runtime = "nodejs";

const WEB_URL = process.env.WEB_URL ?? "https://anoon-web.vercel.app";

// POST /api/admin/broadcast { title, body, url?, gender? } — массовая push-рассылка.
// Прокси на web (там VAPID-ключи + web-push). Общий секрет ADMIN_BROADCAST_SECRET.
// Только super_admin (действие массовое, высокого доверия).
export async function POST(req: Request) {
  const jar = await cookies();
  const session = await verifySession(jar.get(ADMIN_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "super_admin") return NextResponse.json({ error: "только super_admin" }, { status: 403 });

  const secret = process.env.ADMIN_BROADCAST_SECRET;
  if (!secret) return NextResponse.json({ error: "ADMIN_BROADCAST_SECRET не задан" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const res = await fetch(`${WEB_URL}/api/push/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": secret },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (!res) return NextResponse.json({ error: "web недоступен" }, { status: 502 });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
