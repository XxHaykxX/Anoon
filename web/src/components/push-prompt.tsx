"use client";

import { Bell, X } from "lucide-react";
import { useState } from "react";

import { PUSH_SUPPORTED } from "@/lib/push";
import { useMounted } from "@/lib/use-mounted";
import { usePush } from "@/store/push";

const DISMISS_KEY = "anoon-push-prompt-dismissed";

// Заметный баннер на главной: предлагает включить уведомления, если ещё не решено.
// Установка PWA сама разрешение НЕ запрашивает — просит только этот тап (user gesture).
export function PushPrompt() {
  const mounted = useMounted();
  const { enabled, status, error, enable } = usePush();
  const [dismissed, setDismissed] = useState(false);

  if (!mounted || !PUSH_SUPPORTED) return null;
  if (enabled) return null;
  // Уже решал (granted→enabled выше; denied — не мучаем) или закрыл баннер.
  const permission = typeof Notification !== "undefined" ? Notification.permission : "denied";
  if (permission === "denied") return null;
  if (dismissed || (typeof localStorage !== "undefined" && localStorage.getItem(DISMISS_KEY))) return null;

  const busy = status === "subscribing";
  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  };

  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
        <Bell size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">Включите уведомления</p>
        <p className="text-xs text-fg-muted">{error ?? "Чтобы не пропустить новые сообщения и собеседников."}</p>
      </div>
      <button
        onClick={() => void enable()}
        disabled={busy}
        className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition hover:bg-accent/85 disabled:opacity-50"
      >
        {busy ? "…" : "Включить"}
      </button>
      <button onClick={close} aria-label="Скрыть" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-muted hover:text-fg">
        <X size={16} />
      </button>
    </div>
  );
}
