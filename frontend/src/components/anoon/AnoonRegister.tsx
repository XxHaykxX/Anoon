"use client";

import { useState } from "react";
import { ChevronLeftIcon } from "@/components/icons";
import { AnoonLogo } from "@/components/anoon/_shared";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import { USE_TINODE } from "@/lib/tinode";
import { useAnoonStore } from "@/store";

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.6 18.6 0 0 1 4.22-5.06M9.9 4.24A10.4 10.4 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}

type Gender = "male" | "female" | null;

export default function AnoonRegister() {
  const nav = useAnoonNav();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const signInWithBasic = useAnoonStore((s) => s.signInWithBasic);
  const authError = useAnoonStore((s) => s.authError);

  const ageNum = Number(age);
  const ageValid = Number.isInteger(ageNum) && ageNum >= 18 && ageNum <= 100;
  const emailValid = /\S+@\S+\.\S+/.test(email);
  const canSubmit =
    emailValid &&
    password.length >= 6 &&
    name.trim().length > 0 &&
    ageValid &&
    !!gender &&
    !submitting;

  const handleSubmit = async () => {
    // Mock flow (default): step through the onboarding screens
    // (register → verify email → gender → profile setup).
    if (!USE_TINODE) {
      nav.push("auth-verify-email");
      return;
    }
    // Real flow: create the Tinode account now, then land on «Чаты» (BUG-24/36 —
    // route "chats" is the post-login landing screen, not roulette-Home).
    // The collected gender/age/name are threaded through to companion.register
    // and the synthesized User (gender is critical for matchmaking).
    setSubmitting(true);
    try {
      await signInWithBasic({
        email,
        password,
        isNew: true,
        displayName: name.trim(),
        gender: gender ?? undefined,
        age: ageNum,
      });
      nav.go("chats");
    } catch {
      // authError is surfaced from the store below.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center gap-1 px-6 pt-6">
        <button
          type="button"
          onClick={() => nav.back()}
          aria-label="Назад"
          className="-ml-3 grid size-9 shrink-0 place-items-center rounded-full text-foreground transition-transform active:scale-95 cursor-pointer"
        >
          <ChevronLeftIcon className="size-6" />
        </button>
        <AnoonLogo className="text-xl" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <h1 className="mt-5 text-2xl font-bold">Регистрация</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Создайте аккаунт по email
        </p>

        <div className="mt-7 flex flex-col gap-3">
          {/* Email */}
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Почта
            </label>
            <input
              type="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2"
            />
          </div>

          {/* Password */}
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Пароль
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-transparent bg-muted px-4 py-3 ring-primary/40 transition-shadow focus-within:border-primary focus-within:ring-2">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Минимум 6 символов"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                onClick={() => setShowPassword((v) => !v)}
                className="shrink-0 text-muted-foreground transition-transform active:scale-95 cursor-pointer"
              >
                {showPassword ? (
                  <EyeOffIcon className="size-5" />
                ) : (
                  <EyeIcon className="size-5" />
                )}
              </button>
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Имя
            </label>
            <input
              type="text"
              placeholder="Как вас зовут"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2"
            />
          </div>

          {/* Age */}
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Возраст
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={18}
              max={100}
              placeholder="18+"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className="w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2"
            />
          </div>

          {/* Gender segment */}
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Пол
            </label>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
              {(
                [
                  { id: "male", label: "Мужчина" },
                  { id: "female", label: "Женщина" },
                ] as const
              ).map((g) => {
                const active = gender === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGender(g.id)}
                    className={`rounded-lg py-2.5 text-sm font-medium transition-transform active:scale-95 cursor-pointer ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className={`mt-7 w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-95 cursor-pointer ${
            canSubmit ? "" : "cursor-not-allowed opacity-50"
          }`}
          style={
            canSubmit
              ? { boxShadow: "0 8px 24px -6px rgba(253,191,45,0.4)" }
              : undefined
          }
        >
          {submitting ? "Создаём аккаунт…" : "Зарегистрироваться"}
        </button>

        {USE_TINODE && authError && (
          <p className="mt-3 text-center text-sm text-destructive">{authError}</p>
        )}

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Уже есть аккаунт?{" "}
          <button
            type="button"
            onClick={() => nav.back()}
            className="font-medium text-primary transition-transform active:scale-95 cursor-pointer"
          >
            Войти
          </button>
        </p>
      </div>
    </div>
  );
}
