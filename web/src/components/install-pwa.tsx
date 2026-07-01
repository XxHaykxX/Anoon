"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Download, Share, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useMounted } from "@/lib/use-mounted";
import { cn } from "@/lib/utils";

// Кнопка «Установить приложение».
// — Android/Chrome: перехват `beforeinstallprompt` → своя кнопка → нативный prompt().
// — iOS/Safari: события нет → подсказка «Поделиться → На экран Домой».
// — Скрыта, если уже установлено (display-mode: standalone) или dismiss.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

export function InstallPwa({ className }: { className?: string }) {
  const mounted = useMounted();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  // Слушатели ставят состояние только из обработчиков событий (не синхронно в effect).
  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Видимость выводим из состояния (без setState в effect → без SSR-mismatch).
  const standalone = mounted && isStandalone();
  const iosInstallable = mounted && isIos() && !standalone;
  const visible = !installed && !standalone && (deferred !== null || iosInstallable);

  if (!visible) return null;

  const onClick = async () => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setDeferred(null);
    } else {
      // iOS — переключаем подсказку.
      setShowIosHint((v) => !v);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={onClick}
        aria-label="Установить приложение"
        aria-expanded={showIosHint}
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-fg-secondary transition hover:text-fg",
          className,
        )}
      >
        <Download size={18} />
      </button>

      <AnimatePresence>
        {showIosHint ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            role="dialog"
            aria-label="Как установить на iPhone"
            className="absolute right-0 top-[52px] z-20 w-64 rounded-2xl border border-white/10 bg-surface-2 p-4 text-left text-sm shadow-2xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">Установить на iPhone</span>
              <button onClick={() => setShowIosHint(false)} aria-label="Закрыть" className="text-fg-muted hover:text-fg">
                <X size={16} />
              </button>
            </div>
            <p className="text-fg-secondary">
              Нажми <Share size={14} className="inline align-text-bottom" /> «Поделиться» внизу Safari, затем
              «На экран “Домой”».
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
