import { withSupabase } from "@supabase/server";
import webpush from "web-push";

// anoon backend v2 — fetch-handler, обёрнутый withSupabase (auth: "user").
// ctx.supabase — RLS-scoped (JWT юзера); ctx.supabaseAdmin — bypass RLS (привилегированно).
// ctx.userClaims.id — Supabase auth uuid (аноним-юзер).

type IdRow = { id: string } | null;
type ProfileRow = { id: string; publicId: string; nickname: string } | null;

// --- Web Push (VAPID) ---
// Инициализируем один раз при загрузке модуля, если ключи заданы. Без ключей рассылка
// молча пропускается (dev без push).
const PUSH_READY = Boolean(
  process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT,
);
if (PUSH_READY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

// --- Rate-limit (in-memory sliding window per uid+route) ---
// Достаточно для одного инстанса; на кластере заменить на Redis/БД-счётчик.
const hits = new Map<string, number[]>();
function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

async function nextPublicId(admin: { from: (t: string) => any }): Promise<string> {
  // 5-значный #ID: следующий по счётчику профилей (гонки маловероятны на текущем масштабе;
  // уникальность страхует @unique на Profile.publicId). TODO(prod): sequence в БД.
  const { count } = await admin.from("Profile").select("*", { count: "exact", head: true });
  return String((count ?? 0) + 1).padStart(5, "0");
}

// Profile.id текущего юзера по auth uuid (через User.providerId).
async function myProfileId(admin: any, uid: string): Promise<string | null> {
  const { data: user } = await admin.from("User").select("id").eq("provider", "anonymous").eq("providerId", uid).maybeSingle();
  const userId = (user as IdRow)?.id;
  if (!userId) return null;
  const { data: profile } = await admin.from("Profile").select("id").eq("userId", userId).maybeSingle();
  return (profile as IdRow)?.id ?? null;
}

// Profile.id по публичному #ID собеседника.
async function profileIdByPublic(admin: any, publicId: string): Promise<string | null> {
  const { data } = await admin.from("Profile").select("id").eq("publicId", publicId).maybeSingle();
  return (data as IdRow)?.id ?? null;
}

// Диалог между двумя профилями. Порядок нормализуем (сортировка id) → один канонический
// ряд, без дублей и без unique-констрейнта на пару.
async function findOrCreateConversation(admin: any, p1: string, p2: string): Promise<string | null> {
  const [a, b] = [p1, p2].sort();
  const { data: existing } = await admin
    .from("Conversation").select("id").eq("profileAId", a).eq("profileBId", b).maybeSingle();
  if ((existing as IdRow)?.id) return (existing as IdRow)!.id;
  const { data: created, error } = await admin
    .from("Conversation").insert({ profileAId: a, profileBId: b }).select("id").single();
  if (error) return null;
  return (created as IdRow)!.id;
}

// web-тип сообщения → enum MessageKind схемы (voice → audio).
const KIND_MAP: Record<string, string> = { text: "text", image: "image", video: "video", voice: "audio" };
const KIND_MAP_OUT: Record<string, string> = { text: "text", image: "image", video: "video", audio: "voice" };

// Причины жалобы web → enum ReportReason схемы.
const REASON_MAP: Record<string, string> = {
  spam: "spam",
  harassment: "abuse",
  explicit: "sexual",
  underage: "illegal",
  scam: "other",
  other: "other",
};

// Отправить push всем подпискам профиля. Мёртвые подписки (404/410) удаляет.
async function pushToProfile(admin: any, profileId: string, payload: object): Promise<void> {
  if (!PUSH_READY) return;
  const { data: subs } = await admin
    .from("PushSubscription").select("id,endpoint,p256dh,auth").eq("profileId", profileId);
  const list = (subs ?? []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;
  const body = JSON.stringify(payload);
  await Promise.all(
    list.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
      } catch (err: any) {
        // 404/410 — подписка мертва, чистим.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from("PushSubscription").delete().eq("id", s.id);
        }
      }
    }),
  );
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req: Request, ctx: any) => {
    const url = new URL(req.url);
    const uid: string | undefined = ctx.userClaims?.id;
    if (!uid) return Response.json({ error: "no user" }, { status: 401 });

    // Апсерт профиля текущего анонимного юзера (ник+#ID).
    if (req.method === "POST" && url.pathname === "/profile") {
      const body = (await req.json().catch(() => ({}))) as { nickname?: unknown };
      const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
      if (nickname.length < 2) return Response.json({ error: "nickname required (>=2)" }, { status: 400 });

      const admin = ctx.supabaseAdmin;

      // User (provider=anonymous, providerId=auth uuid)
      const { data: existingUser } = await admin
        .from("User").select("id").eq("provider", "anonymous").eq("providerId", uid).maybeSingle();
      let userId = (existingUser as IdRow)?.id;
      if (!userId) {
        const { data: newUser, error } = await admin
          .from("User").insert({ provider: "anonymous", providerId: uid }).select("id").single();
        if (error) return Response.json({ error: error.message }, { status: 400 });
        userId = (newUser as IdRow)!.id;
      }

      // Profile
      const { data: existing } = await admin
        .from("Profile").select("id,publicId,nickname").eq("userId", userId).maybeSingle();
      const ex = existing as ProfileRow;
      if (ex) {
        if (ex.nickname !== nickname) {
          await admin.from("Profile").update({ nickname }).eq("id", ex.id);
        }
        return Response.json({ id: ex.id, publicId: ex.publicId, nickname });
      }

      const publicId = await nextPublicId(admin);
      const { data: created, error: perr } = await admin
        .from("Profile").insert({ userId, publicId, nickname, online: true })
        .select("id,publicId,nickname").single();
      if (perr) return Response.json({ error: perr.message }, { status: 400 });
      return Response.json(created);
    }

    // Persist сообщения: POST /messages { peer: publicId, kind, text?, at? }
    if (req.method === "POST" && url.pathname === "/messages") {
      if (!rateLimit(`msg:${uid}`, 30, 10_000)) return Response.json({ error: "rate limited" }, { status: 429 });
      const body = (await req.json().catch(() => ({}))) as { peer?: unknown; kind?: unknown; text?: unknown };
      const peer = typeof body.peer === "string" ? body.peer : "";
      const kind = KIND_MAP[typeof body.kind === "string" ? body.kind : "text"] ?? "text";
      const text = typeof body.text === "string" ? body.text.slice(0, 4000) : null;
      if (!peer) return Response.json({ error: "peer required" }, { status: 400 });
      const admin = ctx.supabaseAdmin;
      const [senderId, peerId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
      if (!senderId || !peerId) return Response.json({ error: "profile not found" }, { status: 404 });

      const convId = await findOrCreateConversation(admin, senderId, peerId);
      if (!convId) return Response.json({ error: "conversation failed" }, { status: 400 });

      const { data: msg, error } = await admin
        .from("Message").insert({ conversationId: convId, senderId, kind, text, status: "sent" })
        .select("id,createdAt").single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      await admin.from("Conversation").update({ lastMessageAt: new Date().toISOString() }).eq("id", convId);

      // Если получатель офлайн — шлём push (best-effort).
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

    // История диалога: GET /messages?peer=publicId
    if (req.method === "GET" && url.pathname === "/messages") {
      const peer = url.searchParams.get("peer") ?? "";
      if (!peer) return Response.json({ error: "peer required" }, { status: 400 });
      const admin = ctx.supabaseAdmin;
      const [senderId, peerId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
      if (!senderId || !peerId) return Response.json({ messages: [] });
      const [a, b] = [senderId, peerId].sort();
      const { data: conv } = await admin
        .from("Conversation").select("id").eq("profileAId", a).eq("profileBId", b).maybeSingle();
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

    // Отметить сообщения собеседника прочитанными: POST /messages/read { peer }
    if (req.method === "POST" && url.pathname === "/messages/read") {
      const body = (await req.json().catch(() => ({}))) as { peer?: unknown };
      const peer = typeof body.peer === "string" ? body.peer : "";
      if (!peer) return Response.json({ error: "peer required" }, { status: 400 });
      const admin = ctx.supabaseAdmin;
      const [meId, peerId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
      if (!meId || !peerId) return Response.json({ ok: true });
      const [a, b] = [meId, peerId].sort();
      const { data: conv } = await admin
        .from("Conversation").select("id").eq("profileAId", a).eq("profileBId", b).maybeSingle();
      const convId = (conv as IdRow)?.id;
      if (!convId) return Response.json({ ok: true });
      // Прочитаны сообщения, отправленные собеседником (senderId=peerId), ещё не read.
      await admin.from("Message").update({ status: "read" })
        .eq("conversationId", convId).eq("senderId", peerId).neq("status", "read");
      return Response.json({ ok: true });
    }

    // Push-подписка: POST /push/subscribe { endpoint, keys: { p256dh, auth } }
    if (req.method === "POST" && url.pathname === "/push/subscribe") {
      const body = (await req.json().catch(() => ({}))) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
      const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
      const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
      const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";
      if (!endpoint || !p256dh || !auth) return Response.json({ error: "invalid subscription" }, { status: 400 });
      const admin = ctx.supabaseAdmin;
      const profileId = await myProfileId(admin, uid);
      if (!profileId) return Response.json({ error: "profile not found" }, { status: 404 });
      const { error } = await admin
        .from("PushSubscription").upsert({ profileId, endpoint, p256dh, auth }, { onConflict: "endpoint" });
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ ok: true });
    }

    // Отписка: DELETE /push/subscribe { endpoint }
    if (req.method === "DELETE" && url.pathname === "/push/subscribe") {
      const body = (await req.json().catch(() => ({}))) as { endpoint?: unknown };
      const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
      if (!endpoint) return Response.json({ error: "endpoint required" }, { status: 400 });
      await ctx.supabaseAdmin.from("PushSubscription").delete().eq("endpoint", endpoint);
      return Response.json({ ok: true });
    }

    // Блокировка собеседника: POST /block { peer: publicId }
    if (req.method === "POST" && url.pathname === "/block") {
      if (!rateLimit(`block:${uid}`, 20, 60_000)) return Response.json({ error: "rate limited" }, { status: 429 });
      const body = (await req.json().catch(() => ({}))) as { peer?: unknown };
      const peer = typeof body.peer === "string" ? body.peer : "";
      if (!peer) return Response.json({ error: "peer required" }, { status: 400 });
      const admin = ctx.supabaseAdmin;
      const [blockerId, blockedId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
      if (!blockerId || !blockedId) return Response.json({ error: "profile not found" }, { status: 404 });
      // upsert по уникальному (blockerId, blockedId) — повтор не дублирует.
      const { error } = await admin.from("Block").upsert({ blockerId, blockedId }, { onConflict: "blockerId,blockedId" });
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ ok: true });
    }

    // Жалоба: POST /report { peer: publicId, reason, comment? }
    if (req.method === "POST" && url.pathname === "/report") {
      if (!rateLimit(`report:${uid}`, 10, 60_000)) return Response.json({ error: "rate limited" }, { status: 429 });
      const body = (await req.json().catch(() => ({}))) as { peer?: unknown; reason?: unknown; comment?: unknown };
      const peer = typeof body.peer === "string" ? body.peer : "";
      const reason = REASON_MAP[typeof body.reason === "string" ? body.reason : "other"] ?? "other";
      const note = typeof body.comment === "string" ? body.comment.slice(0, 280) : null;
      if (!peer) return Response.json({ error: "peer required" }, { status: 400 });
      const admin = ctx.supabaseAdmin;
      const [reporterId, targetProfileId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
      if (!reporterId || !targetProfileId) return Response.json({ error: "profile not found" }, { status: 404 });
      const { error } = await admin.from("Report").insert({ reporterId, targetProfileId, reason, note, status: "open" });
      if (error) return Response.json({ error: error.message }, { status: 400 });
      // денормализованный reportCount на цель (для админ-очереди). TODO(prod): атомарный RPC.
      const { data: prof } = await admin.from("Profile").select("reportCount").eq("id", targetProfileId).single();
      await admin.from("Profile").update({ reportCount: ((prof as { reportCount?: number } | null)?.reportCount ?? 0) + 1 }).eq("id", targetProfileId);
      return Response.json({ ok: true });
    }

    // GET / — профили для discovery (под RLS user-клиента).
    const { data, error } = await ctx.supabase.from("Profile").select("publicId,nickname,online");
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ profiles: data });
  }),
};
