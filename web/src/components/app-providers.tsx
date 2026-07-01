"use client";

import { MotionConfig } from "framer-motion";
import { useEffect } from "react";

import { registerServiceWorker } from "@/lib/push";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { useMatchPrefs } from "@/store/match-prefs";
import { useSession } from "@/store/session";

// Heartbeat присутствия: online + lastSeen + realGender. Каждые 30с пока активна вкладка.
// Админка считает «онлайн» по свежести lastSeen (online-флаг сам не сбрасывается на дисконнект).
// Ответ несёт статус бана → блокируем UI (сервер-авторитетно).
async function beat() {
  if (!supabaseConfigured) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return;
  const res = await fetch("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ gender: useMatchPrefs.getState().gender }),
  }).catch(() => null);
  if (!res || !res.ok) return;
  const body = (await res.json().catch(() => null)) as
    | { banned?: boolean; reason?: string | null; until?: string | null; muted?: boolean; muteReason?: string | null; muteUntil?: string | null }
    | null;
  if (body) {
    useSession.getState().setBan(Boolean(body.banned), body.reason, body.until);
    useSession.getState().setMute(Boolean(body.muted), body.muteReason, body.muteUntil);
  }
}

// Корневые провайдеры приложения:
// — MotionConfig(reducedMotion="user") — framer-motion сам укорачивает/отключает
//   анимации при prefers-reduced-motion (CSS-правило в globals.css этого не покрывает,
//   framer-motion анимирует через rAF, а не CSS transition/animation).
// — регистрация service worker (для Web Push), см. src/lib/push.ts.
// — heartbeat присутствия (online-счётчики в админке).
// Оверлей блокировки — перекрывает всё приложение, если юзер забанен.
function BannedOverlay() {
  const banned = useSession((s) => s.banned);
  const reason = useSession((s) => s.banReason);
  const until = useSession((s) => s.banUntil);
  if (!banned) return null;
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-bg/95 px-6 text-center backdrop-blur">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger/15 text-3xl">🚫</div>
      <h1 className="text-xl font-semibold text-fg">Доступ заблокирован</h1>
      <p className="max-w-sm text-sm text-fg-secondary">
        {reason ? `Причина: ${reason}.` : "Ваш аккаунт заблокирован модерацией."}
        {until ? ` До ${new Date(until).toLocaleString("ru-RU")}.` : " Блокировка постоянная."}
      </p>
      <p className="text-xs text-fg-muted">Отправка сообщений и поиск недоступны.</p>
    </div>
  );
}

// Авто-обновление: опрашиваем /api/version (id деплоя). Сменился → НЕ дёргаем reload сразу
// (не прерываем набор/чат), а помечаем pending и перезагружаем при возврате в приложение
// (вкладка снова visible после сворачивания) — незаметный момент.
let seenVersion: string | null = null;
let updatePending = false;
async function checkVersion() {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return;
    const { v } = (await res.json()) as { v?: string };
    if (!v) return;
    if (seenVersion === null) {
      seenVersion = v;
      return;
    }
    if (v !== seenVersion) {
      seenVersion = v;
      updatePending = true; // применим при следующем фокусе вкладки
    }
  } catch {
    // офлайн/ошибка — молча
  }
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  // Проверка новой версии: на маунте и каждые 60с (фоново, без reload).
  // Reload — только при возврате на вкладку, если версия сменилась (не прерывает набор/чат).
  useEffect(() => {
    void checkVersion();
    const t = setInterval(() => void checkVersion(), 60_000);
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (updatePending) {
        window.location.reload();
        return;
      }
      void checkVersion();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    void beat();
    const t = setInterval(() => void beat(), 30_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      {children}
      <BannedOverlay />
    </MotionConfig>
  );
}
