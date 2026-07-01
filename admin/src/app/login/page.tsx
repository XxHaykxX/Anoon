"use client";

import { useLogin } from "@refinedev/core";
import { useState } from "react";

export default function LoginPage() {
  const { mutate: login, isPending } = useLogin();
  const [email, setEmail] = useState("admin@anoon.app");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const mockMode = process.env.NEXT_PUBLIC_DATA_MODE !== "api";

  return (
    <div className="min-h-dvh flex items-center justify-center bg-bg px-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login({ email, password, totp });
        }}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface-1 p-8 shadow-2xl"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-fg text-lg font-semibold">a</div>
          <div>
            <h1 className="text-lg font-semibold text-fg">anoon · admin</h1>
            <p className="text-xs text-fg-muted">Панель модерации</p>
          </div>
        </div>

        <label className="mb-1 block text-xs font-medium text-fg-secondary">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-fg outline-none focus:border-accent"
          autoComplete="username"
        />

        <label className="mb-1 block text-xs font-medium text-fg-secondary">Пароль</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-6 w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-fg outline-none focus:border-accent"
          autoComplete="current-password"
        />

        {!mockMode && (
          <>
            <label className="mb-1 block text-xs font-medium text-fg-secondary">Код 2FA (если включён)</label>
            <input
              inputMode="numeric"
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              placeholder="123456"
              className="mb-6 w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-fg outline-none focus:border-accent"
              autoComplete="one-time-code"
            />
          </>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-50"
        >
          {isPending ? "Вход…" : "Войти"}
        </button>

        {mockMode && <p className="mt-4 text-center text-xs text-fg-muted">Mock-режим: вход с любыми данными.</p>}
      </form>
    </div>
  );
}
