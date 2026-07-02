import { getUid, myProfileId, profileIdByPublic, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

// POST /api/messages/read { peer } — отметить сообщения собеседника прочитанными.
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { peer?: unknown; convKind?: unknown; conversationId?: unknown };
  const peer = typeof body.peer === "string" ? body.peer : "";
  const convKind = body.convKind === "friend" ? "friend" : "roulette";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!peer) return Response.json({ error: "peer required" }, { status: 400 });

  const admin = supabaseAdmin();
  const [meId, peerId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
  if (!meId || !peerId) return Response.json({ ok: true });
  const [a, b] = [meId, peerId].sort();
  // Эфемерная рулетка: отмечаем прочитанным конкретную сессию (verify пара+kind), иначе последнюю по kind.
  let convId: string | undefined;
  if (convKind === "roulette" && conversationId && UUID_RE.test(conversationId)) {
    const { data } = await admin
      .from("Conversation").select("id,profileAId,profileBId,kind").eq("id", conversationId).maybeSingle();
    const r = data as { id: string; profileAId: string; profileBId: string; kind: string } | null;
    if (r && r.kind === "roulette" && r.profileAId === a && r.profileBId === b) convId = r.id;
  } else {
    const { data: convRows } = await admin
      .from("Conversation").select("id").eq("profileAId", a).eq("profileBId", b).eq("kind", convKind)
      .order("createdAt", { ascending: false }).limit(1);
    convId = ((convRows ?? []) as Array<{ id: string }>)[0]?.id;
  }
  if (!convId) return Response.json({ ok: true });
  await admin.from("Message").update({ status: "read" }).eq("conversationId", convId).eq("senderId", peerId).neq("status", "read");
  return Response.json({ ok: true });
}
