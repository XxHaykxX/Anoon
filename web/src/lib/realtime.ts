"use client";

import { supabase } from "@/lib/supabase";

// Realtime через Supabase Broadcast/Presence. Работает на publishable-ключе (без auth):
// матчинг (lobby-presence) + канал диалога (broadcast сообщений/печати + presence онлайна).
// Медиа пока передаём метаданными; реальные файлы peer увидит после R2 (Фаза E).

export type WirePayload = {
  id: string;
  kind: "text" | "image" | "video" | "voice";
  text?: string;
  url?: string;
  mediaPath?: string; // путь в Supabase Storage (собеседник резолвит в signed URL)
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

export type ChatHandle = {
  sendMessage: (p: WirePayload) => void;
  sendTyping: (typing: boolean) => void;
  sendRead: () => void; // квитанция «прочитано» отправителю
  sendDelete: (id: string) => void; // удалить сообщение у собеседника
  leave: () => void;
};

export function joinChat(
  name: string,
  myId: string,
  ev: {
    onMessage: (p: WirePayload) => void;
    onPresence?: (online: boolean) => void;
    onTyping?: (t: boolean) => void;
    onRead?: () => void; // собеседник прочитал мои сообщения
    onDelete?: (id: string) => void; // собеседник удалил своё сообщение
  },
): ChatHandle {
  const channel = supabase.channel(name, {
    config: { presence: { key: myId }, broadcast: { self: false } },
  });

  channel
    .on("broadcast", { event: "msg" }, ({ payload }) => ev.onMessage(payload as WirePayload))
    .on("broadcast", { event: "typing" }, ({ payload }) => ev.onTyping?.(Boolean((payload as { typing?: boolean })?.typing)))
    .on("broadcast", { event: "read" }, () => ev.onRead?.())
    .on("broadcast", { event: "delete" }, ({ payload }) => ev.onDelete?.(String((payload as { id?: string })?.id ?? "")))
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
    sendRead: () => void channel.send({ type: "broadcast", event: "read", payload: {} }),
    sendDelete: (id) => void channel.send({ type: "broadcast", event: "delete", payload: { id } }),
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
export function findMatch(myId: string, me: MatchCriteria, onMatched: (peerId: string) => void): { cancel: () => void } {
  const lobby = supabase.channel("anoon:lobby", { config: { presence: { key: myId } } });
  let done = false;
  const startedAt = Date.now();
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const finish = (peer: string) => {
    if (done) return;
    done = true;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    onMatched(peer);
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
    // Меньший #ID — инициатор: шлёт match, оба уходят в чат.
    if (myId < peer) {
      void lobby.send({ type: "broadcast", event: "match", payload: { a: myId, b: peer } });
      finish(peer);
    }
  };

  lobby
    .on("presence", { event: "sync" }, tryMatch)
    .on("presence", { event: "join" }, tryMatch)
    .on("broadcast", { event: "match" }, ({ payload }) => {
      const p = payload as { a: string; b: string };
      if (p?.b === myId) finish(p.a);
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
