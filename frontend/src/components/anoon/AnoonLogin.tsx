"use client";

import { useState } from "react";
import { ChevronRightIcon } from "@/components/icons";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import GoogleSignInButton, { GOOGLE_ENABLED } from "@/components/anoon/GoogleSignInButton";
import { USE_TINODE } from "@/lib/tinode";
import { useAnoonStore } from "@/store";
import { NeedsGenderError } from "@/store/slices";

/**
 * Desktop (≥1024): this is a narrow form, so it becomes one centered column of
 * a readable width instead of stretching across the shell's 60rem work area —
 * a login form 960px wide reads worse than the phone one. The background stays
 * full-bleed; only the content is capped.
 *
 * Both halves of the variant are load-bearing (docs/DESKTOP-LAYOUT.md): a bare
 * `lg:` would also fire in the showcase's 390px frames on a wide monitor, and
 * `.anoon-desktop` alone sits on the AnoonApp root at every width, so it would
 * fire on the phone.
 */
const DESKTOP_FORM =
  "lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:w-full lg:[.anoon-desktop_&]:max-w-[26rem]";

/* --- Иконки, которых нет в общем наборе (правило: локальные const, icons.tsx
       не трогаем). Формы взяты из screens/LoginScreen — того самого макета. --- */
function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.6 18.6 0 0 1 4.22-5.06M9.9 4.24A10.4 10.4 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}

function AppleMark({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.36 1.43c0 1.14-.42 2.2-1.24 3.03-.86.87-2.02 1.5-3.13 1.41-.12-1.09.44-2.24 1.22-3.02.85-.88 2.28-1.53 3.15-1.42zM20.9 17.44c-.5 1.16-.75 1.67-1.4 2.7-.9 1.42-2.18 3.2-3.75 3.22-1.4.02-1.76-.9-3.65-.89-1.9.01-2.3.9-3.7.88-1.58-.02-2.78-1.6-3.68-3.02-2.52-3.96-2.78-8.6-1.23-11.07 1.1-1.75 2.83-2.77 4.46-2.77 1.66 0 2.7.9 4.08.9 1.33 0 2.15-.9 4.08-.9 1.45 0 2.98.79 4.07 2.15-3.58 1.96-3 7.06 1.72 8.8z" />
    </svg>
  );
}

function FacebookMark({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path fill="#fff" d="M15.5 12.5H13.7V20h-3.1v-7.5H9.4V10h1.2V8.6c0-1.9 1-3 3.3-3h2v2.6h-1.3c-.9 0-1 .35-1 1V10h2.3l-.2 2.5z" />
    </svg>
  );
}

/* --- Brand logo mark (not in shared icon set) --- */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3.02c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.12A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54V6.61H1.26a12 12 0 0 0 0 10.78l4.01-3.12z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.61l4.01 3.12C6.22 6.88 8.87 4.77 12 4.77z"
      />
    </svg>
  );
}

