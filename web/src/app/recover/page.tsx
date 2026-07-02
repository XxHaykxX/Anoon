"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { accountsEnabled } from "@/lib/supabase";
import { useMounted } from "@/lib/use-mounted";
import { useSession } from "@/store/session";

// Запрос сброса пароля. Из соображений приватности Supabase не сообщает, существует ли email —
// ошибка показывается только при реальном сбое запроса (сеть/лимит), не при «email не найден».
export default function RecoverPage() {
  const router = useRouter();
  const mounted = useMounted();
  const requestPasswordReset = useSession((s) => s.requestPasswordReset);

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (mounted && !accountsEnabled) router.replace("/");
  }, [mounted, router]);

  if (!mounted || !accountsEnabled) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !email.trim()) return;
    setLoading(true);
    setError(null);
    const res = await requestPasswordReset(email.trim());
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? "Не удалось отправить письмо");
      return;
    }
    setSent(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex min-h-dvh flex-col justify-center px-6"
    >
      <h1 className="text-center text-2xl font-bold">Восстановление пароля</h1>

      <div className="mx-auto mt-8 w-full max-w-sm">
        {sent ? (
          <p className="text-center text-sm text-fg-secondary">Проверьте почту — мы отправили ссылку для сброса пароля.</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
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
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="min-h-11 w-full rounded-xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
            >
              {loading ? "Отправляем…" : "Отправить ссылку"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-fg-muted">
          Вспомнили пароль?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Войти
          </Link>
        </p>
      </div>
    </motion.div>
  );
}
