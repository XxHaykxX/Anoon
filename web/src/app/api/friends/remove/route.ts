import {
  canonicalPair,
  getUid,
  myProfileCore,
  profileCoreByPublic,
  supabaseAdmin,
  unauthorized,
} from "@/lib/server/backend";

export const runtime = "nodejs";

// POST /api/friends/remove { peerPublicId } — расфрендить (любая сторона).
// Удаляем строку Friendship. Личка-Conversation (kind='friend') НЕ удаляется здесь —
// её очистка/«личка пропадёт» решается в T6 (unfriend-флоу), чтобы не делать деструктив в T3.
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as { peerPublicId?: unknown };
  const peerPublicId = typeof body.peerPublicId === "string" ? body.peerPublicId.trim().replace(/^#/, "") : "";
  if (!peerPublicId) return Response.json({ error: "peerPublicId required" }, { status: 400 });

  const admin = supabaseAdmin();
  const me = await myProfileCore(admin, uid);
  if (!me) return Response.json({ error: "profile not found" }, { status: 404 });
  const peer = await profileCoreByPublic(admin, peerPublicId);
  if (!peer) return Response.json({ ok: true, status: "none" });

  const { loId, hiId } = canonicalPair(me, peer);
  await admin.from("Friendship").delete().eq("loId", loId).eq("hiId", hiId);
  return Response.json({ ok: true, status: "none" });
}
