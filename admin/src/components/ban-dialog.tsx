"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export type BanTarget = { nickname: string; publicId: string };
export type BanResult = { reason: string; durationLabel: string; expiresDays: number | null };

const REASONS = ["Спам", "Оскорбления", "Сексуальное", "Противоправное", "Другое"];
const DURATIONS: { label: string; days: number | null }[] = [
  { label: "Перманентный", days: null },
  { label: "7 дней", days: 7 },
  { label: "30 дней", days: 30 },
];

export function BanDialog({
  target,
  onConfirm,
  onClose,
  allowPermanent = true,
}: {
  target: BanTarget | null;
  onConfirm: (r: BanResult) => void;
  onClose: () => void;
  allowPermanent?: boolean; // false для moderator — перманентный бан только у super_admin
}) {
  // Модератору перманент недоступен: убираем опцию и дефолтимся на «7 дней».
  const durations = allowPermanent ? DURATIONS : DURATIONS.filter((d) => d.days !== null);
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [duration, setDuration] = useState(durations[0]);

  // Сброс полей при смене цели — паттерн «правка состояния во время рендера»
  // (react.dev: предпочтительнее setState в эффекте).
  const [prevTarget, setPrevTarget] = useState(target);
  if (target !== prevTarget) {
    setPrevTarget(target);
    setReason("");
    setNote("");
    setDuration(durations[0]);
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
          {/* scrim 55% */}
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
            <h2 className="text-lg font-semibold">Забанить пользователя</h2>
            <p className="mt-1 text-sm text-fg-secondary">
              {target.nickname} <span className="font-mono text-fg-muted">#{target.publicId}</span>
            </p>

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
              {durations.map((d) => (
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
                onClick={() => onConfirm({ reason: finalReason, durationLabel: duration.label, expiresDays: duration.days })}
                className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white transition hover:bg-danger/85 disabled:opacity-40"
              >
                Забанить
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
