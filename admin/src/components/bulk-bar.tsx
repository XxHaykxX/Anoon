"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

// Sticky bulk-bar: появляется при мультивыборе. Счётчик + действия + «снять выделение».
export type BulkAction = {
  label: string;
  onClick: () => void;
  tone?: "danger" | "neutral";
};

export function BulkBar({
  count,
  actions,
  onClear,
}: {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
}) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          role="region"
          aria-label="Массовые действия"
          className="pointer-events-auto fixed bottom-5 left-1/2 z-30 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-surface-1/95 px-4 py-3 shadow-2xl backdrop-blur sm:flex-nowrap sm:gap-3"
        >
          <span className="text-sm font-medium tabular-nums">
            Выбрано: <span className="text-accent">{count}</span>
          </span>
          <span className="hidden h-5 w-px bg-border sm:block" />
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={a.onClick}
              className={
                a.tone === "danger"
                  ? "rounded-lg bg-danger/15 px-3 py-1.5 text-sm font-medium text-danger transition hover:bg-danger/25"
                  : "rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium text-fg-secondary transition hover:text-fg"
              }
            >
              {a.label}
            </button>
          ))}
          <button
            onClick={onClear}
            aria-label="Снять выделение"
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <X size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
