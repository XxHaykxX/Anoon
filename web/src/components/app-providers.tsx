"use client";

import { MotionConfig } from "framer-motion";
import { useEffect } from "react";

import { registerServiceWorker } from "@/lib/push";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { useMatchPrefs } from "@/store/match-prefs";

// Heartbeat присутствия: online + lastSeen + realGender. Каждые 30с пока активна вкладка.
// Админка считает «онлайн» по свежести lastSeen (online-флаг сам не сбрасывается на дисконнект).
async function beat() {
  if (!supabaseConfigured) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return;
  await fetch("/api/presence", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ gender: useMatchPrefs.getState().gender }),
  }).catch(() => {});
}

// Корневые провайдеры приложения:
// — MotionConfig(reducedMotion="user") — framer-motion сам укорачивает/отключает
//   анимации при prefers-reduced-motion (CSS-правило в globals.css этого не покрывает,
//   framer-motion анимирует через rAF, а не CSS transition/animation).
// — регистрация service worker (для Web Push), см. src/lib/push.ts.
// — heartbeat присутствия (online-счётчики в админке).
export function AppProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void registerServiceWorker();
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

  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
