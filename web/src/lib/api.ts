"use client";

// Вызовы серверных route handlers (web/app/api/*, same-origin). Токен — anon JWT из
// Supabase-сессии. Backend co-located в web (нет отдельного хоста/CORS).
const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api";

export type ProfileDTO = { id: string; publicId: string; nickname: string };

async function post(path: string, body: unknown, accessToken: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

async function del(path: string, body: unknown, accessToken: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

export async function upsertProfile(nickname: string, accessToken: string): Promise<ProfileDTO> {
  const res = await post("/profile", { nickname }, accessToken);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`profile upsert failed: ${res.status} ${msg}`);
  }
  return res.json();
}

export async function sendBlock(peer: string, accessToken: string): Promise<void> {
  const res = await post("/block", { peer }, accessToken);
  if (!res.ok) throw new Error(`block failed: ${res.status}`);
}

export async function sendReport(peer: string, reason: string, comment: string | undefined, accessToken: string): Promise<void> {
  const res = await post("/report", { peer, reason, comment }, accessToken);
  if (!res.ok) throw new Error(`report failed: ${res.status}`);
}

// Оценка собеседника после чата (1..5). Best-effort.
export async function sendRating(peer: string, rating: number, accessToken: string): Promise<void> {
  await post("/rate", { peer, rating }, accessToken).catch(() => {});
}

// --- Сообщения (persist + история + статусы) ---

export type HistoryMsg = {
  id: string;
  mine: boolean;
  kind: "text" | "image" | "video" | "voice";
  text?: string;
  mediaPath?: string;
  status: "sent" | "delivered" | "read";
  at: number;
};

// Persist отправленного сообщения в БД. Best-effort (не блокирует realtime-транспорт).
export async function persistMessage(
  peer: string,
  kind: string,
  text: string | undefined,
  accessToken: string,
  mediaId?: string,
): Promise<{ id: string; at: string } | null> {
  const res = await post("/messages", { peer, kind, text, mediaId }, accessToken);
  if (!res.ok) return null;
  return res.json();
}

// История диалога из БД (для нового устройства / после очистки localStorage).
export async function fetchHistory(peer: string, accessToken: string): Promise<HistoryMsg[]> {
  const res = await fetch(`${BASE}/messages?peer=${encodeURIComponent(peer)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { messages?: HistoryMsg[] };
  return data.messages ?? [];
}

// Отметить сообщения собеседника прочитанными.
export async function markRead(peer: string, accessToken: string): Promise<void> {
  await post("/messages/read", { peer }, accessToken).catch(() => {});
}

// Сохранить/удалить push-подписку на бэкенде.
export async function savePushSubscription(sub: PushSubscriptionJSON, accessToken: string): Promise<void> {
  await post("/push/subscribe", sub, accessToken).catch(() => {});
}

export async function deletePushSubscription(endpoint: string, accessToken: string): Promise<void> {
  await del("/push/subscribe", { endpoint }, accessToken).catch(() => {});
}
