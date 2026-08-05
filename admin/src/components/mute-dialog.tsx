"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export type MuteTarget = { nickname: string; publicId: string };
export type MuteResult = { reason: string; durationLabel: string; hours: number };

const REASONS = ["Спам", "Флуд", "Оскорбления", "Другое"];
const DURATIONS: { label: string; hours: number }[] = [
  { label: "1 час", hours: 1 },
  { label: "24 часа", hours: 24 },
  { label: "7 дней", hours: 24 * 7 },
];

// Мут (мягче бана): временное ограничение на отправку. Всегда со сроком.
export function MuteDialog({
  target,
  onConfirm,
  onClose,
}: {
  target: MuteTarget | null;
  onConfirm: (r: MuteResult) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [duration, setDuration] = useState(DURATIONS[1]);

  const [prevTarget, setPrevTarget] = useState(target);
  if (target !== prevTarget) {
    setPrevTarget(target);
    setReason("");
    setNote("");
    setDuration(DURATIONS[1]);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const finalReason = reason === "Другое" || !reason ? note.trim() : reason + (note.trim() ? ` — ${note.trim()}` : "");
  const canConfirm = finalReason.length > 0;

  return (
    <AnimatePresence>
      {target && (
        <motion.div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/55" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative w-full max-w-md rounded-2xl border border-border bg-surface-1 p-6 shadow-2xl"
          >
            <h2 className="text-lg font-semibold">Замьютить пользователя</h2>
            <p className="mt-1 text-sm text-fg-secondary">
              {target.nickname} <span className="font-mono text-fg-muted">#{target.publicId}</span>
            </p>
            <p className="mt-1 text-xs text-fg-muted">Не сможет отправлять сообщения, но сможет читать.</p>

            <p className="mt-5 mb-2 text-xs font-medium text-fg-secondary">Причина (обязательно)</p>
            <div className="flex flex-wrap gap-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium transition",
                    reason === r ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-secondary hover:text-fg",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Комментарий (при «Другое» — обязателен)"
              rows={2}
              className="mt-3 w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent"
            />

            <p className="mt-5 mb-2 text-xs font-medium text-fg-secondary">Срок</p>
            <div className="flex gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.label}
                  onClick={() => setDuration(d)}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-2 text-xs font-medium transition",
                    duration.label === d.label ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-secondary hover:text-fg",
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg bg-surface-2 px-4 py-2 text-sm text-fg-secondary transition hover:text-fg">
                Отмена
              </button>
              <button
                disabled={!canConfirm}
                onClick={() => onConfirm({ reason: finalReason, durationLabel: duration.label, hours: duration.hours })}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:bg-accent/85 disabled:opacity-40"
              >
                Замьютить
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
