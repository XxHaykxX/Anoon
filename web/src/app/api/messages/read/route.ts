import { getUid, myProfileId, profileIdByPublic, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

type IdRow = { id: string } | null;

// POST /api/messages/read { peer } — отметить сообщения собеседника прочитанными.
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { peer?: unknown };
  const peer = typeof body.peer === "string" ? body.peer : "";
  if (!peer) return Response.json({ error: "peer required" }, { status: 400 });

  const admin = supabaseAdmin();
  const [meId, peerId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
  if (!meId || !peerId) return Response.json({ ok: true });
  const [a, b] = [meId, peerId].sort();
  const { data: conv } = await admin.from("Conversation").select("id").eq("profileAId", a).eq("profileBId", b).maybeSingle();
  const convId = (conv as IdRow)?.id;
  if (!convId) return Response.json({ ok: true });
  await admin.from("Message").update({ status: "read" }).eq("conversationId", convId).eq("senderId", peerId).neq("status", "read");
  return Response.json({ ok: true });
}
