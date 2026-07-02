"use client";

import { Check, CheckCheck, CornerUpLeft, MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { LightboxItem } from "@/components/media-lightbox";
import { MessageBubble } from "@/components/message-bubble";
import { type Msg, type MsgStatus } from "@/store/chat";
import { cn } from "@/lib/utils";

// Тики статуса своего сообщения: ✓ отправлено · ✓✓ доставлено (серые) · ✓✓ просмотрено (синие).
function StatusTicks({ status }: { status?: MsgStatus }) {
  const read = status === "read";
  const label = read ? "Просмотрено" : status === "delivered" ? "Доставлено" : "Отправлено";
  return (
    <span
      className={cn("mt-0.5 flex items-center gap-0.5 self-end pr-1", read ? "text-sky-400" : "text-fg-muted")}
      aria-label={label}
      title={label}
    >
      {status === "sent" ? <Check size={14} /> : <CheckCheck size={14} />}
    </span>
  );
}

// Быстрые эмодзи для лонг-пресс пикера (T10). ❤️ первым — тот же эмодзи, что и двойной тап.
const REACTION_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];
const LONG_PRESS_MS = 450;
const DOUBLE_TAP_MS = 300;

// Строка сообщения: цитата-ответ (если есть) + пузырь + меню действий (ответить/удалить).
// onReact передаётся ТОЛЬКО из личики (dm/[id]) — двойной тап по пузырю = ❤️ (toggle),
// лонг-пресс = пикер эмодзи. В рулетке (chat/[id]) проп не передаётся — жесты не активны.
export function MessageRow({
  m,
  onOpenMedia,
  onView,
  onReply,
  onDelete,
  onReact,
  myPublicId,
}: {
  m: Msg;
  onOpenMedia: (item: LightboxItem) => void;
  onView?: (m: Msg) => void;
  onReply: (m: Msg) => void;
  onDelete: (m: Msg) => void;
  onReact?: (m: Msg, emoji: string | null) => void;
  myPublicId?: string;
}) {
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastTapRef = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  useEffect(() => {
    if (!picker) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPicker(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [picker]);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const pick = (emoji: string) => {
    const mine = myPublicId ? m.reactions?.[myPublicId] : undefined;
    onReact?.(m, mine === emoji ? null : emoji);
    setPicker(false);
  };

  // Pointer Events — единый путь для мыши/тача/пера. Долгое нажатие открывает пикер эмодзи;
  // короткий второй тап в пределах DOUBLE_TAP_MS после первого — toggle ❤️.
  const onPointerDown = () => {
    if (!onReact) return;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      setPicker(true);
    }, LONG_PRESS_MS);
  };
  const onPointerUp = () => {
    if (!onReact) return;
    const longFired = longPressTimer.current === null;
    clearLongPress();
    if (longFired) return; // пикер уже открыт — не считаем это тапом
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      pick("❤️");
    } else {
      lastTapRef.current = now;
    }
  };
  const reactionCounts: [string, number][] = m.reactions
    ? Object.entries(
        Object.values(m.reactions).reduce<Record<string, number>>((acc, e) => {
          acc[e] = (acc[e] ?? 0) + 1;
          return acc;
        }, {}),
      )
    : [];

  return (
    <div ref={rootRef} className={cn("group flex items-end gap-1", m.mine ? "flex-row-reverse" : "flex-row")}>
      <div className="flex max-w-[76%] flex-col">
        {m.replyText ? (
          <div
            className={cn(
              "mb-0.5 truncate rounded-lg border-l-2 border-accent/70 bg-white/5 px-2 py-1 text-xs text-fg-muted",
              m.mine ? "self-end" : "self-start",
            )}
          >
            {m.replyText}
          </div>
        ) : null}
        <div className={cn("relative flex", m.mine ? "justify-end" : "justify-start")}>
          <div onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerLeave={clearLongPress}>
            <MessageBubble m={m} onOpenMedia={onOpenMedia} onView={onView} />
          </div>
          {picker ? (
            <div
              role="menu"
              aria-label="Выбрать реакцию"
              className={cn(
                "absolute bottom-full z-10 mb-1.5 flex gap-1 rounded-full border border-white/10 bg-surface-2 px-2 py-1.5 shadow-2xl",
                m.mine ? "right-0" : "left-0",
              )}
            >
              {REACTION_EMOJIS.map((e) => (
                <button
                  key={e}
                  role="menuitem"
                  onClick={() => pick(e)}
                  aria-label={`Реакция ${e}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-lg transition hover:bg-white/10 active:scale-90"
                >
                  {e}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {reactionCounts.length ? (
          <div className={cn("mt-0.5 flex gap-1", m.mine ? "justify-end" : "justify-start")}>
            {reactionCounts.map(([emoji, count]) => (
              <span
                key={emoji}
                className="rounded-full border border-white/10 bg-surface-2 px-1.5 py-0.5 text-xs leading-none"
              >
                {emoji}
                {count > 1 ? ` ${count}` : ""}
              </span>
            ))}
          </div>
        ) : null}
        {m.mine ? <StatusTicks status={m.status} /> : null}
      </div>

      <div className="relative shrink-0">
        <button
          onClick={() => setMenu((v) => !v)}
          aria-label="Действия с сообщением"
          aria-expanded={menu}
          className="flex h-7 w-7 items-center justify-center rounded-full text-fg-muted opacity-0 transition group-hover:opacity-100 focus:opacity-100 aria-expanded:opacity-100"
        >
          <MoreHorizontal size={16} />
        </button>
        {menu ? (
          <div
            role="menu"
            className={cn(
              "absolute bottom-8 z-10 w-36 overflow-hidden rounded-xl border border-white/10 bg-surface-2 text-sm shadow-2xl",
              m.mine ? "right-0" : "left-0",
            )}
          >
            <button
              role="menuitem"
              onClick={() => {
                onReply(m);
                setMenu(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5"
            >
              <CornerUpLeft size={15} /> Ответить
            </button>
            {m.mine ? (
              <button
                role="menuitem"
                onClick={() => {
                  onDelete(m);
                  setMenu(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-danger hover:bg-white/5"
              >
                <Trash2 size={15} /> Удалить
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
