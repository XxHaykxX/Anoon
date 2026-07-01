import {
  activeBan,
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

// POST /api/messages { peer, kind, text? } — persist сообщения.
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  if (!rateLimit(`msg:${uid}`, 30, 10_000)) return Response.json({ error: "rate limited" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { peer?: unknown; kind?: unknown; text?: unknown; mediaId?: unknown; id?: unknown };
  const peer = typeof body.peer === "string" ? body.peer : "";
  const kind = KIND_MAP[typeof body.kind === "string" ? body.kind : "text"] ?? "text";
  const text = typeof body.text === "string" ? body.text.slice(0, 4000) : null;
  const mediaId = typeof body.mediaId === "string" ? body.mediaId : null;
  // Клиентский id (UUID) → БД пишет его же, чтобы broadcast/local/история имели общий id.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const msgId = typeof body.id === "string" && UUID_RE.test(body.id) ? body.id : crypto.randomUUID();
  if (!peer) return Response.json({ error: "peer required" }, { status: 400 });

  const admin = supabaseAdmin();
  const [senderId, peerId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
  if (!senderId || !peerId) return Response.json({ error: "profile not found" }, { status: 404 });

  // Забаненный не может отправлять сообщения.
  const ban = await activeBan(admin, senderId);
  if (ban) return Response.json({ error: "banned", reason: ban.reason, until: ban.expiresAt }, { status: 403 });

  const convId = await findOrCreateConversation(admin, senderId, peerId);
  if (!convId) return Response.json({ error: "conversation failed" }, { status: 400 });

  // upsert по id: повторный persist того же клиентского id (ретрай/двойная отправка) не дублирует.
  const { data: msg, error } = await admin
    .from("Message")
    .upsert({ id: msgId, conversationId: convId, senderId, kind, text, mediaId, status: "sent" }, { onConflict: "id", ignoreDuplicates: true })
    .select("id,createdAt")
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  // ignoreDuplicates → при конфликте data=null; отвечаем клиентским id (запись уже есть).
  if (!msg) return Response.json({ id: msgId, at: new Date().toISOString() });
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
  const { data: conv } = await admin.from("Conversation").select("id,endedAt").eq("profileAId", a).eq("profileBId", b).maybeSingle();
  const convRow = conv as { id: string; endedAt: string | null } | null;
  const convId = convRow?.id;
  if (!convId) return Response.json({ messages: [], ended: false });
  const ended = Boolean(convRow?.endedAt);
  const { data: rows } = await admin
    .from("Message").select("id,senderId,kind,text,mediaId,status,createdAt")
    .eq("conversationId", convId).order("createdAt", { ascending: true }).limit(200);
  const list = (rows ?? []) as Array<{ id: string; senderId: string; kind: string; text: string | null; mediaId: string | null; status: string; createdAt: string }>;

  // Пути медиа — вторым запросом (без PostgREST embed).
  const mediaIds = list.map((m) => m.mediaId).filter((x): x is string => Boolean(x));
  const pathById = new Map<string, string>();
  if (mediaIds.length) {
    const { data: assets } = await admin.from("MediaAsset").select("id,r2Key").in("id", mediaIds);
    for (const a of (assets ?? []) as Array<{ id: string; r2Key: string }>) pathById.set(a.id, a.r2Key);
  }

  const messages = list.map((m) => ({
    id: m.id,
    mine: m.senderId === senderId,
    kind: KIND_MAP_OUT[m.kind] ?? m.kind,
    text: m.text ?? undefined,
    mediaPath: m.mediaId ? pathById.get(m.mediaId) : undefined,
    status: m.status,
    at: new Date(m.createdAt).getTime(),
  }));
  return Response.json({ messages, ended });
}
