"use client";

import { WifiOff } from "lucide-react";

// Офлайн-заглушка в дизайне anoon. SW отдаёт её при отсутствии сети на навигации.
export default function OfflinePage() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 text-center">
      {/* Бренд-свечение (как на главной) */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{ background: "radial-gradient(circle, #fdbf2d 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 -right-16 h-64 w-64 rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(circle, #fdbf2d 0%, transparent 70%)" }}
      />

      <div className="relative flex flex-col items-center gap-5">
        <span className="flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/5 text-accent">
          <WifiOff size={34} />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold">Нет интернета</h1>
          <p className="max-w-xs text-sm text-fg-secondary">
            Проверьте соединение — Wi-Fi или мобильные данные. anoon снова заработает, как только сеть вернётся.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="mt-1 flex h-12 items-center justify-center rounded-full bg-accent px-8 text-base font-semibold text-accent-fg shadow-2xl transition active:scale-95"
        >
          Повторить
        </button>
        <span className="text-lg font-bold opacity-40">anoon</span>
      </div>
    </div>
  );
}
