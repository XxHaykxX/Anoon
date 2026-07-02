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

// --- Аккаунты: полный профиль вызывающего + сохранение расширенных полей ---

// Контракт с backend (T3): GET /api/profile/me → полный профиль вызывающего.
// gender = realGender (male|female|any); genderLocked=true после выбора при регистрации.
export type FullProfileDTO = {
  publicId: string;
  nickname: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  ageBand?: string | null;
  gender?: string | null;
  genderLocked?: boolean;
};

// null = сессии нет / профиль ещё не создан (эндпоинт вернул не-2xx). Не бросаем — гидрация мягкая.
export async function fetchMyProfile(accessToken: string): Promise<FullProfileDTO | null> {
  const res = await fetch(`${BASE}/profile/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export type CompleteProfileFields = {
  nickname?: string;
  firstName: string;
  lastName?: string;
  avatarUrl?: string;
  gender: "male" | "female";
  ageBand?: string;
};

// POST /api/profile с расширенным телом. 409 = попытка сменить залоченный пол.
export class ProfileConflictError extends Error {}
export async function completeProfile(
  fields: CompleteProfileFields,
  accessToken: string,
): Promise<ProfileDTO> {
  const res = await post("/profile", fields, accessToken);
  if (res.status === 409) throw new ProfileConflictError("gender locked");
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`profile save failed: ${res.status} ${msg}`);
  }
  return res.json();
}

// --- Раскрытие/друзья (T5): персист-путь (работает и без активного realtime-канала) ---

export type FriendStatus = "none" | "pending_me" | "pending_peer" | "accepted";

// Полный профиль собеседника — отдаётся сервером ТОЛЬКО принятому другу (иначе анонимный
// минимум {publicId,nickname}). Единственный доверенный источник личности — НИКОГДА не берём
// её из realtime-payload (см. store/chat.ts::onFriendAccept — подделка канала иначе раскрыла бы имя).
export type PeerProfileDTO = {
  publicId: string;
  nickname: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  ageBand?: string | null;
  realGender?: string | null;
  online?: boolean;
  lastSeen?: string | null;
};

// Отправить запрос на раскрытие профилей.
export async function addFriend(peerPublicId: string, accessToken: string): Promise<FriendStatus> {
  const res = await post("/friends", { peerPublicId }, accessToken);
  if (!res.ok) throw new Error(`addFriend failed: ${res.status}`);
  const data = (await res.json()) as { status?: FriendStatus };
  return data.status ?? "pending_me";
}

// Принять/отклонить входящий запрос. Отвечать может только не-заявитель (проверка на сервере).
export async function respondFriend(
  requesterPublicId: string,
  action: "accept" | "decline",
  accessToken: string,
): Promise<FriendStatus> {
  const res = await post("/friends/respond", { requesterPublicId, action }, accessToken);
  if (!res.ok) throw new Error(`respondFriend failed: ${res.status}`);
  const data = (await res.json()) as { status?: FriendStatus };
  return data.status ?? "none";
}

export async function removeFriend(peerPublicId: string, accessToken: string): Promise<void> {
  await post("/friends/remove", { peerPublicId }, accessToken).catch(() => {});
}

// Гидрация кнопки раскрытия после reload (когда история диалога ещё не пришла/для поиска).
export async function friendStatus(peer: string, accessToken: string): Promise<FriendStatus> {
  const res = await fetch(`${BASE}/friends/status?peer=${encodeURIComponent(peer)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "none";
  const data = (await res.json()) as { status?: FriendStatus };
  return data.status ?? "none";
}

// Список друзей/заявок. friends — accepted (полный DTO); incoming/outgoing — pending (анонимно).
export type FriendDTO = PeerProfileDTO & { acceptedAt?: string | null };
export type PendingDTO = { publicId: string; nickname: string };

export async function fetchFriends(
  accessToken: string,
): Promise<{ friends: FriendDTO[]; incoming: PendingDTO[]; outgoing: PendingDTO[] }> {
  const res = await fetch(`${BASE}/friends`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return { friends: [], incoming: [], outgoing: [] };
  const data = (await res.json()) as { friends?: FriendDTO[]; incoming?: PendingDTO[]; outgoing?: PendingDTO[] };
  return { friends: data.friends ?? [], incoming: data.incoming ?? [], outgoing: data.outgoing ?? [] };
}

export type SearchHit = { publicId: string; nickname: string; status: FriendStatus };

export async function searchUsers(q: string, accessToken: string): Promise<SearchHit[]> {
  const res = await fetch(`${BASE}/users/search?q=${encodeURIComponent(q)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: SearchHit[] };
  return data.results ?? [];
}

// Ре-фетч личности после friend_accept (сервер перепроверяет Friendship.accepted) — единственный
// путь, которым клиент вправе рендерить имя/фото собеседника.
export async function fetchProfile(
  publicId: string,
  accessToken: string,
): Promise<{ profile: PeerProfileDTO; status: FriendStatus } | null> {
  const res = await fetch(`${BASE}/profile/${encodeURIComponent(publicId)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
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
  reactions?: Record<string, string>; // T10: publicId → emoji (только личка)
  once?: boolean; // ONCE-SERVER (#24): одноразовое медиа — источник истины теперь сервер
  viewed?: boolean; // true = уже просмотрено (сервер); у consumed once — mediaPath отсутствует
};

// Тип диалога (личка vs рулетка). Отдельно от message-kind (text/image/…), поэтому в теле
// поле называется convKind. Дефолт на бэкенде — roulette (полная обратная совместимость).
export type ConvKind = "roulette" | "friend";

// Persist отправленного сообщения в БД. Best-effort (не блокирует realtime-транспорт).
// once — одноразовое медиа (ONCE-SERVER #24): сервер хранит флаг, чтобы «просмотрено» пережило
// новое устройство/очистку localStorage (см. store/chat.ts::mergeHistory).
export async function persistMessage(
  peer: string,
  kind: string,
  text: string | undefined,
  accessToken: string,
  mediaId?: string,
  clientId?: string, // тот же id, что в broadcast/local — БД пишет его же → merge без дублей
  convKind: ConvKind = "roulette",
  conversationId?: string, // эфемерная рулетка: конкретная Conversation текущего матча
  once = false,
): Promise<{ id: string; at: string } | null> {
  const res = await post("/messages", { peer, kind, text, mediaId, id: clientId, convKind, conversationId, once }, accessToken);
  if (!res.ok) return null;
  return res.json();
}

// Пометить одноразовое сообщение просмотренным (ONCE-SERVER #24). ТОЛЬКО получатель может
// пометить (сервер проверяет и перепроверяет) — идемпотентно, повторный вызов не ошибка.
export async function viewMessage(messageId: string, accessToken: string): Promise<void> {
  await post("/messages/view", { id: messageId }, accessToken).catch(() => {});
}

// История диалога из БД (для нового устройства / после очистки localStorage).
// ended — диалог завершён (Conversation.endedAt) кем-либо из участников.
// friend/peer — гидрация раскрытия (T3): reload/оффлайн-пир сразу видит верный статус.
export async function fetchHistory(
  peer: string,
  accessToken: string,
  convKind: ConvKind = "roulette",
  conversationId?: string, // эфемерная рулетка: гидрируем конкретную сессию матча (reload mid-матча)
): Promise<{ messages: HistoryMsg[]; ended: boolean; friend: { status: FriendStatus }; peer?: PeerProfileDTO }> {
  const cidParam = conversationId ? `&conversationId=${encodeURIComponent(conversationId)}` : "";
  const res = await fetch(`${BASE}/messages?peer=${encodeURIComponent(peer)}&convKind=${convKind}${cidParam}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { messages: [], ended: false, friend: { status: "none" } };
  const data = (await res.json()) as {
    messages?: HistoryMsg[];
    ended?: boolean;
    friend?: { status: FriendStatus };
    peer?: PeerProfileDTO;
  };
  return {
    messages: data.messages ?? [],
    ended: Boolean(data.ended),
    friend: data.friend ?? { status: "none" },
    peer: data.peer,
  };
}

// Завершить диалог (persist Conversation.endedAt). Best-effort.
export async function endConversation(peer: string, accessToken: string): Promise<void> {
  await post("/messages/end", { peer }, accessToken).catch(() => {});
}

// Отметить сообщения собеседника прочитанными.
export async function markRead(peer: string, accessToken: string, convKind: ConvKind = "roulette", conversationId?: string): Promise<void> {
  await post("/messages/read", { peer, convKind, conversationId }, accessToken).catch(() => {});
}

// Реакция на сообщение (T10, только личка друзей). emoji=null снимает свою реакцию.
// Сервер мерджит по своему publicId (нельзя подделать чужую) и проверяет, что диалог kind=friend.
export async function reactMessage(messageId: string, emoji: string | null, accessToken: string): Promise<void> {
  await post("/messages/react", { messageId, emoji }, accessToken).catch(() => {});
}

// Сохранить/удалить push-подписку на бэкенде.
export async function savePushSubscription(sub: PushSubscriptionJSON, accessToken: string): Promise<void> {
  await post("/push/subscribe", sub, accessToken).catch(() => {});
}

export async function deletePushSubscription(endpoint: string, accessToken: string): Promise<void> {
  await del("/push/subscribe", { endpoint }, accessToken).catch(() => {});
}
