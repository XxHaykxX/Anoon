"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { upsertProfile } from "@/lib/api";
import { supabase, supabaseConfigured } from "@/lib/supabase";

// Анонимная сессия: ник + #ID. Пытаемся получить реальную Supabase-сессию (anonymous auth)
// и профиль с backend; если недоступно (напр. anonymous sign-ins выключен) — локальный мок.
type SessionState = {
  hasProfile: boolean;
  nickname: string;
  publicId: string; // напр. 00042
  authUserId?: string; // Supabase auth uuid, если вошли
  synced: boolean; // профиль подтверждён сервером (не мок)
  creating: boolean;
  error?: string;
  createProfile: (nickname: string) => Promise<void>;
  setNickname: (nickname: string) => void;
  reset: () => Promise<void>;
};

function genPublicId(): string {
  // 5-значный #ID (mock-фолбэк). В проде выдаёт сервер.
  const n = Math.floor(Math.random() * 99999) + 1;
  return String(n).padStart(5, "0");
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      hasProfile: false,
      nickname: "",
      publicId: "",
      synced: false,
      creating: false,

      createProfile: async (nickname) => {
        const nick = nickname.trim();
        // Оптимистично: локальный профиль сразу — приложение работает и без бэкенда.
        set({ creating: true, error: undefined, hasProfile: true, nickname: nick, publicId: get().publicId || genPublicId() });
        try {
          if (!supabaseConfigured) throw new Error("supabase not configured");
          const { data, error } = await supabase.auth.signInAnonymously();
          if (error) throw error;
          const token = data.session?.access_token;
          if (!token) throw new Error("no access token");
          const profile = await upsertProfile(nick, token);
          set({ authUserId: data.user?.id, publicId: profile.publicId, nickname: profile.nickname, synced: true });
        } catch (e) {
          // Фолбэк на локальный мок (например, anonymous sign-ins выключен в Supabase).
          set({ synced: false, error: e instanceof Error ? e.message : "auth failed" });
        } finally {
          set({ creating: false });
        }
      },

      setNickname: (nickname) => set({ nickname: nickname.trim() }),

      reset: async () => {
        try {
          if (supabaseConfigured) await supabase.auth.signOut();
        } catch {
          // игнор — локальный сброс важнее
        }
        set({ hasProfile: false, nickname: "", publicId: "", authUserId: undefined, synced: false, error: undefined });
      },
    }),
    {
      name: "anoon-session",
      partialize: (s) => ({
        hasProfile: s.hasProfile,
        nickname: s.nickname,
        publicId: s.publicId,
        authUserId: s.authUserId,
        synced: s.synced,
      }),
    },
  ),
);
