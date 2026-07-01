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

// Матчинг «Найти собеседника» через lobby-presence. Возвращает cancel().
export function findMatch(myId: string, onMatched: (peerId: string) => void): { cancel: () => void } {
  const lobby = supabase.channel("anoon:lobby", { config: { presence: { key: myId } } });
  let done = false;

  const finish = (peer: string) => {
    if (done) return;
    done = true;
    onMatched(peer);
    void supabase.removeChannel(lobby);
  };

  const tryMatch = () => {
    if (done) return;
    const others = Object.keys(lobby.presenceState()).filter((k) => k !== myId).sort();
    if (others.length === 0) return;
    const peer = others[0];
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
      if (status === "SUBSCRIBED") void lobby.track({ id: myId, at: Date.now() });
    });

  return { cancel: () => { if (!done) void supabase.removeChannel(lobby); } };
}
