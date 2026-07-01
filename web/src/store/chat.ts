"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { fetchHistory, markRead, persistMessage } from "@/lib/api";
import { chatChannelName, joinChat, type ChatHandle, type WirePayload } from "@/lib/realtime";
import { supabase, supabaseConfigured } from "@/lib/supabase";

export type MsgKind = "text" | "image" | "video" | "voice";
export type MsgStatus = "sent" | "read"; // тик статуса для своих сообщений
export type Msg = {
  id: string;
  mine: boolean;
  kind: MsgKind;
  text?: string;
  url?: string; // object URL (image/video/voice blob) или picsum для входящих моков
  w?: number;
  h?: number;
  durationSec?: number;
  stale?: boolean; // blob-URL умер после перезагрузки → медиа недоступно
  status?: MsgStatus; // только для mine: sent | read
  replyToId?: string; // ответ на сообщение
  replyText?: string; // краткая цитата оригинала
  at: number;
};

export type ReplyRef = { id: string; text: string };

export type OutgoingMedia = {
  kind: "image" | "video";
  url: string;
  w?: number;
  h?: number;
  durationSec?: number;
};

type ChatState = {
  byPeer: Record<string, Msg[]>;
  peerOnline: boolean;
  peerTyping: boolean;
  connect: (peer: string, myId: string) => () => void;
  send: (peer: string, text: string, reply?: ReplyRef) => void;
  sendMedia: (peer: string, media: OutgoingMedia) => void;
  sendVoice: (peer: string, url: string, durationSec: number) => void;
  deleteMsg: (peer: string, id: string) => void;
  setTyping: (typing: boolean) => void;
  seed: (peer: string) => void;
};

let seq = 0;
const id = () => `m${++seq}`;

// Активный канал диалога (вне zustand-состояния — не сериализуется).
let active: ChatHandle | null = null;

// Access-token из Supabase-сессии (для backend-persist). null → работаем только realtime+local.
async function token(): Promise<string | null> {
  if (!supabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// Persist сообщения в БД (best-effort, не блокирует realtime-транспорт).
async function persistRemote(peer: string, kind: MsgKind, text?: string): Promise<void> {
  const t = await token();
  if (t) await persistMessage(peer, kind, text, t).catch(() => {});
}

// Отметить сообщения собеседника прочитанными в БД (best-effort).
async function markReadRemote(peer: string): Promise<void> {
  const t = await token();
  if (t) await markRead(peer, t);
}

// Чат. Транспорт — Supabase Realtime (broadcast). Persist истории; медиа = object URL
// (после reload мертвы → stale). Медиа по сети peer увидит после R2 (Фаза E).
export const useChat = create<ChatState>()(
  persist(
    (set, get) => {
      const pushLocal = (peer: string, msg: Msg) =>
        set((s) => ({ byPeer: { ...s.byPeer, [peer]: [...(s.byPeer[peer] ?? []), msg] } }));

      const tx = (p: WirePayload) => active?.sendMessage(p);

      return {
        byPeer: {},
        peerOnline: false,
        peerTyping: false,

        connect: (peer, myId) => {
          active?.leave();
          set({ peerOnline: false, peerTyping: false });
          if (!supabaseConfigured || !myId) {
            active = null;
            return () => {};
          }
          const handle = joinChat(chatChannelName(myId, peer), myId, {
            onMessage: (p) => {
              set((s) => ({ byPeer: { ...s.byPeer, [peer]: [...(s.byPeer[peer] ?? []), { ...p, mine: false } as Msg] } }));
              // Мы видим чат → сразу квитанция «прочитано» отправителю + в БД.
              active?.sendRead();
              void markReadRemote(peer);
            },
            onPresence: (online) => set({ peerOnline: online }),
            onTyping: (t) => set({ peerTyping: t }),
            onRead: () =>
              set((s) => ({
                byPeer: {
                  ...s.byPeer,
                  [peer]: (s.byPeer[peer] ?? []).map((m) => (m.mine ? { ...m, status: "read" } : m)),
                },
              })),
            onDelete: (mid) =>
              set((s) => ({
                byPeer: { ...s.byPeer, [peer]: (s.byPeer[peer] ?? []).filter((m) => m.id !== mid) },
              })),
          });
          active = handle;

          // Гидратация истории из БД, если локально пусто (новое устройство / очистка).
          void (async () => {
            const cur = get().byPeer[peer];
            const t = await token();
            if (!t) return;
            if (!cur || cur.length === 0) {
              const hist = await fetchHistory(peer, t).catch(() => []);
              if (hist.length > 0) {
                set((s) => ({
                  byPeer: {
                    ...s.byPeer,
                    [peer]: hist.map((h) => ({
                      id: h.id,
                      mine: h.mine,
                      kind: h.kind,
                      text: h.text,
                      status: h.mine ? (h.status === "read" ? "read" : "sent") : undefined,
                      at: h.at,
                    })),
                  },
                }));
              }
            }
            // Мы открыли чат → отметить входящие прочитанными.
            await markRead(peer, t).catch(() => {});
            active?.sendRead();
          })();

          return () => {
            handle.leave();
            active = null;
            set({ peerOnline: false, peerTyping: false });
          };
        },

        seed: (peer) =>
          set((s) => (s.byPeer[peer] ? s : { byPeer: { ...s.byPeer, [peer]: [] } })),

        send: (peer, text, reply) => {
          const msg: Msg = {
            id: id(),
            mine: true,
            kind: "text",
            text,
            status: "sent",
            replyToId: reply?.id,
            replyText: reply?.text,
            at: Date.now(),
          };
          pushLocal(peer, msg);
          tx({ id: msg.id, kind: "text", text, replyToId: reply?.id, replyText: reply?.text, at: msg.at });
          void persistRemote(peer, "text", text);
        },

        deleteMsg: (peer, mid) => {
          set((s) => ({ byPeer: { ...s.byPeer, [peer]: (s.byPeer[peer] ?? []).filter((m) => m.id !== mid) } }));
          active?.sendDelete(mid);
        },

        sendMedia: (peer, media) => {
          const msg: Msg = { id: id(), mine: true, kind: media.kind, url: media.url, w: media.w, h: media.h, durationSec: media.durationSec, status: "sent", at: Date.now() };
          pushLocal(peer, msg);
          // url — локальный blob; peer получит метаданные, файл — после R2 (Фаза E).
          tx({ id: msg.id, kind: media.kind, url: media.url, w: media.w, h: media.h, durationSec: media.durationSec, at: msg.at });
          void persistRemote(peer, media.kind);
        },

        sendVoice: (peer, url, durationSec) => {
          const msg: Msg = { id: id(), mine: true, kind: "voice", url, durationSec, status: "sent", at: Date.now() };
          pushLocal(peer, msg);
          tx({ id: msg.id, kind: "voice", url, durationSec, at: msg.at });
          void persistRemote(peer, "voice");
        },

        setTyping: (typing) => active?.sendTyping(typing),
      };
    },
    {
      name: "anoon-chat",
      partialize: (s) => ({ byPeer: s.byPeer }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        for (const peer of Object.keys(state.byPeer)) {
          state.byPeer[peer] = state.byPeer[peer].map((m) =>
            m.kind !== "text" && m.url?.startsWith("blob:") ? { ...m, url: undefined, stale: true } : m,
          );
        }
      },
    },
  ),
);
