"use client";

import { CornerUpLeft, MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { LightboxItem } from "@/components/media-lightbox";
import { MessageBubble } from "@/components/message-bubble";
import { type Msg } from "@/store/chat";
import { cn } from "@/lib/utils";

// Строка сообщения: цитата-ответ (если есть) + пузырь + меню действий (ответить/удалить).
export function MessageRow({
  m,
  onOpenMedia,
  onReply,
  onDelete,
}: {
  m: Msg;
  onOpenMedia: (item: LightboxItem) => void;
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
      <div className="flex max-w-[82%] flex-col">
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
          <MessageBubble m={m} onOpenMedia={onOpenMedia} />
        </div>
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
