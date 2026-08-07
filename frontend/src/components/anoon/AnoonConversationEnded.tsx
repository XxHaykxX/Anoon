"use client";

import { useState } from "react";
import { PRESS_FX } from "@/components/anoon/_shared";

const RATINGS: { value: number; emoji: string; label: string }[] = [
  { value: 1, emoji: "😡", label: "Ужасно" },
  { value: 2, emoji: "🙁", label: "Плохо" },
  { value: 3, emoji: "😐", label: "Нормально" },
  { value: 4, emoji: "🙂", label: "Хорошо" },
  { value: 5, emoji: "😍", label: "Отлично" },
];

export interface AnoonConversationEndedProps {
  onSubmit?: (rating: number) => void;
  onSkip?: () => void;
}

/**
 * "Разговор завершён" overlay with a 5-emoji rating row.
 * Self-contained: tracks the selected rating locally.
 */
export default function AnoonConversationEnded({
  onSubmit,
  onSkip,
}: AnoonConversationEndedProps) {
  const [rating, setRating] = useState<number | null>(null);

  return (
    // Desktop: a bottom sheet is a phone idiom — on a 1440px viewport the same
    // markup is a rating bar glued to the bottom edge with the five emoji a
    // hand-span apart. Centre it and cap it, and the sheet reads as the dialog
    // it already is. `lg:[.anoon-desktop_&]:` needs both halves: `lg:` alone
    // fires in the showcase's 390px frames, the class alone is on the app root
    // at every width (docs/DESKTOP-LAYOUT.md).
    <div className="absolute inset-0 z-50 flex items-end bg-black/60 px-4 pb-6 lg:[.anoon-desktop_&]:items-center lg:[.anoon-desktop_&]:pb-4">
      <div className="anoon-msg-in w-full rounded-3xl border border-border bg-card p-5 shadow-2xl lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:max-w-[26rem]">
        {/* Drag handle — a phone affordance; the centred desktop dialog has
            nothing to drag, so it goes. */}
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted-foreground/30 lg:[.anoon-desktop_&]:hidden" />

        <h2 className="text-center text-lg font-bold text-foreground">
          Разговор завершён
        </h2>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          Оцените собеседника — это поможет находить лучших людей.
        </p>

        <div className="mt-5 flex items-center justify-between px-1">
          {RATINGS.map((r) => {
            const selected = rating === r.value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => setRating(r.value)}
                aria-label={r.label}
                aria-pressed={selected}
                className={`grid size-13 place-items-center rounded-full text-3xl transition-transform ${PRESS_FX} ${
                  selected
                    ? "scale-110 bg-primary/20 ring-2 ring-primary"
                    : "opacity-60 hover:opacity-100"
                }`}
              >
                {r.emoji}
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex justify-between px-1 text-[11px] text-muted-foreground">
          <span>Плохо</span>
          <span>Отлично</span>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={rating === null}
            onClick={() => rating !== null && onSubmit?.(rating)}
            className={`w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground ${PRESS_FX} disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100`}
          >
            Отправить оценку
          </button>
          <button
            type="button"
            onClick={() => onSkip?.()}
            className={`w-full rounded-full py-2.5 text-sm font-medium text-muted-foreground ${PRESS_FX}`}
          >
            Пропустить
          </button>
        </div>
      </div>
    </div>
  );
}
