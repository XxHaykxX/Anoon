"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import { cn } from "@/lib/utils";

// Модалка завершения разговора + оценка собеседника смайликами (1..5).
const FACES: { rating: number; emoji: string; label: string }[] = [
  { rating: 1, emoji: "😡", label: "Плохо" },
  { rating: 2, emoji: "🙁", label: "Так себе" },
  { rating: 3, emoji: "😐", label: "Нормально" },
  { rating: 4, emoji: "🙂", label: "Хорошо" },
  { rating: 5, emoji: "😍", label: "Отлично" },
];

export function RatingModal({
  by,
  onRate,
  onSkip,
}: {
  by: "me" | "peer";
  onRate: (rating: number) => void;
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);

  const submit = (r: number) => {
    setPicked(r);
    // Короткая пауза для визуального отклика, затем закрытие.
    setTimeout(() => onRate(r), 250);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" role="dialog" aria-modal="true" aria-label="Оценка собеседника">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-surface-1 p-6 text-center shadow-2xl"
      >
        <h2 className="text-lg font-semibold">Разговор завершён</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          {by === "peer" ? "Собеседник завершил разговор." : "Ты завершил разговор."} Оцени собеседника:
        </p>

        <div className="mt-5 flex items-center justify-between gap-1">
          {FACES.map((f) => (
            <motion.button
              key={f.rating}
              whileTap={{ scale: 0.85 }}
              onClick={() => submit(f.rating)}
              aria-label={f.label}
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-2xl text-3xl transition",
                picked === f.rating ? "scale-110 bg-accent/20" : "hover:bg-white/5",
              )}
            >
              {f.emoji}
            </motion.button>
          ))}
        </div>

        <button onClick={onSkip} className="mt-5 text-sm text-fg-muted transition hover:text-fg">
          Пропустить
        </button>
      </motion.div>
    </div>
  );
}
