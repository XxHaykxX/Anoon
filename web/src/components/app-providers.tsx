"use client";

import { MotionConfig } from "framer-motion";
import { useEffect } from "react";

import { registerServiceWorker } from "@/lib/push";

// Корневые провайдеры приложения:
// — MotionConfig(reducedMotion="user") — framer-motion сам укорачивает/отключает
//   анимации при prefers-reduced-motion (CSS-правило в globals.css этого не покрывает,
//   framer-motion анимирует через rAF, а не CSS transition/animation).
// — регистрация service worker (для Web Push), см. src/lib/push.ts.
export function AppProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
