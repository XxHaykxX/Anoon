"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

import { cn } from "@/lib/utils";

// Универсальный confirm-диалог (bulk-действия и пр.). Modal-motion от источника, scrim, Esc.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Подтвердить",
  tone = "danger",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "accent";
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <AnimatePresence>
      {open && (
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
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-fg-secondary">{message}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg bg-surface-2 px-4 py-2 text-sm text-fg-secondary transition hover:text-fg">
                Отмена
              </button>
              <button
                onClick={onConfirm}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-semibold transition",
                  tone === "danger" ? "bg-danger text-white hover:bg-danger/85" : "bg-accent text-accent-fg hover:bg-accent-hover",
                )}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
