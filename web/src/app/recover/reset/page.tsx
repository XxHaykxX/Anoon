"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { PasswordField } from "@/components/password-field";
import { accountsEnabled, supabase, supabaseConfigured } from "@/lib/supabase";
import { useMounted } from "@/lib/use-mounted";
import { useSession } from "@/store/session";

// Ссылка из письма восстановления ведёт сюда с recovery-кодом в URL — PKCE обменивает его
// на сессию автоматически (detectSessionInUrl). Ждём её так же, как /auth/callback.
function waitForRecoverySession(timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      listener.subscription.unsubscribe();
      clearInterval(poll);
      resolve(ok);
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish(true);
    });
    const poll = setInterval(async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) finish(true);
    }, 300);
    const timer = setTimeout(() => finish(false), timeoutMs);
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish(true);
    });
  });
}

export default function RecoverResetPage() {
  const router = useRouter();
  const mounted = useMounted();
  const updatePassword = useSession((s) => s.updatePassword);
  const hydrateFromSession = useSession((s) => s.hydrateFromSession);

  const [checking, setChecking] = useState(true);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !mounted) return;
    ran.current = true;
    void (async () => {
      if (!supabaseConfigured) {
        setExpired(true);
        setChecking(false);
        return;
      }
      const ok = await waitForRecoverySession();
      setExpired(!ok);
      setChecking(false);
    })();
  }, [mounted]);

  useEffect(() => {
    if (mounted && !accountsEnabled) router.replace("/");
  }, [mounted, router]);

  if (!mounted || !accountsEnabled) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || password.length < 6) return;
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await updatePassword(password);
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? "Не удалось сохранить пароль");
      return;
    }
    setDone(true);
    const target = await hydrateFromSession();
    setTimeout(() => router.replace(target === "confirm" ? "/register/confirm" : "/"), 1200);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex min-h-dvh flex-col justify-center px-6"
    >
      {checking ? (
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden />
          <p className="text-sm text-fg-secondary">Проверяем ссылку…</p>
        </div>
      ) : expired ? (
        <div className="mx-auto w-full max-w-sm text-center">
          <h1 className="text-xl font-bold">Ссылка устарела</h1>
          <p className="mt-2 text-sm text-fg-secondary">Запросите новую ссылку для сброса пароля.</p>
          <Link
            href="/recover"
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-4 text-base font-semibold text-accent-fg transition hover:bg-accent-hover"
          >
            Запросить новую
          </Link>
        </div>
      ) : done ? (
        <p className="text-center text-sm text-fg-secondary">Пароль сохранён — входим…</p>
      ) : (
        <form onSubmit={submit} className="mx-auto w-full max-w-sm space-y-4">
          <h1 className="text-center text-xl font-bold">Новый пароль</h1>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <PasswordField label="Новый пароль" value={password} onChange={setPassword} autoComplete="new-password" />
          <PasswordField label="Повторите пароль" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          <button
            type="submit"
            disabled={loading || password.length < 6}
            className="min-h-11 w-full rounded-xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
          >
            {loading ? "Сохраняем…" : "Сохранить"}
          </button>
        </form>
      )}
    </motion.div>
  );
}
