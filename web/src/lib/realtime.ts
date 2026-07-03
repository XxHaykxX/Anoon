"use client";

import { supabase } from "@/lib/supabase";

// Realtime через Supabase Broadcast/Presence. Работает на publishable-ключе (без auth):
// матчинг (lobby-presence) + канал диалога (broadcast сообщений/печати + presence онлайна).
// Медиа пока передаём метаданными; реальные файлы peer увидит после R2 (Фаза E).

export type WirePayload = {
  id: string;
  kind: "text" | "image" | "video" | "voice";
  text?: string;
  url?: string; // прямой signed download URL (отправитель шлёт готовый — без roundtrip у получателя)
  mediaPath?: string; // путь в Supabase Storage (для ре-резолва после reload)
  mediaPending?: boolean; // медиа грузится (placeholder — показать «загрузка»)
  thumb?: string; // крошечная превью (data URL) — мгновенный размытый показ у собеседника
  mediaFailed?: boolean; // аплоад не удался (показать «недоступно»)
  once?: boolean; // одноразовое медиа (view-once, Telegram-стиль)
  w?: number;
  h?: number;
  durationSec?: number;
  replyToId?: string; // ответ на сообщение
  replyText?: string; // краткая цитата (для показа без поиска оригинала)
  at: number;
};

// Детерминированное имя канала диалога из двух #ID.
export function chatChannelName(a: string, b: string): string {
  return `anoon:chat:${[a, b].sort().join("_")}`;
}

// Канал ЛИЧКИ друзей — отдельный префикс, чтобы не коллизить с эфемерной рулеткой
// (`anoon:chat:`). Личка постоянная (одна на пару), рулетка — на матч. Разные каналы →
// сообщения лички и рулетки одной и той же пары не смешиваются в realtime.
export function dmChannelName(a: string, b: string): string {
  return `anoon:dm:${[a, b].sort().join("_")}`;
}

// Персональный канал юзера: `anoon:user:<publicId>`. Нужен для live-сигнала о событии (новое
// сообщение / заявка), когда приложение ОТКРЫТО, но нужный чат закрыт — получатель обновляет
// бейджи, не заходя в диалог. (Свёрнутое/закрытое приложение ловит то же через web-push.)
export function userChannelName(publicId: string): string {
  return `anoon:user:${publicId}`;
}

// Пинг в персональный канал получателя. Канал КЭШИРУЕТСЯ per-peer и переиспользуется — не создаём
// новый realtime-канал на каждое сообщение (это churn-ил WebSocket и мог тормозить доставку).
// Событие: "dm" (новое сообщение) или "friend" (заявка). payload не важен — приёмник рефрешит бейджи.
const pingChannels = new Map<string, { ch: ReturnType<typeof supabase.channel>; ready: boolean }>();
export function pingUser(peerPublicId: string, event: "dm" | "friend" = "dm"): void {
  if (!peerPublicId) return;
  const name = userChannelName(peerPublicId);
  let entry = pingChannels.get(name);
  if (!entry) {
    const ch = supabase.channel(name, { config: { broadcast: { self: false } } });
    entry = { ch, ready: false };
    pingChannels.set(name, entry);
    ch.subscribe((status) => {
      if (entry) entry.ready = status === "SUBSCRIBED";
    });
  }
  const send = () => void entry!.ch.send({ type: "broadcast", event, payload: {} });
  if (entry.ready) send();
  else setTimeout(send, 400); // канал ещё подписывается — дать кадр
}

export type ChatHandle = {
  sendMessage: (p: WirePayload) => void;
  sendTyping: (typing: boolean) => void;
  sendRecording: (recording: boolean) => void; // «записывает голос…»
  sendDelivered: () => void; // квитанция «доставлено»
  sendRead: () => void; // квитанция «прочитано» отправителю
  sendDelete: (id: string) => void; // удалить сообщение у собеседника
  sendViewed: (id: string) => void; // одноразовое медиа просмотрено
  sendEnd: () => void; // завершить разговор
  sendFriendRequest: () => void; // запрос на раскрытие профилей
  sendFriendAccept: () => void; // раскрытие принято
  sendFriendDecline: () => void; // раскрытие отклонено
  sendReaction: (messageId: string, emoji: string | null) => void; // реакция на сообщение (личка)
  leave: () => void;
};

