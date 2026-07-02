import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

// Серверная логика бэкенда, co-located в web (Node route handlers, same-origin).
// Перенос из standalone backend/index.ts — тот же функционал, без отдельного хостинга/CORS.
// Привилегированные операции — через secret-ключ (bypass RLS). Идентичность юзера —
// валидация его Supabase JWT (admin.auth.getUser).

let client: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY не заданы");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

// uid из Authorization: Bearer <supabase access token>.
export async function getUid(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

// Провайдер-агностичная идентичность вызывающего (Google / email / anonymous).
// getUid оставлен как тонкий частный случай (только uid); getAuthUser нужен там,
// где важен провайдер/email/метаданные (создание аккаунта, префилл профиля).
export type AuthUser = {
  id: string;
  provider: string; // 'google' | 'apple' | 'email' | 'anonymous'
  email: string | null;
  meta: Record<string, unknown>; // supabase user_metadata (full_name/avatar_url для OAuth)
};

export async function getAuthUser(req: Request): Promise<AuthUser | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  const u = data.user;
  // Supabase: app_metadata.provider = 'google'|'apple'|'email'; аноним → is_anonymous.
  const raw = (u.app_metadata?.provider as string | undefined) ?? "";
  const provider = u.is_anonymous ? "anonymous" : raw || "email";
  return {
    id: u.id,
    provider,
    email: u.email ?? null,
    meta: (u.user_metadata ?? {}) as Record<string, unknown>,
  };
}

// --- Web Push (VAPID) ---
const PUSH_READY = Boolean(
  process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT,
);
if (PUSH_READY) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
}

// --- Rate-limit (in-memory sliding window) ---
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
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

type IdRow = { id: string } | null;

// Профиль вызывающего по Supabase uid — БЕЗ привязки к провайдеру (резолв по supabaseUserId,
// бэкфилленному из providerId миграцией accounts). Работает для google/email/anonymous.
export async function profileIdByUid(admin: SupabaseClient, uid: string): Promise<string | null> {
  const { data: user } = await admin.from("User").select("id").eq("supabaseUserId", uid).maybeSingle();
  const userId = (user as IdRow)?.id;
  if (!userId) return null;
  const { data: profile } = await admin.from("Profile").select("id").eq("userId", userId).maybeSingle();
  return (profile as IdRow)?.id ?? null;
}

// Тонкая обёртка над profileIdByUid — сохранена как имя, которым пользуется горячий путь
// (messages/media/report/rate/block). Для anon поведение идентично старому: если по
// supabaseUserId не нашли (бэкфилл пропущен / переходный период) — падаем на legacy-резолв
// по (provider='anonymous', providerId=uid), точь-в-точь как раньше (risk #3).
export async function myProfileId(admin: SupabaseClient, uid: string): Promise<string | null> {
  const byUid = await profileIdByUid(admin, uid);
  if (byUid) return byUid;
  const { data: user } = await admin.from("User").select("id").eq("provider", "anonymous").eq("providerId", uid).maybeSingle();
  const userId = (user as IdRow)?.id;
  if (!userId) return null;
  const { data: profile } = await admin.from("Profile").select("id").eq("userId", userId).maybeSingle();
  return (profile as IdRow)?.id ?? null;
}

export async function profileIdByPublic(admin: SupabaseClient, publicId: string): Promise<string | null> {
  const { data } = await admin.from("Profile").select("id").eq("publicId", publicId).maybeSingle();
  return (data as IdRow)?.id ?? null;
}

// --- Друзья / раскрытие (T3) ---
// ВАЖНО: id-пространства не путать. Profile.id (cuid) — внутренний PK и loId/hiId Friendship.
// publicId ("00001") — человекочитаемый #ID, по нему канонический порядок пары (строковое
// сравнение == числовое, т.к. zero-padded). Клиент оперирует ТОЛЬКО publicId.
export type ProfileCore = { id: string; publicId: string };

export async function profileCoreByPublic(admin: SupabaseClient, publicId: string): Promise<ProfileCore | null> {
  const { data } = await admin.from("Profile").select("id,publicId").eq("publicId", publicId).maybeSingle();
  return (data as ProfileCore | null) ?? null;
}

export async function myProfileCore(admin: SupabaseClient, uid: string): Promise<ProfileCore | null> {
  const id = await myProfileId(admin, uid);
  if (!id) return null;
  const { data } = await admin.from("Profile").select("id,publicId").eq("id", id).maybeSingle();
  return (data as ProfileCore | null) ?? null;
}

// Канонический порядок пары: lo = меньший publicId. Одна строка Friendship на пару в любом
// направлении (защищено @@unique([loId,hiId]) + partial unique лички).
export function canonicalPair(a: ProfileCore, b: ProfileCore): { loId: string; hiId: string } {
  return a.publicId < b.publicId ? { loId: a.id, hiId: b.id } : { loId: b.id, hiId: a.id };
}

export type FriendStatus = "none" | "pending_me" | "pending_peer" | "accepted";

// Статус связи с точки зрения `me` (для кнопки в чате/поиске/гидрации).
export async function friendStatusBetween(admin: SupabaseClient, me: ProfileCore, peer: ProfileCore): Promise<FriendStatus> {
  const { loId, hiId } = canonicalPair(me, peer);
  const { data } = await admin.from("Friendship").select("status,requestedById").eq("loId", loId).eq("hiId", hiId).maybeSingle();
  const row = data as { status: string; requestedById: string } | null;
  if (!row) return "none";
  if (row.status === "accepted") return "accepted";
  return row.requestedById === me.id ? "pending_me" : "pending_peer";
}

export type ActiveBan = { reason: string; expiresAt: string | null };

