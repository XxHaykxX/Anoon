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

// Строка сообщения: цитата-ответ (если есть) + пузырь + меню действий (ответить/удалить).
export function MessageRow({
  m,
  onOpenMedia,
  onView,
  onReply,
  onDelete,
}: {
  m: Msg;
  onOpenMedia: (item: LightboxItem) => void;
  onView?: (m: Msg) => void;
  onReply: (m: Msg) => void;
  onDelete: (m: Msg) => void;
}) {
  const [menu, setMenu] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

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
        <div className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
          <MessageBubble m={m} onOpenMedia={onOpenMedia} onView={onView} />
        </div>
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