export function joinChat(
  name: string,
  myId: string,
  ev: {
    onMessage: (p: WirePayload) => void;
    onPresence?: (online: boolean) => void;
    onTyping?: (t: boolean) => void;
    onRecording?: (r: boolean) => void; // собеседник записывает голос
    onDelivered?: () => void; // мои сообщения доставлены
    onRead?: () => void; // собеседник прочитал мои сообщения
    onDelete?: (id: string) => void; // собеседник удалил своё сообщение
    onViewed?: (id: string) => void; // одноразовое медиа просмотрено собеседником
    onEnd?: () => void; // собеседник завершил разговор
    onFriendRequest?: () => void; // собеседник запросил раскрытие профилей
    onFriendAccept?: () => void; // собеседник принял раскрытие (ТОЛЬКО хинт — личность брать из GET /api/profile/[peer])
    onFriendDecline?: () => void; // собеседник отклонил раскрытие
    // Реакция собеседника на сообщение (T10, только личка). Как onViewed — доверенный live-хинт
    // между уже раскрытыми друзьями (не приватность-чувствительно); БД — источник истины при reload.
    onReaction?: (messageId: string, emoji: string | null) => void;
  },
): ChatHandle {
  const channel = supabase.channel(name, {
    config: { presence: { key: myId }, broadcast: { self: false } },
  });

  channel
    .on("broadcast", { event: "msg" }, ({ payload }) => ev.onMessage(payload as WirePayload))
    .on("broadcast", { event: "typing" }, ({ payload }) => ev.onTyping?.(Boolean((payload as { typing?: boolean })?.typing)))
    .on("broadcast", { event: "recording" }, ({ payload }) => ev.onRecording?.(Boolean((payload as { recording?: boolean })?.recording)))
    .on("broadcast", { event: "delivered" }, () => ev.onDelivered?.())
    .on("broadcast", { event: "read" }, () => ev.onRead?.())
    .on("broadcast", { event: "delete" }, ({ payload }) => ev.onDelete?.(String((payload as { id?: string })?.id ?? "")))
    .on("broadcast", { event: "viewed" }, ({ payload }) => ev.onViewed?.(String((payload as { id?: string })?.id ?? "")))
    .on("broadcast", { event: "end" }, () => ev.onEnd?.())
    .on("broadcast", { event: "friend_request" }, () => ev.onFriendRequest?.())
    .on("broadcast", { event: "friend_accept" }, () => ev.onFriendAccept?.())
    .on("broadcast", { event: "friend_decline" }, () => ev.onFriendDecline?.())
    .on("broadcast", { event: "reaction" }, ({ payload }) => {
      const p = payload as { id?: string; emoji?: string | null };
      ev.onReaction?.(String(p?.id ?? ""), p?.emoji ?? null);
    })
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const others = Object.keys(state).filter((k) => k !== myId);
      ev.onPresence?.(others.length > 0);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") void channel.track({ id: myId, at: Date.now() });
    });

  return {
    sendMessage: (p) => void channel.send({ type: "broadcast", event: "msg", payload: p }),
    sendTyping: (typing) => void channel.send({ type: "broadcast", event: "typing", payload: { typing } }),
    sendRecording: (recording) => void channel.send({ type: "broadcast", event: "recording", payload: { recording } }),
    sendDelivered: () => void channel.send({ type: "broadcast", event: "delivered", payload: {} }),
    sendRead: () => void channel.send({ type: "broadcast", event: "read", payload: {} }),
    sendDelete: (id) => void channel.send({ type: "broadcast", event: "delete", payload: { id } }),
    sendViewed: (id) => void channel.send({ type: "broadcast", event: "viewed", payload: { id } }),
    sendEnd: () => void channel.send({ type: "broadcast", event: "end", payload: {} }),
    sendFriendRequest: () => void channel.send({ type: "broadcast", event: "friend_request", payload: {} }),
    sendFriendAccept: () => void channel.send({ type: "broadcast", event: "friend_accept", payload: {} }),
    sendFriendDecline: () => void channel.send({ type: "broadcast", event: "friend_decline", payload: {} }),
    sendReaction: (messageId, emoji) => void channel.send({ type: "broadcast", event: "reaction", payload: { id: messageId, emoji } }),
    leave: () => void supabase.removeChannel(channel),
  };
}

