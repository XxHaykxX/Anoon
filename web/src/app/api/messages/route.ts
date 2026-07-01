import {
  findOrCreateConversation,
  getUid,
  KIND_MAP,
  KIND_MAP_OUT,
  myProfileId,
  profileIdByPublic,
  pushToProfile,
  rateLimit,
  supabaseAdmin,
  unauthorized,
} from "@/lib/server/backend";

export const runtime = "nodejs";

type IdRow = { id: string } | null;

// POST /api/messages { peer, kind, text? } — persist сообщения.
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  if (!rateLimit(`msg:${uid}`, 30, 10_000)) return Response.json({ error: "rate limited" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { peer?: unknown; kind?: unknown; text?: unknown };
  const peer = typeof body.peer === "string" ? body.peer : "";
  const kind = KIND_MAP[typeof body.kind === "string" ? body.kind : "text"] ?? "text";
  const text = typeof body.text === "string" ? body.text.slice(0, 4000) : null;
  if (!peer) return Response.json({ error: "peer required" }, { status: 400 });

  const admin = supabaseAdmin();
  const [senderId, peerId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
  if (!senderId || !peerId) return Response.json({ error: "profile not found" }, { status: 404 });

  const convId = await findOrCreateConversation(admin, senderId, peerId);
  if (!convId) return Response.json({ error: "conversation failed" }, { status: 400 });

  const { data: msg, error } = await admin
    .from("Message").insert({ conversationId: convId, senderId, kind, text, status: "sent" }).select("id,createdAt").single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  await admin.from("Conversation").update({ lastMessageAt: new Date().toISOString() }).eq("id", convId);

  const { data: peerProfile } = await admin.from("Profile").select("online,nickname").eq("id", peerId).maybeSingle();
  const { data: myProfile } = await admin.from("Profile").select("publicId,nickname").eq("id", senderId).maybeSingle();
  if (peerProfile && !(peerProfile as { online?: boolean }).online) {
    await pushToProfile(admin, peerId, {
      title: (myProfile as { nickname?: string } | null)?.nickname ?? "Новое сообщение",
      body: kind === "text" ? (text ?? "") : "📎 Медиа",
      url: `/chat/${(myProfile as { publicId?: string } | null)?.publicId ?? ""}`,
    });
  }
  return Response.json({ id: (msg as { id: string }).id, at: (msg as { createdAt: string }).createdAt });
}

// GET /api/messages?peer=publicId — история диалога.
export async function GET(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  const peer = new URL(req.url).searchParams.get("peer") ?? "";
  if (!peer) return Response.json({ error: "peer required" }, { status: 400 });

  const admin = supabaseAdmin();
  const [senderId, peerId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
  if (!senderId || !peerId) return Response.json({ messages: [] });
  const [a, b] = [senderId, peerId].sort();
  const { data: conv } = await admin.from("Conversation").select("id").eq("profileAId", a).eq("profileBId", b).maybeSingle();
  const convId = (conv as IdRow)?.id;
  if (!convId) return Response.json({ messages: [] });
  const { data: rows } = await admin
    .from("Message").select("id,senderId,kind,text,status,createdAt")
    .eq("conversationId", convId).order("createdAt", { ascending: true }).limit(200);
  const messages = ((rows ?? []) as Array<{ id: string; senderId: string; kind: string; text: string | null; status: string; createdAt: string }>).map((m) => ({
    id: m.id,
    mine: m.senderId === senderId,
    kind: KIND_MAP_OUT[m.kind] ?? m.kind,
    text: m.text ?? undefined,
    status: m.status,
    at: new Date(m.createdAt).getTime(),
  }));
  return Response.json({ messages });
}
