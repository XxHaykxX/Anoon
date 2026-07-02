import {
  canonicalPair,
  findOrCreateConversation,
  getUid,
  myProfileCore,
  profileCoreByPublic,
  pushToProfile,
  rateLimit,
  supabaseAdmin,
  unauthorized,
} from "@/lib/server/backend";

export const runtime = "nodejs";

// POST /api/friends/respond { requesterPublicId, action: "accept" | "decline" }
// Отвечать может ТОЛЬКО не-заявитель. accept → раскрыты+друзья+ленивая личка; decline → удалить строку.
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  if (!rateLimit(`friend:${uid}`, 20, 60_000)) return Response.json({ error: "rate limited" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { requesterPublicId?: unknown; action?: unknown };
  const requesterPublicId = typeof body.requesterPublicId === "string" ? body.requesterPublicId.trim().replace(/^#/, "") : "";
  const action = body.action === "accept" || body.action === "decline" ? body.action : "";
  if (!requesterPublicId || !action) return Response.json({ error: "bad request" }, { status: 400 });

  const admin = supabaseAdmin();
  const me = await myProfileCore(admin, uid);
  if (!me) return Response.json({ error: "profile not found" }, { status: 404 });
  const requester = await profileCoreByPublic(admin, requesterPublicId);
  if (!requester) return Response.json({ error: "requester not found" }, { status: 404 });

  const { loId, hiId } = canonicalPair(me, requester);
  const { data: row } = await admin
    .from("Friendship").select("status,requestedById").eq("loId", loId).eq("hiId", hiId).maybeSingle();
  const fr = row as { status: string; requestedById: string } | null;
  if (!fr) return Response.json({ error: "no request" }, { status: 404 });
  // Отвечать может только НЕ-заявитель (нельзя принять/отклонить свою же заявку).
  if (fr.requestedById === me.id) return Response.json({ error: "not addressee" }, { status: 403 });
  if (fr.status === "accepted") return Response.json({ ok: true, status: "accepted" });

  if (action === "decline") {
    // Удаляем строку (не оставляем pending → повторный запрос не блокируется).
    await admin.from("Friendship").delete().eq("loId", loId).eq("hiId", hiId);
    await pushToProfile(admin, requester.id, { title: "Запрос отклонён", body: "Профили остались скрыты", url: `/chat/${me.publicId}` });
    return Response.json({ ok: true, status: "none" });
  }

  // accept → раскрыты + друзья + личка.
  await admin.from("Friendship").update({ status: "accepted", acceptedAt: new Date().toISOString() }).eq("loId", loId).eq("hiId", hiId);
  // Ленивая friend-Conversation (канонический порядок, partial unique лички — в T2).
  await findOrCreateConversation(admin, me.id, requester.id, "friend");
  await pushToProfile(admin, requester.id, { title: "Профили открыты", body: "Вы теперь друзья", url: `/chat/${me.publicId}` });
  return Response.json({ ok: true, status: "accepted" });
}