// Критерии подбора (пол+возраст свой/искомого). Строка возраста — бэнд («18-21» и т.д.).
export type MatchCriteria = {
  gender: "nobody" | "m" | "f";
  age: string | null;
  wantGender: "any" | "m" | "f";
  wantAges: string[];
};

type PeerMeta = { id: string; g: string; a: string | null; wg: string; wa: string[] };

const FALLBACK_MS = 8000; // после — ослабляем возраст (матч по полу)

const genderSat = (want: string, gender: string) => want === "any" || gender === "nobody" || want === gender;
const ageSat = (wantAges: string[], age: string | null) => !wantAges?.length || (age != null && wantAges.includes(age));

// Матчинг «Найти собеседника» через lobby-presence с взаимным фильтром.
// Строго (пол+возраст взаимно); через FALLBACK_MS — только пол.
// conversationId (эфемерная рулетка, risk #8): ГЕНЕРИТ ИНИЦИАТОР (меньший #ID) и шлёт в
// match-payload → обе стороны сходятся на ОДНОМ id новой Conversation (не переиспользуют пару,
// иначе старая переписка всплыла бы = деанонимизация). onMatched получает этот id.
export function findMatch(
  myId: string,
  me: MatchCriteria,
  onMatched: (peerId: string, conversationId: string) => void,
): { cancel: () => void } {
  const lobby = supabase.channel("anoon:lobby", { config: { presence: { key: myId } } });
  let done = false;
  const startedAt = Date.now();
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const finish = (peer: string, conversationId: string) => {
    if (done) return;
    done = true;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    onMatched(peer, conversationId);
    void supabase.removeChannel(lobby);
  };

  // Взаимное совпадение me ↔ them. relax=true → игнор возраста.
  const isMatch = (them: PeerMeta, relax: boolean): boolean => {
    const g = genderSat(me.wantGender, them.g) && genderSat(them.wg, me.gender);
    if (!g) return false;
    if (relax) return true;
    return ageSat(me.wantAges, them.a) && ageSat(them.wa, me.age);
  };

  const tryMatch = () => {
    if (done) return;
    const relax = Date.now() - startedAt > FALLBACK_MS;
    const state = lobby.presenceState() as Record<string, PeerMeta[]>;
    const candidates = Object.keys(state)
      .filter((k) => k !== myId)
      .map((k) => state[k]?.[0])
      .filter((m): m is PeerMeta => Boolean(m) && isMatch(m, relax))
      .map((m) => m.id)
      .sort();
    if (candidates.length === 0) return;
    const peer = candidates[0];
    // Меньший #ID — инициатор: генерит conversationId новой сессии, шлёт match, оба уходят в чат.
    if (myId < peer) {
      const conversationId = crypto.randomUUID();
      void lobby.send({ type: "broadcast", event: "match", payload: { a: myId, b: peer, c: conversationId } });
      finish(peer, conversationId);
    }
  };

  lobby
    .on("presence", { event: "sync" }, tryMatch)
    .on("presence", { event: "join" }, tryMatch)
    .on("broadcast", { event: "match" }, ({ payload }) => {
      const p = payload as { a: string; b: string; c?: string };
      // c отсутствует только у старого клиента без эфемерной рулетки → фолбэк «» (find-or-create).
      if (p?.b === myId) finish(p.a, p.c ?? "");
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void lobby.track({ id: myId, g: me.gender, a: me.age, wg: me.wantGender, wa: me.wantAges });
        // Форсим повторную попытку в момент включения фолбэка (без новых presence-событий).
        fallbackTimer = setTimeout(tryMatch, FALLBACK_MS + 250);
      }
    });

  return {
    cancel: () => {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (!done) void supabase.removeChannel(lobby);
    },
  };
}
