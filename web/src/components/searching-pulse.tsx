"use client";

import { motion } from "framer-motion";
import { Search } from "lucide-react";

// Пульсирующая анимация во время поиска собеседника. Концентрические круги + иконка.
export function SearchingPulse({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="relative flex h-44 w-44 items-center justify-center">
        {/* Пульсирующие кольца */}
        {[0, 0.6, 1.2].map((delay) => (
          <motion.span
            key={delay}
            className="absolute inset-0 rounded-full border border-accent/50"
            initial={{ scale: 0.5, opacity: 0.7 }}
            animate={{ scale: 1.9, opacity: 0 }}
            transition={{ duration: 1.8, ease: "easeOut", repeat: Infinity, delay }}
          />
        ))}
        {/* Центр с иконкой */}
        <motion.div
          className="flex h-24 w-24 items-center justify-center rounded-full bg-accent text-accent-fg shadow-2xl"
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 1.4, ease: "easeInOut", repeat: Infinity }}
        >
          <Search size={34} />
        </motion.div>
      </div>

      <div>
        <p className="text-lg font-semibold" aria-live="polite">
          Ищем собеседника…
        </p>
        <p className="mt-1 text-sm text-fg-secondary">Подбираем по твоим фильтрам</p>
      </div>

      <button
        onClick={onCancel}
        className="rounded-full border border-white/15 bg-white/5 px-6 py-2.5 text-sm font-medium text-fg-secondary transition hover:text-fg"
      >
        Отмена
      </button>
    </div>
  );
}
