import { getUid, myProfileId, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

// POST /api/push/subscribe { endpoint, keys:{p256dh,auth} }
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint || !p256dh || !auth) return Response.json({ error: "invalid subscription" }, { status: 400 });

  const admin = supabaseAdmin();
  const profileId = await myProfileId(admin, uid);
  if (!profileId) return Response.json({ error: "profile not found" }, { status: 404 });

  // supabase-js insert требует явный id (Prisma cuid-дефолт не создаётся в БД, см. баг #38).
  // upsert по endpoint писал null id → NOT NULL violation → подписка не сохранялась.
  const { data: existing } = await admin.from("PushSubscription").select("id").eq("endpoint", endpoint).maybeSingle();
  const { error } = existing
    ? await admin.from("PushSubscription").update({ profileId, p256dh, auth }).eq("endpoint", endpoint)
    : await admin.from("PushSubscription").insert({ id: crypto.randomUUID(), profileId, endpoint, p256dh, auth });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}

// DELETE /api/push/subscribe { endpoint }
export async function DELETE(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { endpoint?: unknown };
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return Response.json({ error: "endpoint required" }, { status: 400 });
  await supabaseAdmin().from("PushSubscription").delete().eq("endpoint", endpoint);
  return Response.json({ ok: true });
}