// Активный бан профиля (или null). Ленивое истечение: просроченный временный бан
// помечаем expired и считаем снятым (без крона).
export async function activeBan(admin: SupabaseClient, profileId: string): Promise<ActiveBan | null> {
  const { data } = await admin
    .from("Ban")
    .select("id,reason,expiresAt")
    .eq("profileId", profileId)
    .eq("state", "active")
    .order("createdAt", { ascending: false })
    .limit(1);
  const ban = (data ?? [])[0] as { id: string; reason: string; expiresAt: string | null } | undefined;
  if (!ban) return null;
  if (ban.expiresAt && new Date(ban.expiresAt).getTime() <= Date.now()) {
    await admin.from("Ban").update({ state: "expired" }).eq("id", ban.id);
    return null;
  }
  return { reason: ban.reason, expiresAt: ban.expiresAt };
}

export type ActiveMute = { reason: string | null; until: string };

// Активный мут профиля (или null). Мягче бана: запрет только на отправку. Ленивое истечение:
// просроченный мут чистим (mutedUntil→null).
export async function activeMute(admin: SupabaseClient, profileId: string): Promise<ActiveMute | null> {
  const { data } = await admin.from("Profile").select("mutedUntil,muteReason").eq("id", profileId).maybeSingle();
  const row = data as { mutedUntil: string | null; muteReason: string | null } | null;
  if (!row?.mutedUntil) return null;
  if (new Date(row.mutedUntil).getTime() <= Date.now()) {
    await admin.from("Profile").update({ mutedUntil: null, muteReason: null }).eq("id", profileId);
    return null;
  }
  return { reason: row.muteReason, until: row.mutedUntil };
}

export type ConversationKind = "roulette" | "friend";

// Найти-или-создать диалог заданного kind по каноническому порядку пары (a=min,b=max).
// kind учитывается и в поиске, и во вставке → рулетка и личка одной пары не смешиваются;
// у лички это совпадает с partial unique index (kind='friend'). ВНИМАНИЕ (deploy-safety):
// это по-прежнему find-or-create ДЛЯ ОБОИХ kind. Полностью эфемерная рулетка (новая
// Conversation на матч, risk #8) активируется в T6 ВМЕСТЕ с правкой messages route
// (клиент шлёт conversationId матча) через createRouletteConversation ниже. Сейчас messages
// зовёт per-message — insert-always здесь создал бы дубликаты и сломал GET-историю (maybeSingle).
export async function findOrCreateConversation(
  admin: SupabaseClient,
  p1: string,
  p2: string,
  kind: ConversationKind = "roulette",
): Promise<string | null> {
  const [a, b] = [p1, p2].sort();
  const { data: existing } = await admin
    .from("Conversation")
    .select("id")
    .eq("profileAId", a)
    .eq("profileBId", b)
    .eq("kind", kind)
    .maybeSingle();
  if ((existing as IdRow)?.id) return (existing as IdRow)!.id;
  const { data: created, error } = await admin
    .from("Conversation")
    .insert({ id: crypto.randomUUID(), profileAId: a, profileBId: b, kind })
    .select("id")
    .single();
  if (error) return null;
  return (created as IdRow)!.id;
}

// T6: рулетка эфемерна — новая Conversation на КАЖДЫЙ матч (пару НЕ переиспользуем, иначе
// старая переписка всплывёт и деанонимизирует). Вызывать на СТАРТЕ матча; messages route
// затем пишет по conversationId этого матча. НЕ использовать в per-message пути.
export async function createRouletteConversation(admin: SupabaseClient, p1: string, p2: string): Promise<string | null> {
  const [a, b] = [p1, p2].sort();
  const { data, error } = await admin
    .from("Conversation")
    .insert({ id: crypto.randomUUID(), profileAId: a, profileBId: b, kind: "roulette" })
    .select("id")
    .single();
  if (error) return null;
  return (data as IdRow)!.id;
}

export const KIND_MAP: Record<string, string> = { text: "text", image: "image", video: "video", voice: "audio" };
export const KIND_MAP_OUT: Record<string, string> = { text: "text", image: "image", video: "video", audio: "voice" };
export const REASON_MAP: Record<string, string> = {
  spam: "spam",
  harassment: "abuse",
  explicit: "sexual",
  underage: "illegal",
  scam: "other",
  other: "other",
};

// Массовая рассылка push всем / по полу (админская). gender: all | male | female.
export async function broadcastPush(
  admin: SupabaseClient,
  gender: "all" | "male" | "female",
  payload: object,
): Promise<{ sent: number; total: number }> {
  if (!PUSH_READY) return { sent: 0, total: 0 };

  let profileIds: string[] | null = null;
  if (gender !== "all") {
    const { data } = await admin.from("Profile").select("id").eq("realGender", gender);
    profileIds = ((data ?? []) as Array<{ id: string }>).map((p) => p.id);
    if (profileIds.length === 0) return { sent: 0, total: 0 };
  }

  let q = admin.from("PushSubscription").select("id,endpoint,p256dh,auth");
  if (profileIds) q = q.in("profileId", profileIds);
  const { data: subs } = await q;
  const list = (subs ?? []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    list.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) await admin.from("PushSubscription").delete().eq("id", s.id);
      }
    }),
  );
  return { sent, total: list.length };
}

export async function pushToProfile(admin: SupabaseClient, profileId: string, payload: object): Promise<void> {
  if (!PUSH_READY) return;
  const { data: subs } = await admin.from("PushSubscription").select("id,endpoint,p256dh,auth").eq("profileId", profileId);
  const list = (subs ?? []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;
  const body = JSON.stringify(payload);
  await Promise.all(
    list.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) await admin.from("PushSubscription").delete().eq("id", s.id);
      }
    }),
  );
}

export function unauthorized(): Response {
  return Response.json({ error: "no user" }, { status: 401 });
}
