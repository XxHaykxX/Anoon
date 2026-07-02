"use client";

import { Bell, Check } from "lucide-react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useRequireAccount } from "@/lib/use-require-account";
import { cn } from "@/lib/utils";
import { useNotifications, type Notif } from "@/store/notifications";

// Относительное время на русском — короткий формат, как в остальном приложении (lib/last-seen.ts).
function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн назад`;
  return new Date(ts).toLocaleDateString("ru-RU");
}

export default function NotificationsPage() {
  const gate = useRequireAccount();
  const router = useRouter();
  const notifs = useNotifications((s) => s.notifs);
  const unreadCount = useNotifications((s) => s.unreadCount);
  const markAllRead = useNotifications((s) => s.markAllRead);

  // Зашёл на экран — считаем всё прочитанным (гасим badge).
  useEffect(() => {
    if (gate !== "ready") return;
    markAllRead();
  }, [gate, markAllRead]);

  if (gate !== "ready") return null;

  const open = (n: Notif) => {
    router.push(n.url); // url всегда есть (SW нормализует, фолбэк "/") — см. store/notifications.ts
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
      <header className="mb-4 flex items-center gap-3">
        <h1 className="flex-1 text-xl font-bold">Уведомления</h1>
        {unreadCount > 0 ? (
          <button
            onClick={() => markAllRead()}
            className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-accent transition hover:bg-accent/10"
          >
            <Check size={14} /> Прочитать все
          </button>
        ) : null}
      </header>

      {notifs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Bell size={32} className="text-fg-muted" />
          <p className="text-sm text-fg-secondary">Пока нет уведомлений</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notifs.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => open(n)}
                className={cn(
                  "w-full rounded-2xl border border-white/10 bg-surface-1 p-4 text-left transition hover:bg-surface-2",
                  !n.read && "border-l-2 border-l-accent",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-fg">{n.title}</span>
                  <span className="shrink-0 text-xs text-fg-muted">{timeAgo(n.ts)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-fg-secondary">{n.body}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
