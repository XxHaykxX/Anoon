"use client";

import { useState } from "react";
import { CheckIcon, ChevronLeftIcon } from "@/components/icons";
import { AnoonLogo } from "@/components/anoon/_shared";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import { getCompanionClient } from "@/lib/companion";

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

/**
 * Desktop (≥1024): this screen is a narrow form, so it becomes one centered
 * column of a readable width instead of stretching across the shell's 60rem
 * work area; the background stays full-bleed, only the content is capped.
 * Both halves of the variant are load-bearing — see docs/DESKTOP-LAYOUT.md,
 * «Как писать десктопные стили в файле экрана».
 */
const DESKTOP_FORM =
  "lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:w-full lg:[.anoon-desktop_&]:max-w-[26rem]";

export default function AnoonResetPassword() {
  const nav = useAnoonNav();
  // No route-param plumbing between screens (AnoonNavApi is a plain route stack,
  // no per-navigation payload) and there's no real inbox to click through since
  // SMTP is stubbed — the token from the reset email is entered here by hand.
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const longEnough = password.length >= 6;
  const matches = confirm.length > 0 && password === confirm;
  const canSave = token.trim().length > 0 && longEnough && matches && !saving;
  const mismatch = confirm.length > 0 && password !== confirm;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await getCompanionClient().resetPassword(token.trim(), password);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить пароль");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: "rgba(253,191,45,0.14)" }}
      />

      {/* Back is for the form only: once the password is saved the flow is done,
          and the sole thing behind it is the form the user just completed. The
          logo then sits on the content column, like the other no-back screens. */}
      <div className={`relative z-10 flex items-center gap-1 px-6 pt-6 ${DESKTOP_FORM}`}>
        {!saved && (
          <button
            type="button"
            onClick={() => nav.back()}
            aria-label="Назад"
            className="-ml-5 grid size-12 shrink-0 place-items-center rounded-full text-foreground transition-transform active:scale-95 cursor-pointer"
          >
            <ChevronLeftIcon className="size-6" />
          </button>
        )}
        <AnoonLogo className="text-xl" />
      </div>

      {saved ? (
        <div
          className={`relative z-10 flex flex-1 flex-col items-center px-6 pt-16 text-center ${DESKTOP_FORM}`}
        >
          <div className="grid size-20 place-items-center rounded-full bg-online/15 text-online">
            <CheckIcon className="size-10" />
          </div>
          <h1 className="mt-6 text-2xl font-bold">Пароль сохранён</h1>
          <p className="mt-2 max-w-[18rem] text-sm text-muted-foreground">
            Теперь вы можете войти в аккаунт с новым паролем.
          </p>
          <button
            type="button"
            onClick={() => nav.go("auth-login")}
            className="mt-8 w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-95 cursor-pointer"
            style={{ boxShadow: "0 8px 24px -6px rgba(253,191,45,0.4)" }}
          >
            Войти
          </button>
        </div>
      ) : (
        <div className={`relative z-10 flex flex-1 flex-col px-6 pt-8 ${DESKTOP_FORM}`}>
          <h1 className="text-2xl font-bold">Новый пароль</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Придумайте новый пароль для входа в аккаунт.
          </p>

          <div className="mt-7 flex flex-col gap-3">
            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">
                Код из письма
              </label>
              <input
                type="text"
                placeholder="Вставьте код из письма"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">
                Новый пароль
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

            <div>
              <label className="mb-1.5 block text-xs text-muted-foreground">
                Повторите пароль
              </label>
              <div
                className={`flex items-center gap-2 rounded-xl border border-transparent bg-muted px-4 py-3 transition-shadow ${
                  mismatch
                    ? "ring-1 ring-destructive"
                    : "ring-primary/40 focus-within:border-primary focus-within:ring-2"
                }`}
              >
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Ещё раз"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
              {mismatch && (
                <p className="mt-1.5 text-xs text-destructive">
                  Пароли не совпадают
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={!canSave}
            onClick={handleSave}
            className={`mt-6 w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-95 cursor-pointer ${
              canSave ? "" : "cursor-not-allowed opacity-50"
            }`}
            style={
              canSave
                ? { boxShadow: "0 8px 24px -6px rgba(253,191,45,0.4)" }
                : undefined
            }
          >
            {saving ? "Сохранение…" : "Сохранить пароль"}
          </button>

          {error && (
            <p className="mt-3 text-center text-sm text-destructive">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
