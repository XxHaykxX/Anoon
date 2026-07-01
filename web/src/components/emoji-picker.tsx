"use client";

import { Smile } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Компактный эмодзи-пикер: часто используемые. Вставляет символ через onPick.
const EMOJI = [
  "😀", "😂", "🥹", "😍", "😎", "🤔", "😉", "🙃",
  "😭", "😅", "😬", "😴", "🤗", "🤭", "😳", "🥳",
  "👍", "👎", "🙏", "👏", "🔥", "❤️", "💔", "✨",
  "🎉", "😱", "🤝", "👀", "💯", "😇", "🤫", "🫶",
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Эмодзи"
        aria-expanded={open}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-2 hover:text-fg"
      >
        <Smile size={20} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Выбор эмодзи"
          className="absolute bottom-[52px] left-0 z-20 grid w-max max-w-[calc(100vw-1.5rem)] grid-cols-8 gap-1 rounded-2xl border border-white/10 bg-surface-2 p-2 shadow-2xl"
        >
          {EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-2xl leading-none hover:bg-white/10"
            >
              {e}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
