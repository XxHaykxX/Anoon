"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FacebookIcon } from "@/components/facebook-icon";
import { useMounted } from "@/lib/use-mounted";
import { accountsEnabled, appleEnabled } from "@/lib/supabase";
import { useSession, type OAuthProvider } from "@/store/session";

// Выбор способа регистрации: Google (primary) / Email (secondary) / Apple (за флагом, скрыт).
// Гостя нет — это единственная точка входа в приложение для новых пользователей.
export default function RegisterPage() {
  const router = useRouter();
  const mounted = useMounted();
  const genderLocked = useSession((s) => s.genderLocked);
  const signInWithOAuth = useSession((s) => s.signInWithOAuth);
  const [loading, setLoading] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Флаг выключен или уже полностью зарегистрирован на этом устройстве — незачем быть здесь.
  const blocked = mounted && (!accountsEnabled || genderLocked);
  useEffect(() => {
    if (blocked) router.replace("/");
  }, [blocked, router]);

  if (!mounted || blocked) return null;

  const oauth = async (provider: OAuthProvider) => {
    setError(null);
    setLoading(provider);
    const res = await signInWithOAuth(provider);
    if (!res.ok) {
      setError(res.error ?? "Не удалось войти");
      setLoading(null);
    }
    // При успехе браузер уходит на редирект провайдера — состояние загрузки не сбрасываем.
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex min-h-dvh flex-col justify-center px-6"
    >
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-3xl font-bold text-accent-fg">a</div>
      <h1 className="mt-6 text-center text-2xl font-bold">anoon</h1>
      <p className="mt-2 text-center text-sm text-fg-secondary">anoon — раскрывайся, только когда захочешь</p>

      <div className="mx-auto mt-8 w-full max-w-sm space-y-3">
        {error ? (
          <p role="alert" className="text-center text-sm text-danger">
            {error}
          </p>
        ) : null}

        <button
          onClick={() => void oauth("google")}
          disabled={loading !== null}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-60"
        >
          {loading === "google" ? "Входим…" : "Войти через Google"}
        </button>

        <button
          onClick={() => void oauth("facebook")}
          disabled={loading !== null}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-1 px-4 py-3.5 text-base font-medium text-fg transition hover:bg-surface-2 disabled:opacity-60"
        >
          <FacebookIcon size={18} className="text-[#1877f2]" />
          {loading === "facebook" ? "Входим…" : "Войти через Facebook"}
        </button>

        {appleEnabled ? (
          <button
            onClick={() => void oauth("apple")}
            disabled={loading !== null}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-1 px-4 py-3.5 text-base font-medium text-fg transition hover:bg-surface-2 disabled:opacity-60"
          >
            {loading === "apple" ? "Входим…" : "Продолжить через Apple"}
          </button>
        ) : null}

        <Link
          href="/register/email"
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-1 px-4 py-3.5 text-base font-medium text-fg-secondary transition hover:bg-surface-2 hover:text-fg"
        >
          Регистрация по email
        </Link>

        <p className="pt-2 text-center text-sm text-fg-muted">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Войти
          </Link>
        </p>
      </div>
    </motion.div>
  );
}
