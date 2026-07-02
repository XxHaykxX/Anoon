import {
  friendStatusBetween,
  getUid,
  myProfileCore,
  profileCoreByPublic,
  supabaseAdmin,
  unauthorized,
} from "@/lib/server/backend";

export const runtime = "nodejs";

// GET /api/friends/status?peer=publicId → { status: none|pending_me|pending_peer|accepted }
// Гидрация состояния кнопки раскрытия в чате после reload.
export async function GET(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  const peerPublicId = (new URL(req.url).searchParams.get("peer") ?? "").trim().replace(/^#/, "");
  if (!peerPublicId) return Response.json({ error: "peer required" }, { status: 400 });

  const admin = supabaseAdmin();
  const me = await myProfileCore(admin, uid);
  const peer = await profileCoreByPublic(admin, peerPublicId);
  if (!me || !peer || peer.id === me.id) return Response.json({ status: "none" });

  const status = await friendStatusBetween(admin, me, peer);
  return Response.json({ status });
}
