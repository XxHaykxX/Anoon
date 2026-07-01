"use client";

import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

// Сегмент-контрол с анимированным «ползунком» (framer layoutId). Одиночный выбор.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  groupId,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  groupId: string;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative flex-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "text-accent-fg" : "text-fg-secondary hover:text-fg",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${groupId}`}
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                className="absolute inset-0 rounded-xl bg-accent"
              />
            )}
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
