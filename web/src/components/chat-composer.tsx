"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, CornerUpLeft, Eye, ImageIcon, Mic, Send, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { EmojiPicker } from "@/components/emoji-picker";
import { useVoiceRecorder } from "@/lib/use-voice-recorder";
import { useChat, type OutgoingMedia, type ReplyRef } from "@/store/chat";
import { useSession } from "@/store/session";
import { cn } from "@/lib/utils";

type Pending = OutgoingMedia & { name: string };

// Определить размеры/длительность выбранного медиа (для соотношения сторон и подписи видео).
function probe(kind: "image" | "video", url: string): Promise<{ w?: number; h?: number; durationSec?: number }> {
  return new Promise((resolve) => {
    if (kind === "image") {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({});
      img.src = url;
    } else {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => resolve({ w: v.videoWidth, h: v.videoHeight, durationSec: Math.round(v.duration) || undefined });
      v.onerror = () => resolve({});
      v.src = url;
    }
  });
}

export function ChatComposer({
  peer,
  reply,
  onClearReply,
}: {
  peer: string;
  reply?: ReplyRef | null;
  onClearReply?: () => void;
}) {
  const { send, sendMedia, sendVoice, setTyping, setRecording } = useChat();
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [once, setOnce] = useState(false); // одноразовое медиа (view-once)
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rec = useVoiceRecorder();

  // Освободить неотправленные превью при размонтировании (отправленные URL живут в чате).
  const pendingRef = useRef<Pending[]>([]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(
    () => () => {
      for (const p of pendingRef.current) URL.revokeObjectURL(p.url);
    },
    [],
  );

  const submitText = () => {
    const t = text.trim();
    if (!t) return;
    send(peer, t, reply ?? undefined);
    setText("");
    setTyping(false);
    onClearReply?.();
  };

  const insertEmoji = (e: string) => setText((v) => v + e);

  const onType = (v: string) => {
    setText(v);
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1500);
  };

  const onPick = async (files: File[]) => {
    const picked = await Promise.all(
      files.map(async (file) => {
        const kind: "image" | "video" = file.type.startsWith("video") ? "video" : "image";
        const url = URL.createObjectURL(file);
        const meta = await probe(kind, url);
        return { kind, url, name: file.name, ...meta } as Pending;
      }),
    );
    setPending((prev) => [...prev, ...picked]);
  };

  const sendPending = async () => {
    if (pending.length === 0 || sending) return;
    setSending(true);
    const queue = pending;
    setPending([]);
    // Отправляем по очереди (визуальный прогресс). Медиа локальные — реальная загрузка будет с R2.
    for (const p of queue) {
      const { name: _name, ...media } = p;
      void _name;
      sendMedia(peer, { ...media, once });
      await new Promise((r) => setTimeout(r, 120));
    }
    setOnce(false);
    setSending(false);
  };

  const removePending = (idx: number) => {
    setPending((prev) => {
      const p = prev[idx];
      if (p) URL.revokeObjectURL(p.url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const vibrate = (pattern: number | number[]) => {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // не поддерживается — не критично
    }
  };

  const startRec = async () => {
    const ok = await rec.start();
    if (ok) {
      vibrate(20); // тактильный отклик «пошла запись»
      setRecording(true); // собеседник видит «записывает голос…»
    }
  };
  const finishRec = async () => {
    setRecording(false);
    vibrate(15); // «запись отправлена»
    const res = await rec.stop();
    if (res) sendVoice(peer, res.url, res.durationSec);
  };
  const cancelRec = () => {
    setRecording(false);
    vibrate([10, 30, 10]); // «отмена»
    rec.cancel();
  };

  const recording = rec.status === "recording";

  // Мут: не может писать (сервер вернёт 403), но может читать. Блокируем композер + уведомление.
  const muted = useSession((s) => s.muted);
  const muteReason = useSession((s) => s.muteReason);
  const muteUntil = useSession((s) => s.muteUntil);
  if (muted) {
    return (
      <div className="border-t border-border px-4 py-4 text-center">
        <p className="text-sm font-medium text-fg">🔇 Вы не можете отправлять сообщения</p>
        <p className="mt-1 text-xs text-fg-muted">
          {muteReason ? `Причина: ${muteReason}.` : "Ограничение установлено модерацией."}
          {muteUntil ? ` До ${new Date(muteUntil).toLocaleString("ru-RU")}.` : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-border pb-[env(safe-area-inset-bottom)]">
      {/* Превью выбранных медиа перед отправкой (несколько сразу) */}
      <AnimatePresence>
        {pending.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex gap-2 overflow-x-auto px-3 pt-3">
              {pending.map((p, i) => (
                <div key={p.url} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                  {p.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    <video src={p.url} muted className="h-full w-full object-cover" />
                  )}
                  <button
                    onClick={() => removePending(i)}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                    aria-label={`Убрать ${p.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 px-3 pt-2">
              <span className="text-xs text-fg-muted">
                {pending.length} {pending.length === 1 ? "файл" : "файла(ов)"} · готово к отправке
              </span>
              {/* Одноразовое: получатель посмотрит 1 раз, потом исчезнет */}
              <button
                onClick={() => setOnce((v) => !v)}
                aria-pressed={once}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                  once ? "border-accent bg-accent/15 text-accent" : "border-white/10 bg-white/5 text-fg-secondary hover:text-fg",
                )}
              >
                <Eye size={14} />
                Одноразовое
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Индикатор отправки */}
      {sending && (
        <div className="h-0.5 w-full overflow-hidden bg-surface-2" role="progressbar" aria-label="Отправка">
          <motion.div
            className="h-full bg-accent"
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
            style={{ width: "50%" }}
          />
        </div>
      )}

      {(rec.status === "denied" || rec.status === "unsupported") && (
        <p role="alert" className="px-4 pt-2 text-xs text-danger">
          {rec.status === "denied"
            ? "Нет доступа к микрофону — разреши в настройках браузера."
            : "Запись голоса недоступна (нужен HTTPS или поддержка браузера)."}
        </p>
      )}

      {/* Полоса ответа (реплай) */}
      {reply ? (
        <div className="flex items-center gap-2 border-l-2 border-accent px-4 pt-2">
          <CornerUpLeft size={15} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary">Ответ: {reply.text}</span>
          <button
            onClick={() => onClearReply?.()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2"
            aria-label="Отменить ответ"
          >
            <X size={15} />
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 p-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            if (files.length) void onPick(files);
            e.target.value = "";
          }}
        />

        {recording ? (
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-full border border-danger/40 bg-danger/5 px-4 py-2.5">
            {/* Пульсирующая красная точка */}
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-danger" />
            </span>
            {/* Живой эквалайзер */}
            <div className="flex h-4 items-center gap-[3px]" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <motion.span
                  key={i}
                  className="w-[3px] rounded-full bg-danger"
                  style={{ height: "30%" }}
                  animate={{ height: ["30%", "100%", "30%"] }}
                  transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
                />
              ))}
            </div>
            <span className="font-mono text-sm tabular-nums text-fg">
              {Math.floor(rec.elapsed / 60)}:{String(rec.elapsed % 60).padStart(2, "0")}
            </span>
            <span className="ml-auto text-xs font-medium text-danger">Идёт запись</span>
          </div>
        ) : (
          <>
            <EmojiPicker onPick={insertEmoji} />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-2 hover:text-fg"
              aria-label="Прикрепить фото или видео"
            >
              <ImageIcon size={20} />
            </button>
            <input
              value={text}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitText();
                }
              }}
              placeholder="Сообщение…"
              aria-label="Текст сообщения"
              className="min-h-11 min-w-0 flex-1 rounded-full border border-border bg-surface-1 px-4 py-2.5 text-sm outline-none focus:border-accent"
            />
          </>
        )}

        {/* Правая кнопка: отправить вложение / отправить текст / запись голоса */}
        {pending.length > 0 ? (
          <button
            onClick={sendPending}
            disabled={sending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition disabled:opacity-60"
            aria-label="Отправить вложения"
          >
            <Send size={18} />
          </button>
        ) : recording ? (
          <>
            <button
              onClick={cancelRec}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-secondary hover:bg-surface-2"
              aria-label="Отменить запись"
            >
              <X size={20} />
            </button>
            <button
              onClick={finishRec}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition"
              aria-label="Отправить голосовое"
            >
              <Check size={20} />
            </button>
          </>
        ) : text.trim() ? (
          <button
            onClick={submitText}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition"
            aria-label="Отправить"
          >
            <Send size={18} />
          </button>
        ) : (
          <button
            onClick={startRec}
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition",
              rec.status === "denied" && "opacity-60",
            )}
            aria-label="Записать голосовое"
            title={rec.status === "denied" ? "Нет доступа к микрофону" : rec.status === "unsupported" ? "Запись не поддерживается" : undefined}
          >
            <Mic size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
