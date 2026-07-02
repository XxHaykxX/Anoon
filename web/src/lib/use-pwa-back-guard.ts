"use client";

import { useEffect } from "react";

// Баг: в установленной PWA (display:"standalone", см. public/manifest.webmanifest) системная/
// жестовая «назад» ЗАКРЫВАЕТ приложение вместо навигации. Причина: Android даёт свежей
// standalone-активности всего ОДНУ запись в history (start_url); плюс OAuth-редиректы и
// router.replace() на гейтах местами схлопывают стек до той же одной записи. При depth=1
// history.back() уходит закрывать активность — там просто нет более ранней записи.
//
// Фикс — стандартный для гибридных/PWA-приложений (без борьбы с внутренним popstate Next.js —
// это НЕ push/replace, роутер их не видит и не участвует): досеваем ОДНУ лишнюю запись в history
// с тем же URL, если на старте её нет. Первый back тогда просто гасится браузером на этой
// записи (страница визуально не меняется — тот же URL), и до реального выхода нужен второй back.
// Сеется РОВНО один раз за живой сеанс: эффект висит на AppProviders (маунтится один раз на
// всё приложение, не ремаунтится при клиентской навигации) — а не на каждой странице.
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mql = window.matchMedia?.("(display-mode: standalone)");
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return Boolean(mql?.matches || iosStandalone);
}

export function usePwaBackGuard() {
  useEffect(() => {
    if (!isStandalone()) return;
    if (window.history.length > 1) return; // уже есть куда возвращаться — досев не нужен
    window.history.pushState({ anoonFloor: true }, "", window.location.href);
  }, []);
}
