"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect } from "react";

import { usePush } from "@/store/push";
import { cn } from "@/lib/utils";

// Тумблер push-уведомлений. Разрешение/подписка реальные (Notification + PushManager);
// подписка сохраняется на backend, рассылка — web-push при офлайн-получателе.
export function PushToggle({ className }: { className?: string }) {
  const { enabled, status, error, init, enable, disable } = usePush();

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = status === "subscribing";

  const toggle = () => {
    if (busy) return;
    if (enabled) void disable();
    else void enable();
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={enabled}
      aria-label={enabled ? "Выключить уведомления" : "Включить уведомления"}
      title={error}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition disabled:opacity-50",
        enabled ? "bg-accent text-accent-fg" : "border border-white/10 bg-white/5 text-fg-secondary hover:text-fg",
        className,
      )}
    >
      {enabled ? <Bell size={18} /> : <BellOff size={18} />}
    </button>
  );
}
