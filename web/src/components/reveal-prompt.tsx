"use client";

import { motion } from "framer-motion";
import { useState } from "react";

// Баннер входящего запроса раскрытия профилей (в чате рулетки).
// role="alert" — объявляется скринридером сразу при появлении.
// Slide-down 180ms; MotionConfig(reducedMotion="user") в app-providers.tsx сам
// укорачивает анимацию при prefers-reduced-motion — доп. проверки тут не нужны.
export function RevealPrompt({
  peerPublicId,
  onAccept,
  onDecline,
  onBlock,
}: {
  peerPublicId: string;
  onAccept: () => void;
  onDecline: () => void;
  onBlock: () => void;
}) {
  // Гейт от двойного тапа: как только нажали любую кнопку — остальные блокируются до ответа.
  const [busy, setBusy] = useState(false);

  const run = (fn: () => void) => {
    if (busy) return;
    setBusy(true);
    fn();
  };

  return (
    <motion.div
      role="alert"
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -16, opacity: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="rounded-2xl border border-white/10 bg-surface-2 p-4"
    >
      <p className="text-sm text-fg">
        <span className="font-mono text-fg-secondary">#{peerPublicId}</span> хочет открыть профили
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => run(onAccept)}
          disabled={busy}
          className="min-h-11 flex-1 rounded-xl bg-accent px-3 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-50"
        >
          Открыть
        </button>
        <button
          onClick={() => run(onDecline)}
          disabled={busy}
          className="min-h-11 flex-1 rounded-xl border border-white/10 bg-surface-1 px-3 text-sm font-medium text-fg-secondary transition hover:bg-white/5 disabled:opacity-50"
        >
          Отклонить
        </button>
      </div>
      <button
        onClick={() => run(onBlock)}
        disabled={busy}
        className="mt-2 min-h-11 w-full rounded-xl px-3 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-50"
      >
        Заблокировать
      </button>
    </motion.div>
  );
}
