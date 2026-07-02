import { getUid, myProfileId, profileIdByPublic, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

// POST /api/messages/end { peer } — пометить диалог завершённым (Conversation.endedAt).
// Персист нужен, чтобы завершение переживало reload и доходило до офлайн-собеседника
// (broadcast эфемерный). Повторный вызов идемпотентен.
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as { peer?: unknown; convKind?: unknown };
  const peer = typeof body.peer === "string" ? body.peer : "";
  // Личку не завершают (нет endedAt) — end актуален только для рулетки. Дефолт roulette.
  const convKind = body.convKind === "friend" ? "friend" : "roulette";
  if (!peer) return Response.json({ error: "peer required" }, { status: 400 });

  const admin = supabaseAdmin();
  const [myId, peerId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
  if (!myId || !peerId) return Response.json({ error: "profile not found" }, { status: 404 });

  const [a, b] = [myId, peerId].sort();
  const { data: convRows } = await admin
    .from("Conversation").select("id,endedAt").eq("profileAId", a).eq("profileBId", b).eq("kind", convKind)
    .order("createdAt", { ascending: false }).limit(1);
  const row = ((convRows ?? []) as Array<{ id: string; endedAt: string | null }>)[0] ?? null;
  if (!row) return Response.json({ ok: true }); // диалога ещё нет — нечего завершать

  if (!row.endedAt) {
    await admin.from("Conversation").update({ endedAt: new Date().toISOString() }).eq("id", row.id);
  }
  return Response.json({ ok: true });
}
