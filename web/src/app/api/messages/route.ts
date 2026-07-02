import {
  activeBan,
  activeMute,
  findOrCreateConversation,
  friendStatusBetween,
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Эфемерная рулетка (risk #8): клиент шлёт conversationId текущего матча. Резолвим ИМЕННО эту
// Conversation (не «последнюю по паре») → новый матч = чистая сессия, старая переписка не всплывает.
// Защита: чужой/friend id или id другой пары НЕ используем (создать/писать можно только в свою
// roulette-Conversation этой пары); иначе фолбэк на find-or-create (совместимость со старым клиентом).
async function resolveRouletteConvId(
  admin: ReturnType<typeof supabaseAdmin>,
  senderId: string,
  peerId: string,
  conversationId: string | null,
): Promise<string | null> {
  const [a, b] = [senderId, peerId].sort();
  if (conversationId && UUID_RE.test(conversationId)) {
    const { data } = await admin
      .from("Conversation").select("id,profileAId,profileBId,kind").eq("id", conversationId).maybeSingle();
    const ex = data as { id: string; profileAId: string; profileBId: string; kind: string } | null;
    if (ex) {
      if (ex.kind === "roulette" && ex.profileAId === a && ex.profileBId === b) return ex.id;
    } else {
      const { data: created, error } = await admin
        .from("Conversation").insert({ id: conversationId, profileAId: a, profileBId: b, kind: "roulette" }).select("id").single();
      if (!error && created) return (created as { id: string }).id;
      // Гонка двух первых сообщений: строку с этим id уже создала другая сторона → перечитываем ПО ID
      // (не по паре — иначе maybeSingle упал бы, если у пары есть и старая pre-INT roulette-conv).
      const { data: again } = await admin
        .from("Conversation").select("id,profileAId,profileBId,kind").eq("id", conversationId).maybeSingle();
      const r = again as { id: string; profileAId: string; profileBId: string; kind: string } | null;
      if (r && r.kind === "roulette" && r.profileAId === a && r.profileBId === b) return r.id;
    }
  }
  return findOrCreateConversation(admin, senderId, peerId, "roulette");
}

// POST /api/messages { peer, kind, text? } — persist сообщения.
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  if (!rateLimit(`msg:${uid}`, 30, 10_000)) return Response.json({ error: "rate limited" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as {
    peer?: unknown;
    kind?: unknown;
    text?: unknown;
    mediaId?: unknown;
    id?: unknown;
    convKind?: unknown;
    conversationId?: unknown;
    once?: unknown;
  };
  const peer = typeof body.peer === "string" ? body.peer : "";
  const kind = KIND_MAP[typeof body.kind === "string" ? body.kind : "text"] ?? "text";
  // convKind = тип диалога (личка/рулетка), отдельно от message-kind. Дефолт roulette → совместимо.
  const convKind = body.convKind === "friend" ? "friend" : "roulette";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  const once = body.once === true; // одноразовое (view-once) медиа
  const text = typeof body.text === "string" ? body.text.slice(0, 4000) : null;
  const mediaId = typeof body.mediaId === "string" ? body.mediaId : null;
  // Клиентский id (UUID) → БД пишет его же, чтобы broadcast/local/история имели общий id.
  const msgId = typeof body.id === "string" && UUID_RE.test(body.id) ? body.id : crypto.randomUUID();
  if (!peer) return Response.json({ error: "peer required" }, { status: 400 });

  const admin = supabaseAdmin();
  const [senderId, peerId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
  if (!senderId || !peerId) return Response.json({ error: "profile not found" }, { status: 404 });

  // Забаненный не может отправлять сообщения.
  const ban = await activeBan(admin, senderId);
  if (ban) return Response.json({ error: "banned", reason: ban.reason, until: ban.expiresAt }, { status: 403 });

  // Замьюченный не может отправлять (но может читать) — до mutedUntil.
  const mute = await activeMute(admin, senderId);
  if (mute) return Response.json({ error: "muted", reason: mute.reason, until: mute.until }, { status: 403 });

  // Гейт лички: писать в friend-диалог можно ТОЛЬКО принятому другу. Иначе кто угодно создал бы
  // friend-Conversation перебором #ID. (unfriend удаляет Friendship → доступ к личке закрывается.)
  if (convKind === "friend") {
    const { data: myProf } = await admin.from("Profile").select("publicId").eq("id", senderId).maybeSingle();
    const myPublicId = (myProf as { publicId?: string } | null)?.publicId;
    const status = myPublicId
      ? await friendStatusBetween(admin, { id: senderId, publicId: myPublicId }, { id: peerId, publicId: peer })
      : "none";
    if (status !== "accepted") return Response.json({ error: "not friends" }, { status: 403 });
  }

  // Рулетка: скоуп по conversationId матча (эфемерная сессия). Личка: одна на пару (canonical).
  const convId =
    convKind === "roulette"
      ? await resolveRouletteConvId(admin, senderId, peerId, conversationId)
      : await findOrCreateConversation(admin, senderId, peerId, "friend");
  if (!convId) return Response.json({ error: "conversation failed" }, { status: 400 });

  // upsert по id: повторный persist того же клиентского id (ретрай/двойная отправка) не дублирует.
  const { data: msg, error } = await admin
    .from("Message")
    .upsert({ id: msgId, conversationId: convId, senderId, kind, text, mediaId, once, status: "sent" }, { onConflict: "id", ignoreDuplicates: true })
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
  const url = new URL(req.url);
  const peer = url.searchParams.get("peer") ?? "";
  const convKind = url.searchParams.get("convKind") === "friend" ? "friend" : "roulette";
  const conversationId = url.searchParams.get("conversationId");
  if (!peer) return Response.json({ error: "peer required" }, { status: 400 });

  const admin = supabaseAdmin();
  const [senderId, peerId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
  if (!senderId || !peerId) return Response.json({ messages: [], ended: false, friend: { status: "none" } });

  // Статус дружбы — нужен для гидрации и для гейта лички.
  const { data: myProfRow } = await admin.from("Profile").select("publicId").eq("id", senderId).maybeSingle();
  const myPublicId = (myProfRow as { publicId?: string } | null)?.publicId;
  const friendStatus = myPublicId
    ? await friendStatusBetween(admin, { id: senderId, publicId: myPublicId }, { id: peerId, publicId: peer })
    : "none";

  // Гейт лички: историю friend-диалога отдаём ТОЛЬКО принятому другу (unfriend → доступ закрыт).
  if (convKind === "friend" && friendStatus !== "accepted") {
    return Response.json({ messages: [], ended: false, friend: { status: friendStatus } });
  }

  const [a, b] = [senderId, peerId].sort();
  // Эфемерная рулетка: если клиент дал conversationId матча — гидрируем ИМЕННО его (verify пара+kind),
  // чтобы reload mid-матча показал ту же сессию, а не «последнюю по паре».
  let convRow: { id: string; endedAt: string | null } | null = null;
  if (convKind === "roulette" && conversationId && UUID_RE.test(conversationId)) {
    const { data } = await admin
      .from("Conversation").select("id,endedAt,profileAId,profileBId,kind").eq("id", conversationId).maybeSingle();
    const r = data as { id: string; endedAt: string | null; profileAId: string; profileBId: string; kind: string } | null;
    if (r && r.kind === "roulette" && r.profileAId === a && r.profileBId === b) convRow = { id: r.id, endedAt: r.endedAt };
  } else {
    // Скоуп по kind: личка и рулетка одной пары — разные Conversation. Последняя по времени.
    const { data: convRows } = await admin
      .from("Conversation")
      .select("id,endedAt")
      .eq("profileAId", a)
      .eq("profileBId", b)
      .eq("kind", convKind)
      .order("createdAt", { ascending: false })
      .limit(1);
    convRow = ((convRows ?? []) as Array<{ id: string; endedAt: string | null }>)[0] ?? null;
  }
  const convId = convRow?.id;
  if (!convId) {
    return Response.json({ messages: [], ended: false, friend: { status: friendStatus } });
  }
  const ended = Boolean(convRow?.endedAt);
  const { data: rows } = await admin
    .from("Message").select("id,senderId,kind,text,mediaId,status,createdAt,reactions,once,viewedAt")
    .eq("conversationId", convId).order("createdAt", { ascending: true }).limit(200);
  const list = (rows ?? []) as Array<{
    id: string;
    senderId: string;
    kind: string;
    text: string | null;
    mediaId: string | null;
    status: string;
    createdAt: string;
    reactions: Record<string, string> | null;
    once: boolean;
    viewedAt: string | null;
  }>;

  // Одноразовое уже просмотрено → медиа «израсходовано»: НЕ отдаём путь (история на новом
  // устройстве не покажет фото/видео повторно; приватность-истина на сервере, не в localStorage).
  const isConsumed = (m: { once: boolean; viewedAt: string | null }) => m.once && m.viewedAt != null;

  // Пути медиа — вторым запросом (без PostgREST embed). Израсходованные one-view исключаем.
  const mediaIds = list.filter((m) => m.mediaId && !isConsumed(m)).map((m) => m.mediaId as string);
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
    mediaPath: m.mediaId && !isConsumed(m) ? pathById.get(m.mediaId) : undefined,
    status: m.status,
    at: new Date(m.createdAt).getTime(),
    reactions: m.reactions ?? undefined,
    once: m.once,
    viewed: m.viewedAt != null,
  }));

  // Гидрация раскрытия/дружбы (T3): reload/оффлайн-пир сразу видит верный статус (урок офлайна).
  // Обратная совместимость: старый клиент игнорит новые ключи friend/peer.
  let peerDto: Record<string, unknown> | undefined;
  if (friendStatus === "accepted") {
    const { data: pp } = await admin
      .from("Profile")
      .select("publicId,nickname,firstName,lastName,avatarUrl,ageBand,realGender,online,lastSeen")
      .eq("id", peerId)
      .maybeSingle();
    if (pp) peerDto = pp as Record<string, unknown>;
  }
  return Response.json({ messages, ended, friend: { status: friendStatus }, ...(peerDto ? { peer: peerDto } : {}) });
}
