"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type Tone = "success" | "danger";
type Item = { id: number; msg: string; tone: Tone };

let items: Item[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function toast(msg: string, tone: Tone = "success") {
  const item = { id: ++seq, msg, tone };
  items = [...items, item];
  emit();
  setTimeout(() => {
    items = items.filter((i) => i.id !== item.id);
    emit();
  }, 3500);
}

export function Toaster() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            role="alert"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
              "pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-xl",
              t.tone === "danger"
                ? "border-danger/40 bg-surface-1 text-danger"
                : "border-success/40 bg-surface-1 text-success",
            )}
          >
            {t.msg}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
