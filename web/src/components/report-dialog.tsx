"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { useModeration, type ReportReason } from "@/store/moderation";
import { cn } from "@/lib/utils";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Спам / реклама" },
  { value: "harassment", label: "Оскорбления / травля" },
  { value: "explicit", label: "Непристойный контент" },
  { value: "underage", label: "Подозрение на несовершеннолетнего" },
  { value: "scam", label: "Мошенничество" },
  { value: "other", label: "Другое" },
];

// Диалог жалобы: выбор причины + необязательный комментарий.
// Отправка — мок (useModeration.reportPeer), реальная доставка на сервер — TODO(backend).
export function ReportDialog({ peer, open, onClose }: { peer: string; open: boolean; onClose: () => void }) {
  const reportPeer = useModeration((s) => s.reportPeer);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);

  // Сброс формы при открытии — в фазе рендера (не в effect), чтобы избежать
  // каскадного ре-рендера (react-hooks/set-state-in-effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSent(false);
      setReason("spam");
      setComment("");
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = () => {
    reportPeer(peer, reason, comment.trim() || undefined);
    setSent(true);
    setTimeout(onClose, 1100);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Пожаловаться на собеседника"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-t-2xl border border-border bg-surface-1 p-5 sm:rounded-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Пожаловаться</h2>
              <button
                onClick={onClose}
                aria-label="Закрыть"
                className="flex h-11 w-11 items-center justify-center rounded-full text-fg-secondary hover:bg-surface-2"
              >
                <X size={18} />
              </button>
            </div>

            {sent ? (
              <p className="py-6 text-center text-sm text-fg-secondary">Спасибо, жалоба отправлена.</p>
            ) : (
              <>
                <fieldset className="space-y-1">
                  <legend className="sr-only">Причина жалобы</legend>
                  {REASONS.map((r) => (
                    <label
                      key={r.value}
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                        reason === r.value ? "bg-surface-2 text-fg" : "text-fg-secondary hover:bg-surface-2/60",
                      )}
                    >
                      <input
                        type="radio"
                        name="report-reason"
                        value={r.value}
                        checked={reason === r.value}
                        onChange={() => setReason(r.value)}
                        className="h-4 w-4 shrink-0 accent-[#fdbf2d]"
                      />
                      {r.label}
                    </label>
                  ))}
                </fieldset>

                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Комментарий (необязательно)"
                  rows={2}
                  maxLength={280}
                  className="mt-3 w-full resize-none rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-accent"
                />

                <button
                  onClick={submit}
                  className="mt-4 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
                >
                  Отправить жалобу
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
