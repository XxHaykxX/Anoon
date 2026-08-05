"use client";

import { useEffect, useRef } from "react";

/** Quick-reaction emoji shown in the pill, in display order. */
const QUICK_EMOJIS = ["\u{1F44D}", "❤️", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F525}"] as const;

export interface ReactionBarProps {
  /** Called with the picked emoji (e.g. "👍"). */
  onPick: (emoji: string) => void;
  /** Called on outside tap, or after a pick — dismiss the picker. */
  onClose?: () => void;
}

/**
 * Small floating row of quick emoji reactions, meant to appear above a message
 * on long-press. Positioning is the caller's job (this renders just the pill).
 *
 * Usage: `{pickerFor && <ReactionBar onPick={(e) => react(pickerFor, e)} onClose={() => setPickerFor(null)} />}`
 */
export default function ReactionBar({ onPick, onClose }: ReactionBarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!onClose) return;
    function handlePointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose?.();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  const handlePick = (emoji: string) => {
    onPick(emoji);
    onClose?.();
  };

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="Быстрые реакции"
      className="anoon-reaction-pop flex items-center gap-0.5 rounded-full border border-border bg-popover px-2 py-1.5 shadow-xl"
    >
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          role="menuitem"
          aria-label={`Реакция ${emoji}`}
          onClick={() => handlePick(emoji)}
          className="grid size-9 shrink-0 place-items-center rounded-full text-xl transition-transform hover:bg-muted active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          {emoji}
        </button>
      ))}

      <style>{`
        @keyframes anoon-reaction-pop {
          from {
            opacity: 0;
            transform: scale(0.6) translateY(6px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        .anoon-reaction-pop {
          animation: anoon-reaction-pop 0.16s cubic-bezier(0.34, 1.56, 0.64, 1) both;
          transform-origin: bottom center;
        }
        @media (prefers-reduced-motion: reduce) {
          .anoon-reaction-pop {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
