"use client";

import { ArrowLeft, Bell, BellOff, Check, LogOut, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useMounted } from "@/lib/use-mounted";
import { useModeration } from "@/store/moderation";
import { usePush } from "@/store/push";
import { useSession } from "@/store/session";

export default function SettingsPage() {
  const router = useRouter();
  const mounted = useMounted();
  const { nickname, publicId, setNickname, reset } = useSession();
  const { blocked, unblockPeer } = useModeration();
  const push = usePush();

  const [name, setName] = useState(nickname);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void push.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Синхронизация поля с ником из persist-стора (в т.ч. после гидрации) — в фазе рендера.
  const [prevNick, setPrevNick] = useState(nickname);
  if (nickname !== prevNick) {
    setPrevNick(nickname);
    setName(nickname);
  }

  if (!mounted) return null;

  const blockedIds = Object.keys(blocked);

  const saveName = () => {
    const t = name.trim();
    if (!t || t === nickname) return;
    setNickname(t);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const exit = () => {
    reset();
    router.replace("/");
  };

  return (
    <div className="mx-auto flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <Link href="/" className="flex h-11 w-11 items-center justify-center rounded-full text-fg-secondary hover:bg-surface-2" aria-label="Назад">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-base font-semibold">Настройки</h1>
      </header>

      <div className="flex-1 space-y-8 overflow-y-auto p-5">
        {/* Профиль */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Профиль</h2>
          <div className="text-xs text-fg-muted">
            #ID: <span className="font-mono text-fg-secondary">#{publicId}</span> (не меняется)
          </div>
          <label className="block text-sm text-fg-secondary" htmlFor="nick">
            Ник
          </label>
          <div className="flex gap-2">
            <input
              id="nick"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              className="min-h-11 flex-1 rounded-xl border border-border bg-surface-1 px-4 py-2.5 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={saveName}
              disabled={!name.trim() || name.trim() === nickname}
              className="flex min-h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg transition disabled:opacity-40"
            >
              {saved ? <Check size={16} /> : null}
              {saved ? "Готово" : "Сохранить"}
            </button>
          </div>
        </section>

        {/* Уведомления */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Уведомления</h2>
          <button
            onClick={() => (push.enabled ? void push.disable() : void push.enable())}
            disabled={push.status === "subscribing"}
            aria-pressed={push.enabled}
            className="flex w-full min-h-11 items-center gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3 text-sm transition hover:bg-surface-2 disabled:opacity-50"
          >
            {push.enabled ? <Bell size={18} className="text-accent" /> : <BellOff size={18} className="text-fg-secondary" />}
            <span className="flex-1 text-left">Push-уведомления</span>
            <span className="text-xs text-fg-muted">
              {push.status === "subscribing" ? "…" : push.enabled ? "вкл" : "выкл"}
            </span>
          </button>
          {push.error ? (
            <p role="alert" className="text-xs text-danger">
              {push.error}
            </p>
          ) : null}
          <p className="text-xs text-fg-muted">
            Push требует HTTPS (или localhost) и VAPID-ключ. Рассылка пока не подключена (нет бэкенда).
          </p>
        </section>

        {/* Заблокированные */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Заблокированные ({blockedIds.length})
          </h2>
          {blockedIds.length === 0 ? (
            <p className="text-sm text-fg-muted">Список пуст.</p>
          ) : (
            <ul className="space-y-2">
              {blockedIds.map((peer) => (
                <li key={peer} className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 px-4 py-2.5">
                  <span className="flex-1 font-mono text-sm">#{peer}</span>
                  <button
                    onClick={() => unblockPeer(peer)}
                    className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg"
                  >
                    <ShieldOff size={15} /> Разблокировать
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Выход */}
        <section className="space-y-3 border-t border-border pt-6">
          <button
            onClick={exit}
            className="flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border border-danger/40 px-4 py-3 text-sm font-medium text-danger transition hover:bg-danger/10"
          >
            <LogOut size={18} /> Выйти (сбросить профиль)
          </button>
          <p className="text-xs text-fg-muted">Удалит ник и #ID на этом устройстве.</p>
        </section>
      </div>
    </div>
  );
}
