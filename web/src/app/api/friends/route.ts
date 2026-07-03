import {
  canonicalPair,
  getUid,
  myProfileCore,
  profileCoreByPublic,
  pushToProfile,
  rateLimit,
  supabaseAdmin,
  unauthorized,
} from "@/lib/server/backend";

export const runtime = "nodejs";

type FriendshipRow = {
  loId: string;
  hiId: string;
  requestedById: string;
  status: string;
  acceptedAt: string | null;
};

// POST /api/friends { peerPublicId } — отправить запрос на раскрытие (создать pending Friendship).
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  // Rate-limit: защита от спама заявок / перебора #ID (risk #2, C.2).
  if (!rateLimit(`friend:${uid}`, 20, 60_000)) return Response.json({ error: "rate limited" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { peerPublicId?: unknown };
  const peerPublicId = typeof body.peerPublicId === "string" ? body.peerPublicId.trim().replace(/^#/, "") : "";
  if (!peerPublicId) return Response.json({ error: "peerPublicId required" }, { status: 400 });

  const admin = supabaseAdmin();
  const me = await myProfileCore(admin, uid);
  if (!me) return Response.json({ error: "profile not found" }, { status: 404 });
  const peer = await profileCoreByPublic(admin, peerPublicId);
  if (!peer) return Response.json({ error: "peer not found" }, { status: 404 });
  if (peer.id === me.id) return Response.json({ error: "self" }, { status: 400 });

  const { loId, hiId } = canonicalPair(me, peer);
  // Не дубль в ЛЮБОМ направлении (канонический порядок → одна строка на пару).
  const { data: existing } = await admin
    .from("Friendship").select("status,requestedById").eq("loId", loId).eq("hiId", hiId).maybeSingle();
  const ex = existing as { status: string; requestedById: string } | null;
  if (ex) {
    const status = ex.status === "accepted" ? "accepted" : ex.requestedById === me.id ? "pending_me" : "pending_peer";
    return Response.json({ ok: true, status, already: true });
  }

  const { error } = await admin.from("Friendship").insert({
    id: crypto.randomUUID(), // DB-дефолт gen_random_uuid() есть, но шлём явно (урок #38).
    loId,
    hiId,
    requestedById: me.id,
    status: "pending",
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });

  // Персист-источник правды + push заявляемому (durable; C.2 «работает без активного канала»).
  await pushToProfile(admin, peer.id, {
    title: "Запрос на раскрытие",
    body: `#${me.publicId} хочет открыть профили`,
    url: `/chat/${me.publicId}`,
  });
  return Response.json({ ok: true, status: "pending_me" });
}

// GET /api/friends — друзья (accepted) + входящие/исходящие pending. Приватность: полный DTO
// ТОЛЬКО для accepted; pending остаётся анонимным {publicId, nickname}.
export async function GET(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();

  const admin = supabaseAdmin();
  const me = await myProfileCore(admin, uid);
  if (!me) return Response.json({ friends: [], incoming: [], outgoing: [] });

  const { data: rows } = await admin
    .from("Friendship")
    .select("loId,hiId,requestedById,status,acceptedAt")
    .or(`loId.eq.${me.id},hiId.eq.${me.id}`);
  const list = (rows ?? []) as FriendshipRow[];
  if (!list.length) return Response.json({ friends: [], incoming: [], outgoing: [] });

  // Батч-подтяжка профилей собеседников.
  const peerIds = list.map((r) => (r.loId === me.id ? r.hiId : r.loId));
  const { data: profs } = await admin
    .from("Profile")
    .select("id,publicId,nickname,firstName,lastName,avatarUrl,ageBand,realGender,online,lastSeen")
    .in("id", peerIds);
  const byId = new Map<string, Record<string, unknown>>();
  for (const p of (profs ?? []) as Array<{ id: string }>) byId.set(p.id, p as Record<string, unknown>);

  // Непрочитанные сообщения на друга (сигнал «пришло сообщение», когда чат закрыт).
  // Friend-Conversation'ы с моим участием → сообщения от собеседника со status != read.
  const unreadByPeer = new Map<string, number>();
  const { data: convs } = await admin
    .from("Conversation")
    .select("id,profileAId,profileBId")
    .eq("kind", "friend")
    .or(`profileAId.eq.${me.id},profileBId.eq.${me.id}`);
  const convPeer = new Map<string, string>();
  for (const c of (convs ?? []) as Array<{ id: string; profileAId: string; profileBId: string }>) {
    convPeer.set(c.id, c.profileAId === me.id ? c.profileBId : c.profileAId);
  }
  const convIds = [...convPeer.keys()];
  if (convIds.length) {
    const { data: unreadRows } = await admin
      .from("Message")
      .select("conversationId")
      .in("conversationId", convIds)
      .neq("senderId", me.id)
      .neq("status", "read");
    for (const m of (unreadRows ?? []) as Array<{ conversationId: string }>) {
      const pid = convPeer.get(m.conversationId);
      if (pid) unreadByPeer.set(pid, (unreadByPeer.get(pid) ?? 0) + 1);
    }
  }

  const friends: unknown[] = [];
  const incoming: unknown[] = [];
  const outgoing: unknown[] = [];
  for (const r of list) {
    const peerId = r.loId === me.id ? r.hiId : r.loId;
    const p = byId.get(peerId);
    if (!p) continue;
    if (r.status === "accepted") {
      friends.push({
        publicId: p.publicId,
        nickname: p.nickname,
        firstName: p.firstName ?? null,
        lastName: p.lastName ?? null,
        avatarUrl: p.avatarUrl ?? null,
        ageBand: p.ageBand ?? null,
        realGender: p.realGender ?? null,
        online: p.online ?? false,
        lastSeen: p.lastSeen ?? null,
        acceptedAt: r.acceptedAt,
        unread: unreadByPeer.get(peerId) ?? 0,
      });
    } else {
      // pending — анонимно (без имени/фото до раскрытия).
      const dto = { publicId: p.publicId, nickname: p.nickname };
      if (r.requestedById === me.id) outgoing.push(dto);
      else incoming.push(dto);
    }
  }
  return Response.json({ friends, incoming, outgoing });
}
