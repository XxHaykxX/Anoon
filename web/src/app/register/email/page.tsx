"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { PasswordField } from "@/components/password-field";
import { accountsEnabled, supabase } from "@/lib/supabase";
import { useMounted } from "@/lib/use-mounted";
import { cn } from "@/lib/utils";
import { type Gender, useSession } from "@/store/session";

const RESEND_SECONDS = 60;

// Email-регистрация: email/пароль/имя/пол (пол дозаполняется на /register/confirm, если провайдер
// не дал его). После сабмита — экран «подтвердите почту» (юзер выбрал верификацию email).
export default function RegisterEmailPage() {
  const router = useRouter();
  const mounted = useMounted();
  const genderLocked = useSession((s) => s.genderLocked);
  const signUpEmail = useSession((s) => s.signUpEmail);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const blocked = mounted && (!accountsEnabled || genderLocked);
  useEffect(() => {
    if (blocked) router.replace("/");
  }, [blocked, router]);

  if (!mounted || blocked) return null;

  const startCooldown = () => {
    setCooldown(RESEND_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1 && timerRef.current) clearInterval(timerRef.current);
        return Math.max(0, c - 1);
      });
    }, 1000);
  };

  const ok = email.trim().length > 3 && password.length >= 6 && firstName.trim().length >= 1 && gender !== null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || loading) return;
    setLoading(true);
    setError(null);
    const res = await signUpEmail({ email: email.trim(), password, firstName: firstName.trim(), gender: gender! });
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? "Не удалось зарегистрироваться");
      return;
    }
    if (res.needsEmailConfirm) {
      setVerifying(true);
      startCooldown();
    } else {
      router.push("/register/confirm");
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    startCooldown();
    await supabase.auth.resend({ type: "signup", email: email.trim() }).catch(() => {});
  };

  return (
    <div className="flex min-h-dvh flex-col px-6 pt-[calc(env(safe-area-inset-top)+1rem)]">
      <Link href="/register" aria-label="Назад" className="flex h-11 w-11 items-center justify-center rounded-full text-fg-secondary hover:bg-surface-2">
        <ArrowLeft size={20} />
      </Link>

      <AnimatePresence mode="wait">
        {verifying ? (
          <motion.div
            key="verify"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mx-auto mt-16 w-full max-w-sm text-center"
          >
            <h1 className="text-xl font-bold">Подтвердите почту</h1>
            <p className="mt-2 text-sm text-fg-secondary">Мы отправили ссылку на {email.trim()}</p>
            <button
              onClick={() => void resend()}
              disabled={cooldown > 0}
              className="mt-6 min-h-11 w-full rounded-xl border border-border bg-surface-1 px-4 text-sm font-medium text-fg-secondary transition hover:bg-surface-2 disabled:opacity-50"
            >
              {cooldown > 0 ? `Отправить снова (${cooldown}с)` : "Отправить снова"}
            </button>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onSubmit={submit}
            className="mx-auto mt-8 w-full max-w-sm space-y-4"
          >
            <h1 className="text-xl font-bold">Регистрация по email</h1>

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

            <PasswordField label="Пароль" value={password} onChange={setPassword} autoComplete="new-password" />

            <div>
              <label htmlFor="firstName" className="mb-2 block text-xs font-medium text-fg-secondary">
                Имя
              </label>
              <input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                maxLength={40}
                required
                className="w-full rounded-xl border border-border bg-surface-1 px-4 py-3.5 text-base outline-none focus:border-accent"
              />
            </div>

            <div>
              <span className="mb-2 block text-xs font-medium text-fg-secondary">Пол</span>
              <div role="radiogroup" aria-label="Пол" className="flex gap-2">
                {([{ v: "male", label: "Мужчина" }, { v: "female", label: "Женщина" }] as const).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    role="radio"
                    aria-checked={gender === o.v}
                    onClick={() => setGender(o.v)}
                    className={cn(
                      "min-h-11 flex-1 rounded-xl border px-3 text-sm font-medium transition",
                      gender === o.v ? "border-accent bg-accent/15 text-fg" : "border-white/10 bg-white/5 text-fg-secondary hover:text-fg",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={!ok || loading}
              className="mt-2 min-h-11 w-full rounded-xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
            >
              {loading ? "Регистрируем…" : "Зарегистрироваться"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
