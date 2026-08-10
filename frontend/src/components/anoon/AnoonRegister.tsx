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

/**
 * Desktop (≥1024): this screen is a narrow form, so it becomes one centered
 * column of a readable width instead of stretching across the shell's 60rem
 * work area; the background stays full-bleed, only the content is capped.
 * Both halves of the variant are load-bearing — see docs/DESKTOP-LAYOUT.md,
 * «Как писать десктопные стили в файле экрана».
 */
const DESKTOP_FORM =
  "lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:w-full lg:[.anoon-desktop_&]:max-w-[26rem]";

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

  // Which fields are wrong, and — the part that was missing — what to say about
  // it. Before this the button simply sat there disabled: an empty form gave no
  // hint at all about what the screen wanted, and a keyboard/screen-reader user
  // got nothing whatsoever on pressing it.
  const [showErrors, setShowErrors] = useState(false);
  const ageNum = Number(age);
  const ageValid = Number.isInteger(ageNum) && ageNum >= 18 && ageNum <= 100;
  const emailValid = /\S+@\S+\.\S+/.test(email);
  const errors = {
    email: emailValid ? null : "Введите почту в виде you@example.com",
    password: password.length >= 6 ? null : "Пароль от 6 символов",
    name: name.trim().length > 0 ? null : "Введите имя",
    age: ageValid ? null : "Возраст от 18 до 100",
    gender: gender ? null : "Выберите пол",
  };
  const complete = !Object.values(errors).some(Boolean);
  const canSubmit = complete && !submitting;

  /**
   * Field error line. `role="alert"` so it's spoken the moment it appears —
   * the whole point is that pressing the button now answers "what's missing?".
   */
  const errorFor = (key: keyof typeof errors) =>
    showErrors && errors[key] ? (
      <p role="alert" id={`err-${key}`} className="mt-1 text-xs text-destructive">
        {errors[key]}
      </p>
    ) : null;
  /** Props that mark an input invalid and tie it to its message. */
  const invalidProps = (key: keyof typeof errors) =>
    showErrors && errors[key]
      ? { "aria-invalid": true, "aria-describedby": `err-${key}` }
      : {};

  const handleSubmit = async () => {
    // The button stays enabled while the form is incomplete — a dead button
    // can't explain itself. Pressing it reveals the messages instead.
    if (!complete) {
      setShowErrors(true);
      return;
    }
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
    <div className="anoon-auth relative flex h-full w-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className={`flex items-center gap-1 px-6 pt-6 ${DESKTOP_FORM}`}>
        <button
          type="button"
          onClick={() => nav.back()}
          aria-label="Назад"
          className="-ml-5 grid size-12 shrink-0 place-items-center rounded-full text-foreground transition-transform active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeftIcon className="size-6" />
        </button>
        <AnoonLogo className="text-xl" />
      </div>

      <div className={`flex-1 overflow-y-auto px-6 pb-6 ${DESKTOP_FORM}`}>
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
              {...invalidProps("email")}
              className="w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2 aria-invalid:border-destructive"
            />
            {errorFor("email")}
          </div>

          {/* Password */}
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Пароль
            </label>
            <div
              className={`flex items-center gap-2 rounded-xl border bg-muted px-4 py-3 ring-primary/40 transition-shadow focus-within:border-primary focus-within:ring-2 ${
                showErrors && errors.password ? "border-destructive" : "border-transparent"
              }`}
            >
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Минимум 6 символов"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                {...invalidProps("password")}
                className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                onClick={() => setShowPassword((v) => !v)}
                className="shrink-0 rounded-full text-muted-foreground transition-transform active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPassword ? (
                  <EyeOffIcon className="size-5" />
                ) : (
                  <EyeIcon className="size-5" />
                )}
              </button>
            </div>
            {errorFor("password")}
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
              {...invalidProps("name")}
              className="w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2 aria-invalid:border-destructive"
            />
            {errorFor("name")}
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
              {...invalidProps("age")}
              className="w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2 aria-invalid:border-destructive"
            />
            {errorFor("age")}
          </div>

          {/* Gender segment */}
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Пол
            </label>
            <div
              className={`grid grid-cols-2 gap-2 rounded-xl border bg-muted p-1 ${
                showErrors && errors.gender ? "border-destructive" : "border-transparent"
              }`}
            >
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
                    aria-pressed={active}
                    onClick={() => setGender(g.id)}
                    className={`rounded-lg py-2.5 text-sm font-medium transition-transform active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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
            {errorFor("gender")}
          </div>
        </div>

        <button
          type="button"
          // Only a request in flight disables it. While the form is merely
          // incomplete the button stays pressable and answers the question.
          disabled={submitting}
          onClick={handleSubmit}
          className={`mt-7 w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            canSubmit ? "" : "opacity-50"
          }`}
          style={
            canSubmit
              ? { boxShadow: "var(--cta-glow)" }
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
            className="rounded font-medium text-primary transition-transform active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Войти
          </button>
        </p>
      </div>
    </div>
  );
}
