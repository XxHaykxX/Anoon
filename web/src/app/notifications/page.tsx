"use client";

import { Bell, Check, X } from "lucide-react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { respondFriend } from "@/lib/api";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { useRequireAccount } from "@/lib/use-require-account";
import { cn } from "@/lib/utils";
import { useFriendsCache } from "@/store/friends";
import { useNotifications, type Notif } from "@/store/notifications";

async function token(): Promise<string | null> {
  if (!supabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

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
  // Входящие заявки в друзья — глобально обновляются в app-providers (опрос 45с), поэтому здесь
  // сразу доступны без отдельной загрузки. Кнопки Принять/Отклонить прямо в уведомлениях.
  const incoming = useFriendsCache((s) => s.incoming);
  const removeIncomingLocal = useFriendsCache((s) => s.removeIncomingLocal);

  const onAccept = async (publicId: string) => {
    removeIncomingLocal(publicId); // оптимистично
    const t = await token();
    if (t) await respondFriend(publicId, "accept", t).catch(() => {});
    router.push(`/dm/${publicId}`); // приняли → сразу в личку
  };

  const onDecline = async (publicId: string) => {
    removeIncomingLocal(publicId);
    const t = await token();
    if (t) await respondFriend(publicId, "decline", t).catch(() => {});
  };

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
    <div className="mx-auto max-w-lg px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
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

      {/* Входящие заявки в друзья — с кнопками прямо здесь (не надо идти в /friends). */}
      {incoming.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Заявки в друзья</h2>
          <ul className="space-y-2">
            {incoming.map((p) => (
              <li key={p.publicId} className="flex items-center gap-3 rounded-2xl border border-l-2 border-white/10 border-l-accent bg-surface-1 p-3">
                <Avatar publicId={p.publicId} name={p.nickname} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.nickname}</div>
                  <div className="truncate font-mono text-xs text-fg-muted">#{p.publicId} хочет открыть профили</div>
                </div>
                <button onClick={() => void onAccept(p.publicId)} className="flex min-h-9 items-center gap-1 rounded-full bg-accent px-3 text-xs font-medium text-accent-fg">
                  <Check size={14} /> Принять
                </button>
                <button onClick={() => void onDecline(p.publicId)} aria-label="Отклонить" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted hover:text-fg">
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {notifs.length === 0 && incoming.length === 0 ? (
        <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-center">
          <Bell size={32} className="text-fg-muted" />
          <p className="text-sm text-fg-secondary">Пока нет уведомлений</p>
        </div>
      ) : notifs.length > 0 ? (
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
      ) : null}
    </div>
  );
}