export default function AnoonLogin() {
  const nav = useAnoonNav();
  const signInWithBasic = useAnoonStore((s) => s.signInWithBasic);
  const signInWithGoogle = useAnoonStore((s) => s.signInWithGoogle);
  const authError = useAnoonStore((s) => s.authError);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  // Tinode "basic" login is a plain username (no @/. allowed), so accept either
  // an email-looking string OR a bare username (3+ chars) — the value is sent
  // verbatim as the basic login.
  const emailValid =
    /\S+@\S+\.\S+/.test(email) || /^[a-z0-9_.\-]{3,}$/i.test(email.trim());
  const canSubmit = emailValid && password.length >= 6 && !submitting;

  const handleLogin = async () => {
    // Mock flow (default): no backend — just enter the app.
    // BUG-24/36: "Чаты" (route "chats") is the post-login landing screen,
    // not roulette-Home — see _shared.tsx's AnoonBottomNav for the nav reorder.
    if (!USE_TINODE) {
      nav.go("chats");
      return;
    }
    // Real flow: log into the existing Tinode account (NOT create) via the
    // store's basic sign-in with isNew:false; it fetches the companion profile,
    // hands the token to companion, reconnects events and loads contacts.
    setSubmitting(true);
    try {
      await signInWithBasic({ email, password, isNew: false });
      nav.go("chats");
    } catch {
      // authError is surfaced from the store below.
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * A returning Google user lands straight in the app. A first sign-in needs a
   * gender, and that is a screen of its own — irreversible, and the same
   * question the email flow asks with a warning and a confirmation. Asking it in
   * a card wedged under the provider row made the login form the place where an
   * account is created, which it is not; the store keeps the token, the gender
   * screen presents it back.
   */
  const handleGoogle = async (idToken: string) => {
    setGoogleBusy(true);
    try {
      await signInWithGoogle(idToken);
      nav.go("chats");
    } catch (err) {
      if (err instanceof NeedsGenderError) {
        nav.push("auth-gender");
        return;
      }
      // Anything else is surfaced through authError below.
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <div className="anoon-auth relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Soft brand glow */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: "rgba(253,191,45,0.14)" }}
      />

      <div className={`relative z-10 flex flex-1 flex-col overflow-y-auto px-6 ${DESKTOP_FORM}`}>
        {/* Знак + приветствие */}
        <div className="mt-12 flex flex-col items-center text-center">
          <div className="grid size-16 place-items-center rounded-2xl bg-primary shadow-sm">
            <span className="text-3xl font-bold text-primary-foreground">a</span>
          </div>
          <h1 className="mt-5 text-2xl font-bold">Добро пожаловать в Anoon</h1>
          <p className="mt-1 text-sm text-muted-foreground">Войдите, чтобы продолжить</p>
        </div>

        {/* Форма */}
        <div className="mt-8 flex flex-col gap-3">
          <input
            type="text"
            inputMode="email"
            autoComplete="username"
            placeholder="Почта или ник"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2"
          />

          <div className="flex items-center gap-2 rounded-xl border border-transparent bg-muted px-4 py-3 ring-primary/40 transition-shadow focus-within:border-primary focus-within:ring-2">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) void handleLogin();
              }}
              className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              onClick={() => setShowPassword((v) => !v)}
              className="shrink-0 cursor-pointer text-muted-foreground transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              {showPassword ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
            </button>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => nav.push("auth-forgot-password")}
              className="cursor-pointer text-sm font-medium text-primary transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              Забыли пароль?
            </button>
          </div>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleLogin}
            className={`mt-1 w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-95 cursor-pointer ${
              canSubmit ? "" : "cursor-not-allowed opacity-50"
            }`}
            style={canSubmit ? { boxShadow: "0 8px 24px -6px rgba(253,191,45,0.4)" } : undefined}
          >
            {submitting ? "Входим…" : "Войти"}
          </button>
        </div>

        {USE_TINODE && authError && (
          <p className="mt-3 text-center text-sm text-destructive">{authError}</p>
        )}

        {/* Разделитель */}
        <div className="mt-7 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">или продолжить с</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Вход через провайдеров. Google работает, если сборке передан
            NEXT_PUBLIC_GOOGLE_CLIENT_ID; Apple и Facebook не заведены и на
            бэкенде, поэтому честно выключены — нажимаемая кнопка, которая
            ничего не делает, хуже видимо недоступной. */}
        <div className="mt-4 flex items-center gap-3">
          {GOOGLE_ENABLED ? (
            <GoogleSignInButton
              onCredential={(t) => void handleGoogle(t)}
              disabled={googleBusy || submitting}
              mark={<GoogleMark />}
            />
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              aria-label="Войти через Google — скоро"
              title="Скоро"
              className="grid flex-1 cursor-not-allowed place-items-center rounded-xl border border-border py-3 opacity-50"
            >
              <GoogleMark />
            </button>
          )}
          {[
            { key: "apple", mark: <AppleMark />, label: "Войти через Apple" },
            { key: "facebook", mark: <FacebookMark />, label: "Войти через Facebook" },
          ].map((p) => (
            <button
              key={p.key}
              type="button"
              disabled
              aria-disabled="true"
              aria-label={`${p.label} — скоро`}
              title="Скоро"
              className="grid flex-1 cursor-not-allowed place-items-center rounded-xl border border-border py-3 opacity-50"
            >
              {p.mark}
            </button>
          ))}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          {GOOGLE_ENABLED ? "Apple и Facebook — скоро" : "Вход через сервисы — скоро"}
        </p>
      </div>

      {/* Низ: регистрация + возрастная оговорка */}
      <div className={`relative z-10 mt-auto px-6 pb-6 pt-4 ${DESKTOP_FORM}`}>
        <div className="flex items-center justify-center gap-1.5 text-sm">
          <span className="text-muted-foreground">Нет аккаунта?</span>
          <button
            type="button"
            onClick={() => nav.push("auth-register")}
            className="flex cursor-pointer items-center gap-0.5 font-medium text-primary transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            Зарегистрироваться
            <ChevronRightIcon className="size-4" />
          </button>
        </div>
        <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
          Продолжая, вы подтверждаете, что вам 18+ и принимаете условия
          использования.
        </p>
      </div>
    </div>
  );
}
