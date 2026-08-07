"use client";

import { AnoonAvatar } from "@/components/anoon/_shared";
import { ChevronLeftIcon, LockIcon } from "@/components/icons";
import { useAnoonNav } from "@/components/anoon/anoonNav";

interface Bubble {
  id: string;
  side: "in" | "out";
  text: string;
  time: string;
}

const thread: Bubble[] = [
  { id: "b1", side: "in", text: "Привет! Как настроение сегодня?", time: "14:02" },
  { id: "b2", side: "out", text: "Привет, всё отлично, а у тебя?", time: "14:03" },
  { id: "b3", side: "in", text: "Тоже хорошо. Чем занимаешься на выходных?", time: "14:03" },
  { id: "b4", side: "out", text: "Планирую сходить в горы, если погода позволит", time: "14:05" },
];

/**
 * Desktop (≥1024): this is a chat, not a form, so the column is wider than the
 * auth screens' — but it still needs a cap: at the shell's full 60rem a bubble's
 * `max-w-[78%]` is ~750px and a two-word reply spans half the monitor. Hairlines
 * (header/composer borders) stay full-bleed; only their contents ride the column.
 * Both halves of the variant are load-bearing — see docs/DESKTOP-LAYOUT.md.
 */
const DESKTOP_THREAD =
  "lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:w-full lg:[.anoon-desktop_&]:max-w-[36rem]";

export default function AnoonMuted() {
  const nav = useAnoonNav();
  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      {/* Header */}
      {/* Chat-style header: keeps AnoonPrivateChat's dense gutter rather than the
          px-6 pt-6 of the standalone screens. `px-3 -ml-2` puts the 44px target on
          the same 4px left edge as everywhere else, and `py-2` keeps the row at
          61px — the same height as AnoonPrivateChat's header. */}
      <div className="shrink-0 border-b border-border">
        <div className={`flex items-center gap-1 px-3 py-2 ${DESKTOP_THREAD}`}>
          <button
            type="button"
            onClick={() => nav.back()}
            className="-ml-2 grid size-12 shrink-0 cursor-pointer select-none place-items-center rounded-full text-foreground transition-transform active:scale-95"
            aria-label="Назад"
          >
            <ChevronLeftIcon className="size-6" />
          </button>
          <AnoonAvatar initials="SA" tone={4} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">Собеседник ~SAMPLE</p>
            <p className="truncate text-xs text-muted-foreground">был(а) недавно</p>
          </div>
        </div>
      </div>

      {/* Thread (read-only) */}
      <div className={`flex-1 space-y-2 overflow-y-auto px-4 py-4 ${DESKTOP_THREAD}`}>
        {thread.map((b) => (
          <div key={b.id} className={`flex ${b.side === "out" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${
                b.side === "out"
                  ? "bg-bubble-out text-bubble-out-foreground"
                  : "bg-bubble-in text-bubble-in-foreground"
              }`}
            >
              <p className="text-sm leading-snug">{b.text}</p>
              <p
                className={`mt-1 text-right text-[10px] ${
                  b.side === "out" ? "text-bubble-out-foreground/60" : "text-muted-foreground"
                }`}
              >
                {b.time}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Muted notice instead of composer */}
      <div className="shrink-0 border-t border-border">
        <div className={`px-4 py-4 ${DESKTOP_THREAD}`}>
          <div className="flex items-center justify-center gap-2.5 rounded-2xl bg-muted px-4 py-3.5 text-center">
            <LockIcon className="size-5 shrink-0 text-muted-foreground" />
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">Вы не можете отправлять сообщения</p>
              <p className="text-xs text-muted-foreground">Чтение доступно. Ограничение наложено администратором.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
