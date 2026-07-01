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

export async function myProfileId(admin: SupabaseClient, uid: string): Promise<string | null> {
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

export async function findOrCreateConversation(admin: SupabaseClient, p1: string, p2: string): Promise<string | null> {
  const [a, b] = [p1, p2].sort();
  const { data: existing } = await admin.from("Conversation").select("id").eq("profileAId", a).eq("profileBId", b).maybeSingle();
  if ((existing as IdRow)?.id) return (existing as IdRow)!.id;
  const { data: created, error } = await admin.from("Conversation").insert({ id: crypto.randomUUID(), profileAId: a, profileBId: b }).select("id").single();
  if (error) return null;
  return (created as IdRow)!.id;
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
