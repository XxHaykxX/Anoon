"use client";

import { Download, Share, X } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/use-mounted";

// PWA админки: регистрация service worker + кнопка «Установить».
// Android/Chrome — перехват beforeinstallprompt → нативный prompt. iOS — подсказка «Поделиться».

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

export function AdminPwa({ className }: { className?: string }) {
  const mounted = useMounted();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  // Регистрация SW.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("[admin pwa] SW не зарегистрирован", err));
  }, []);

  // Install-события — только из обработчиков.
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
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-fg-secondary transition hover:text-fg",
          className,
        )}
      >
        <Download size={16} />
      </button>

      {showIosHint ? (
        <div
          role="dialog"
          aria-label="Как установить на iPhone"
          className="absolute right-0 top-11 z-30 w-64 rounded-2xl border border-border bg-surface-2 p-4 text-left text-sm shadow-2xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">Установить на iPhone</span>
            <button onClick={() => setShowIosHint(false)} aria-label="Закрыть" className="text-fg-muted hover:text-fg">
              <X size={16} />
            </button>
          </div>
          <p className="text-fg-secondary">
            Нажми <Share size={14} className="inline align-text-bottom" /> «Поделиться» внизу Safari, затем «На экран “Домой”».
          </p>
        </div>
      ) : null}
    </div>
  );
}
