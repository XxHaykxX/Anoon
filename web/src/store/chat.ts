"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { fetchHistory, markRead, persistMessage } from "@/lib/api";
import { chatChannelName, joinChat, type ChatHandle, type WirePayload } from "@/lib/realtime";
import { resolveMediaUrl, uploadMedia } from "@/lib/storage";
import { supabase, supabaseConfigured } from "@/lib/supabase";

export type MsgKind = "text" | "image" | "video" | "voice";
export type MsgStatus = "sent" | "delivered" | "read"; // тики: ✓ / ✓✓ / ✓✓ синие
export type Msg = {
  id: string;
  mine: boolean;
  kind: MsgKind;
  text?: string;
  url?: string; // текущий отображаемый URL (blob для своих / signed URL из Storage)
  mediaPath?: string; // путь в Supabase Storage → резолвим в signed URL (переживает reload)
  w?: number;
  h?: number;
  durationSec?: number;
  stale?: boolean; // медиа недоступно (blob умер и нет mediaPath)
  status?: MsgStatus; // только для mine: sent | read
  replyToId?: string; // ответ на сообщение
  replyText?: string; // краткая цитата оригинала
  once?: boolean; // одноразовое медиа (view-once)
  viewed?: boolean; // одноразовое просмотрено
  at: number;
};

export type ReplyRef = { id: string; text: string };

export type OutgoingMedia = {
  kind: "image" | "video";
  url: string;
  w?: number;
  h?: number;
  durationSec?: number;
  once?: boolean;
};

