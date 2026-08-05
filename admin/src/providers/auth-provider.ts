"use client";

import type { AuthProvider } from "@refinedev/core";

// Мок admin-auth (DATA_MODE=mock). Реальная система — отдельная таблица AdminUser
// + argon2id + отдельный ключ/audience JWT + httpOnly-cookie + 2FA (см. questions.md D1/D2).
// Здесь только клиентская заглушка, чтобы пройти логин-гейт в mock-режиме.

const KEY = "anoon-admin-auth";

// Роль в моке — из email: содержит "moderator" → moderator, иначе super_admin (дефолт для
// прелоаженного admin@anoon.app). Позволяет проверить оба ролевых гейта без реального бэкенда.
function roleFor(email: string): "super_admin" | "moderator" {
  return email.toLowerCase().includes("moderator") ? "moderator" : "super_admin";
}

export const authProvider: AuthProvider = {
  login: async ({ email }) => {
    if (typeof window !== "undefined") {
      const e = email ?? "admin@anoon.app";
      window.localStorage.setItem(KEY, JSON.stringify({ email: e, role: roleFor(e) }));
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
    const { email, role } = JSON.parse(raw) as { email: string; role?: "super_admin" | "moderator" };
    return { id: "admin", name: email, role: role ?? roleFor(email) };
  },

  // Без этого usePermissions() всегда возвращает undefined в mock-режиме — все super_admin-гейты
  // (разбан, перманентный бан, bulk-бан, рассылка) молча вели бы себя как moderator независимо
  // от identity.role.
  getPermissions: async () => {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const { email, role } = JSON.parse(raw) as { email: string; role?: "super_admin" | "moderator" };
    return role ?? roleFor(email);
  },

  onError: async (error) => ({ error }),
};
