"use client";

import type { AuthProvider } from "@refinedev/core";

// Реальный admin-auth (NEXT_PUBLIC_DATA_MODE=api): httpOnly-cookie сессия через /api/auth/*.
// Пароль argon2id + опц. 2FA (TOTP) проверяются на сервере (route handlers).
export const apiAuthProvider: AuthProvider = {
  login: async ({ email, password, totp }) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, totp }),
    });
    if (res.ok) return { success: true, redirectTo: "/reports" };
    const body = (await res.json().catch(() => ({}))) as { error?: string; need2fa?: boolean };
    return {
      success: false,
      error: { name: body.need2fa ? "Нужен код 2FA" : "Ошибка входа", message: body.error ?? "Неверные данные" },
    };
  },

  logout: async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    return { success: true, redirectTo: "/login" };
  },

  check: async () => {
    const res = await fetch("/api/auth/me");
    return res.ok ? { authenticated: true } : { authenticated: false, redirectTo: "/login" };
  },

  getIdentity: async () => {
    const res = await fetch("/api/auth/me");
    if (!res.ok) return null;
    return res.json();
  },

  getPermissions: async () => {
    const res = await fetch("/api/auth/me");
    if (!res.ok) return null;
    const { role } = (await res.json()) as { role?: string };
    return role ?? null;
  },

  onError: async (error) => ({ error }),
};
