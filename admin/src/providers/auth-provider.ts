"use client";

import type { AuthProvider } from "@refinedev/core";

// Мок admin-auth (DATA_MODE=mock). Реальная система — отдельная таблица AdminUser
// + argon2id + отдельный ключ/audience JWT + httpOnly-cookie + 2FA (см. questions.md D1/D2).
// Здесь только клиентская заглушка, чтобы пройти логин-гейт в mock-режиме.

const KEY = "anoon-admin-auth";

export const authProvider: AuthProvider = {
  login: async ({ email }) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(KEY, JSON.stringify({ email: email ?? "admin@anoon.app" }));
    }
    return { success: true, redirectTo: "/reports" };
  },

  logout: async () => {
    if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
    return { success: true, redirectTo: "/login" };
  },

  check: async () => {
    const ok = typeof window !== "undefined" && !!window.localStorage.getItem(KEY);
    return ok ? { authenticated: true } : { authenticated: false, redirectTo: "/login" };
  },

  getIdentity: async () => {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const { email } = JSON.parse(raw) as { email: string };
    return { id: "admin", name: email, role: "super_admin" };
  },

  onError: async (error) => ({ error }),
};
