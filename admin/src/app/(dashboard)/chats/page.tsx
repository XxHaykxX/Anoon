"use client";

import { ArrowLeft, Circle, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type Peer = { id: string; nickname: string; publicId: string; emoji: string };
type Conversation = {
  id: string;
  a: Peer;
  b: Peer;
  messages: number;
  lastMessageAt: string | null;
  createdAt: string;
  live: boolean;
};
type ChatMessage = {
  id: string;
  senderId: string;
  kind: string;
  text: string | null;
  status: string;
  createdAt: string;
  mediaUrl: string | null;
  mediaKind: string | null;
};

function time(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// История + живые диалоги. Список слева (автообновление 10с) + просмотр справа (live 5с).
export default function ChatsPage() {
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Conversation | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const msgEndRef = useRef<HTMLDivElement>(null);

  // Список диалогов (near-live).
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/admin/chats")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => alive && setConvs(d.conversations ?? []))
        .catch((e) => alive && setErr(String(e)));
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Сброс сообщений при смене выбора (в рендере, без setState-в-effect).
  const [prevSelId, setPrevSelId] = useState<string | null>(null);
  const selId = sel?.id ?? null;
  if (selId !== prevSelId) {
    setPrevSelId(selId);
    setMsgs(null);
  }

  // Сообщения выбранного диалога (live 5с).
  useEffect(() => {
    if (!sel) return;
    let alive = true;
    const id = sel.id;
    const load = () =>
      fetch(`/api/admin/chats?id=${encodeURIComponent(id)}`)
        .then((r) => r.json())
        .then((d) => alive && setMsgs(d.messages ?? []))
        .catch(() => alive && setMsgs([]));
    load();
    const t = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [sel]);

  // Автоскролл к последнему сообщению.
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ block: "end" });
  }, [msgs?.length]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Чаты</h1>
        <p className="text-sm text-fg-muted">История диалогов и идущие сейчас разговоры (обновление live).</p>
      </div>

      {err ? (
        <div className="rounded-xl border border-border bg-surface-1 p-6 text-sm text-fg-muted">
          Нет доступа (нужен api-режим). {err}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          {/* Список диалогов — на мобиле прячется, когда открыт диалог */}
          <div className={cn("space-y-1.5", sel && "hidden lg:block")}>
            {convs === null ? (
              <div className="text-sm text-fg-muted">Загрузка…</div>
            ) : convs.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface-1 p-6 text-center text-fg-muted">Диалогов нет</div>
            ) : (
              convs.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSel(c)}
                  aria-current={sel?.id === c.id}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border bg-surface-1 p-3 text-left transition-colors",
                    sel?.id === c.id ? "border-accent" : "border-border hover:border-white/20",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {c.a.emoji} {c.a.nickname} <span className="text-fg-muted">↔</span> {c.b.emoji} {c.b.nickname}
                    </div>
                    <div className="truncate font-mono text-xs text-fg-muted">
                      #{c.a.publicId} · #{c.b.publicId} · {c.messages} сообщ.
                    </div>
                  </div>
                  {c.live ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                      <Circle size={7} className="animate-pulse fill-success text-success" /> идёт
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-fg-muted">{time(c.lastMessageAt)}</span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Просмотр диалога */}
          <div className={cn("rounded-xl border border-border bg-surface-1", !sel && "hidden lg:block")}>
            {!sel ? (
              <div className="py-16 text-center text-fg-muted">Выбери диалог слева</div>
            ) : (
              <div className="flex h-[70vh] flex-col">
                <div className="flex items-center gap-2 border-b border-border p-3">
                  <button
                    onClick={() => setSel(null)}
                    aria-label="Назад к списку"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-secondary hover:bg-surface-2 lg:hidden"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {sel.a.emoji} {sel.a.nickname} ↔ {sel.b.emoji} {sel.b.nickname}
                    </div>
                    <div className="truncate font-mono text-xs text-fg-muted">
                      #{sel.a.publicId} · #{sel.b.publicId}
                    </div>
                  </div>
                  {sel.live && (
                    <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                      <Circle size={7} className="animate-pulse fill-success text-success" /> идёт
                    </span>
                  )}
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto p-4">
                  {msgs === null ? (
                    <div className="text-sm text-fg-muted">Загрузка…</div>
                  ) : msgs.length === 0 ? (
                    <div className="py-10 text-center text-sm text-fg-muted">Сообщений нет</div>
                  ) : (
                    msgs.map((m) => {
                      const mine = m.senderId === sel.a.id; // A слева, B справа
                      return (
                        <div key={m.id} className={cn("flex", mine ? "justify-start" : "justify-end")}>
                          <div
                            className={cn(
                              "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
                              mine ? "bg-surface-2" : "bg-accent/15",
                            )}
                          >
                            {m.mediaUrl ? (
                              m.mediaKind === "video" ? (
                                <video src={m.mediaUrl} controls className="max-h-60 rounded-lg" />
                              ) : m.mediaKind === "audio" ? (
                                <audio src={m.mediaUrl} controls />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={m.mediaUrl} alt="" className="max-h-60 rounded-lg" />
                              )
                            ) : m.kind !== "text" ? (
                              <span className="text-fg-muted">[{m.kind} — недоступно]</span>
                            ) : (
                              <span className="whitespace-pre-wrap break-words">{m.text}</span>
                            )}
                            <div className="mt-1 text-right font-mono text-[10px] text-fg-muted">{time(m.createdAt)}</div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={msgEndRef} />
                </div>

                <div className="flex items-center gap-2 border-t border-border p-2 text-xs text-fg-muted">
                  <MessageSquare size={13} /> Просмотр только для чтения · аудит модерации
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
