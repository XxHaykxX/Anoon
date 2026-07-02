"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FacebookIcon } from "@/components/facebook-icon";
import { PasswordField } from "@/components/password-field";
import { accountsEnabled } from "@/lib/supabase";
import { useMounted } from "@/lib/use-mounted";
import { useSession, type OAuthProvider } from "@/store/session";

export default function LoginPage() {
  const router = useRouter();
  const mounted = useMounted();
  const genderLocked = useSession((s) => s.genderLocked);
  const signInEmail = useSession((s) => s.signInEmail);
  const signInWithOAuth = useSession((s) => s.signInWithOAuth);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState<"email" | OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blocked = mounted && (!accountsEnabled || genderLocked);
  useEffect(() => {
    if (blocked) router.replace("/");
  }, [blocked, router]);

  if (!mounted || blocked) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading("email");
    setError(null);
    // hydrateFromSession уже вызван внутри signInEmail — далее только маршрутизация по gender-gate.
    const res = await signInEmail(email.trim(), password);
    setLoading(null);
    if (!res.ok) {
      setError("Неверный email или пароль");
      return;
    }
    const target = useSession.getState().genderLocked;
    router.replace(target ? "/" : "/register/confirm");
  };

  const oauth = async (provider: OAuthProvider) => {
    setError(null);
    setLoading(provider);
    const res = await signInWithOAuth(provider);
    if (!res.ok) {
      setError(res.error ?? "Не удалось войти");
      setLoading(null);
    }
    // При успехе браузер уходит на редирект провайдера — loading не сбрасываем.
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex min-h-dvh flex-col justify-center px-6"
    >
      <h1 className="text-center text-2xl font-bold">Вход</h1>

      <form onSubmit={submit} className="mx-auto mt-8 w-full max-w-sm space-y-4">
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div>
          <label htmlFor="email" className="mb-2 block text-xs font-medium text-fg-secondary">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            required
            className="w-full rounded-xl border border-border bg-surface-1 px-4 py-3.5 text-base outline-none focus:border-accent"
          />
        </div>

        <PasswordField label="Пароль" value={password} onChange={setPassword} autoComplete="current-password" />

        <p className="text-right text-sm">
          <Link href="/recover" className="text-accent hover:underline">
            Забыли пароль?
          </Link>
        </p>

        <button
          type="submit"
          disabled={loading !== null || !email.trim() || password.length < 6}
          className="min-h-11 w-full rounded-xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
        >
          {loading === "email" ? "Входим…" : "Войти"}
        </button>

        <div className="flex items-center gap-3 text-xs text-fg-muted">
          <span className="h-px flex-1 bg-border" />
          или
          <span className="h-px flex-1 bg-border" />
        </div>

        <button
          type="button"
          onClick={() => void oauth("google")}
          disabled={loading !== null}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-1 px-4 py-3.5 text-base font-medium text-fg transition hover:bg-surface-2 disabled:opacity-60"
        >
          {loading === "google" ? "Входим…" : "Войти через Google"}
        </button>

        <button
          type="button"
          onClick={() => void oauth("facebook")}
          disabled={loading !== null}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-1 px-4 py-3.5 text-base font-medium text-fg transition hover:bg-surface-2 disabled:opacity-60"
        >
          <FacebookIcon size={18} className="text-[#1877f2]" />
          {loading === "facebook" ? "Входим…" : "Войти через Facebook"}
        </button>

        <p className="pt-2 text-center text-sm text-fg-muted">
          Нет аккаунта?{" "}
          <Link href="/register" className="text-accent hover:underline">
            Зарегистрироваться
          </Link>
        </p>
      </form>
    </motion.div>
  );
}
