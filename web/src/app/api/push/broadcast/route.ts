import { broadcastPush, supabaseAdmin } from "@/lib/server/backend";

export const runtime = "nodejs";

// POST /api/push/broadcast { title, body, url?, gender? } — массовая рассылка push.
// Авторизация — общий секрет ADMIN_BROADCAST_SECRET (админка проксирует, ключ не у клиента).
// gender: all (по умолчанию) | male | female — фильтр по Profile.realGender.
export async function POST(req: Request) {
  const expected = process.env.ADMIN_BROADCAST_SECRET;
  const got = req.headers.get("x-admin-secret");
  if (!expected || got !== expected) return Response.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { title?: unknown; body?: unknown; url?: unknown; gender?: unknown };
  const title = typeof body.title === "string" ? body.title.slice(0, 120).trim() : "";
  const text = typeof body.body === "string" ? body.body.slice(0, 300).trim() : "";
  const url = typeof body.url === "string" && body.url ? body.url.slice(0, 500) : "/";
  const gender = body.gender === "male" || body.gender === "female" ? body.gender : "all";
  if (!title) return Response.json({ error: "title required" }, { status: 400 });

  const res = await broadcastPush(supabaseAdmin(), gender, { title, body: text, url });
  return Response.json({ ok: true, ...res, gender });
}