type ChatState = {
  byPeer: Record<string, Msg[]>;
  peerOnline: boolean;
  peerTyping: boolean;
  peerRecording: boolean;
  ended: "me" | "peer" | null; // разговор завершён (кем)
  connect: (peer: string, myId: string) => () => void;
  send: (peer: string, text: string, reply?: ReplyRef) => void;
  sendMedia: (peer: string, media: OutgoingMedia) => void;
  sendVoice: (peer: string, url: string, durationSec: number) => void;
  deleteMsg: (peer: string, id: string) => void;
  markViewed: (peer: string, id: string) => void;
  endChat: () => void;
  clearEnded: () => void;
  setTyping: (typing: boolean) => void;
  setRecording: (recording: boolean) => void;
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

// Токен с коротким ретраем — сессия на мобиле может быть не готова в момент отправки.
async function tokenReady(tries = 4): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    const t = await token();
    if (t) return t;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

// Persist текстового сообщения в БД (best-effort).
async function persistRemote(peer: string, kind: MsgKind, text?: string): Promise<void> {
  const t = await token();
  if (t) await persistMessage(peer, kind, text, t).catch(() => {});
}

// Отметить сообщения собеседника прочитанными в БД (best-effort).
async function markReadRemote(peer: string): Promise<void> {
  const t = await token();
  if (t) await markRead(peer, t);
}

// Чат. Транспорт — Supabase Realtime (broadcast). Persist истории в БД; медиа — в Supabase
// Storage (mediaPath → signed URL), переживают reload и видны собеседнику.
export const useChat = create<ChatState>()(
  persist(
    (set, get) => {
      const pushLocal = (peer: string, msg: Msg) =>
        set((s) => ({ byPeer: { ...s.byPeer, [peer]: [...(s.byPeer[peer] ?? []), msg] } }));

      const patch = (peer: string, mid: string, p: Partial<Msg>) =>
        set((s) => ({ byPeer: { ...s.byPeer, [peer]: (s.byPeer[peer] ?? []).map((m) => (m.id === mid ? { ...m, ...p } : m)) } }));

      const tx = (p: WirePayload) => active?.sendMessage(p);

      // Резолв signed-URL для сообщений с mediaPath без готового url.
      const resolveMediaFor = async (peer: string) => {
        const t = await token();
        if (!t) return;
        const msgs = get().byPeer[peer] ?? [];
        await Promise.all(
          msgs
            .filter((m) => m.mediaPath && !m.url)
            .map(async (m) => {
              const url = await resolveMediaUrl(m.mediaPath!, t);
              if (url) patch(peer, m.id, { url, stale: false });
            }),
        );
      };

      // Отправка медиа (image/video/voice): мгновенно локально + placeholder собеседнику,
      // затем аплоад → broadcast с готовым signed URL (без лишнего roundtrip у получателя).
      const sendUpload = (peer: string, kind: "image" | "video" | "voice", localUrl: string, extra: Partial<Msg>) => {
        const mid = id();
        const at = Date.now();
        const msg: Msg = { id: mid, mine: true, kind, url: localUrl, status: "sent", at, ...extra };
        pushLocal(peer, msg);
        // Мгновенный placeholder — собеседник сразу видит «загрузка», а не пустоту.
        tx({ id: mid, kind, mediaPending: true, once: extra.once, w: extra.w, h: extra.h, durationSec: extra.durationSec, at });

        void (async () => {
          const t = await tokenReady();
          const blob = await fetch(localUrl).then((r) => r.blob()).catch(() => null);
          if (!t || !blob) {
            tx({ id: mid, kind, mediaFailed: true, at });
            patch(peer, mid, { stale: true });
            return;
          }
          const up = await uploadMedia(blob, kind, blob.type || "application/octet-stream", t);
          if (!up) {
            tx({ id: mid, kind, mediaFailed: true, at });
            patch(peer, mid, { stale: true });
            return;
          }
          patch(peer, mid, { mediaPath: up.path });
          // Готовый signed URL сразу в broadcast — получатель показывает без доп. запроса.
          const url = await resolveMediaUrl(up.path, t);
          tx({ id: mid, kind, url: url ?? undefined, mediaPath: up.path, once: extra.once, w: extra.w, h: extra.h, durationSec: extra.durationSec, at });
          await persistMessage(peer, kind, undefined, t, up.mediaId).catch(() => {});
        })();
      };

      return {
        byPeer: {},
        peerOnline: false,
        peerTyping: false,
        peerRecording: false,
        ended: null,

        connect: (peer, myId) => {
          active?.leave();
          set({ peerOnline: false, peerTyping: false, peerRecording: false, ended: null });
          if (!supabaseConfigured || !myId) {
            active = null;
            return () => {};
          }
          const handle = joinChat(chatChannelName(myId, peer), myId, {
            onMessage: (p) => {
              // Upsert по id: placeholder (mediaPending) → финальные данные (url), не дублируем.
              set((s) => {
                const arr = s.byPeer[peer] ?? [];
                const incoming: Msg = {
                  id: p.id,
                  mine: false,
                  kind: p.kind,
                  text: p.text,
                  url: p.url,
                  mediaPath: p.mediaPath,
                  w: p.w,
                  h: p.h,
                  durationSec: p.durationSec,
                  replyToId: p.replyToId,
                  replyText: p.replyText,
                  once: p.once,
                  stale: p.mediaFailed ? true : undefined,
                  at: p.at,
                };
                const idx = arr.findIndex((m) => m.id === p.id);
                if (idx >= 0) {
                  const prev = arr[idx];
                  const next = [...arr];
                  next[idx] = {
                    ...prev,
                    ...incoming,
                    url: incoming.url ?? prev.url,
                    mediaPath: incoming.mediaPath ?? prev.mediaPath,
                    stale: p.mediaFailed ? true : prev.stale,
                  };
                  return { byPeer: { ...s.byPeer, [peer]: next } };
                }
                return { byPeer: { ...s.byPeer, [peer]: [...arr, incoming] } };
              });
              active?.sendDelivered();
              active?.sendRead();
              void markReadRemote(peer);
              // Фолбэк-резолв, если прямой url не пришёл, но есть путь.
              if (!p.url && p.mediaPath) {
                void (async () => {
                  const t = await token();
                  if (!t) return;
                  const url = await resolveMediaUrl(p.mediaPath!, t);
                  if (url) patch(peer, p.id, { url, stale: false });
                })();
              }
            },
            onPresence: (online) => set({ peerOnline: online }),
            onTyping: (t) => set({ peerTyping: t }),
            onRecording: (r) => set({ peerRecording: r }),
            onDelivered: () =>
              set((s) => ({
                byPeer: {
                  ...s.byPeer,
                  // delivered не понижает уже прочитанные.
                  [peer]: (s.byPeer[peer] ?? []).map((m) => (m.mine && m.status !== "read" ? { ...m, status: "delivered" } : m)),
                },
              })),
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
            onViewed: (mid) =>
              // Собеседник просмотрел моё одноразовое → помечаем «просмотрено» (у отправителя тоже гаснет).
              set((s) => ({
                byPeer: { ...s.byPeer, [peer]: (s.byPeer[peer] ?? []).map((m) => (m.id === mid ? { ...m, viewed: true, url: undefined, mediaPath: undefined } : m)) },
              })),
            onEnd: () => set({ ended: "peer" }),
          });
          active = handle;

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
                      mediaPath: h.mediaPath,
                      status: h.mine ? (h.status === "read" ? "read" : "sent") : undefined,
                      at: h.at,
                    })),
                  },
                }));
              }
            }
            // Резолв медиа (история + локально сохранённые stale) + read-квитанции.
            await resolveMediaFor(peer);
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

        // Одноразовое просмотрено получателем: гасим у себя (url/путь убираем) + шлём отправителю.
        // Файл в Storage/админке остаётся — удаляем только из чата.
        markViewed: (peer, mid) => {
          set((s) => ({ byPeer: { ...s.byPeer, [peer]: (s.byPeer[peer] ?? []).map((m) => (m.id === mid ? { ...m, viewed: true, url: undefined, mediaPath: undefined } : m)) } }));
          active?.sendViewed(mid);
        },

        sendMedia: (peer, media) => {
          sendUpload(peer, media.kind, media.url, { w: media.w, h: media.h, durationSec: media.durationSec, once: media.once });
        },

        sendVoice: (peer, url, durationSec) => {
          sendUpload(peer, "voice", url, { durationSec });
        },

        endChat: () => {
          active?.sendEnd();
          set({ ended: "me" });
        },
        clearEnded: () => set({ ended: null }),

        setTyping: (typing) => active?.sendTyping(typing),
        setRecording: (recording) => active?.sendRecording(recording),
      };
    },
    {
      name: "anoon-chat",
      partialize: (s) => ({ byPeer: s.byPeer }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        for (const peer of Object.keys(state.byPeer)) {
          state.byPeer[peer] = state.byPeer[peer].map((m) =>
            // blob-URL мёртв после reload: если есть mediaPath — восстановим (не stale), иначе stale.
            m.kind !== "text" && m.url?.startsWith("blob:") ? { ...m, url: undefined, stale: !m.mediaPath } : m,
          );
        }
      },
    },
  ),
);
