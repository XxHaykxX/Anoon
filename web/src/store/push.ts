"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { deletePushSubscription, savePushSubscription } from "@/lib/api";
import { PUSH_SUPPORTED, getExistingSubscription, registerServiceWorker, subscribeToPush, unsubscribeFromPush } from "@/lib/push";
import { supabase, supabaseConfigured } from "@/lib/supabase";

// Стор Web Push: хранит намерение пользователя (enabled) + статус. Подписка отправляется
// на backend (POST /push/subscribe); рассылка — через web-push при офлайн-получателе.
async function pushToken(): Promise<string | null> {
  if (!supabaseConfigured) return null;
  // Ретрай — на мобиле supabase-сессия может быть не готова в момент включения push.
  for (let i = 0; i < 5; i++) {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    if (t) return t;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}
type PushState = {
  enabled: boolean;
  status: "idle" | "subscribing" | "error";
  error?: string;
  init: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

export const usePush = create<PushState>()(
  persist(
    (set, get) => ({
      enabled: false,
      status: "idle",

      // Вызывать один раз при маунте UI с тумблером: регистрирует SW и сверяет
      // сохранённое намерение с фактической подпиской браузера.
      init: async () => {
        if (!PUSH_SUPPORTED) return;
        await registerServiceWorker();
        if (!get().enabled) return;
        const sub = await getExistingSubscription();
        if (!sub) set({ enabled: false });
      },

      enable: async () => {
        if (!PUSH_SUPPORTED) {
          set({ status: "error", error: "Push-уведомления не поддерживаются этим браузером" });
          return;
        }
        set({ status: "subscribing", error: undefined });
        try {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            set({ status: "idle", enabled: false, error: "Разрешение на уведомления не выдано" });
            return;
          }
          const sub = await subscribeToPush();
          // Отправить подписку на backend (если авторизованы). Без токена — только локально.
          if (sub) {
            const t = await pushToken();
            if (t) await savePushSubscription(sub.toJSON(), t);
          }
          set({
            enabled: !!sub,
            status: "idle",
            error: sub ? undefined : "Нет VAPID-ключа — см. .env.example (NEXT_PUBLIC_VAPID_PUBLIC_KEY)",
          });
        } catch (err) {
          set({ status: "error", enabled: false, error: err instanceof Error ? err.message : "Ошибка подписки" });
        }
      },

      disable: async () => {
        // Сначала удалить подписку на backend (пока endpoint ещё доступен).
        const existing = await getExistingSubscription();
        if (existing) {
          const t = await pushToken();
          if (t) await deletePushSubscription(existing.endpoint, t);
        }
        await unsubscribeFromPush();
        set({ enabled: false, status: "idle", error: undefined });
      },
    }),
    { name: "anoon-push" },
  ),
);
