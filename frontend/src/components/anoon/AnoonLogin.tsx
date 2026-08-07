"use client";

import { useState } from "react";
import { AnoonLogo } from "@/components/anoon/_shared";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import { USE_TINODE } from "@/lib/tinode";
import { useAnoonStore } from "@/store";

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
  const authError = useAnoonStore((s) => s.authError);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Soft brand glow */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: "rgba(253,191,45,0.14)" }}
      />

      <div className={`relative z-10 flex flex-1 flex-col overflow-y-auto px-6 ${DESKTOP_FORM}`}>
        {/* Logo + tagline */}
        <div className="mt-16 flex flex-col items-center text-center">
          <AnoonLogo className="text-4xl" />
          <p className="mt-3 max-w-[16rem] text-sm text-muted-foreground">
            Анонимный чат-рулетка. Знакомься, общайся, дружи.
          </p>
        </div>

        {/* Google — blocked on real credentials, so disabled («Скоро»).
            Facebook / Apple are out of MVP scope and intentionally removed. */}
        <div className="mt-10">
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-2xl border border-border bg-card py-3.5 font-medium text-muted-foreground opacity-60"
          >
            <GoogleMark />
            <span>Войти через Google</span>
            <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              Скоро
            </span>
          </button>
        </div>

        {/* Divider */}
        <div className="mt-7 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">или по email</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Email + password login form (existing accounts) */}
        <div className="mt-6 flex flex-col gap-3">
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Почта
            </label>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Пароль
            </label>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Ваш пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) void handleLogin();
              }}
              className="w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2"
            />
          </div>
        </div>

        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleLogin}
          className={`mt-6 w-full rounded-2xl bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-95 cursor-pointer ${
            canSubmit ? "" : "cursor-not-allowed opacity-50"
          }`}
          style={
            canSubmit
              ? { boxShadow: "0 8px 24px -6px rgba(253,191,45,0.4)" }
              : undefined
          }
        >
          {submitting ? "Входим…" : "Войти"}
        </button>

        {USE_TINODE && authError && (
          <p className="mt-3 text-center text-sm text-destructive">{authError}</p>
        )}

        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => nav.push("auth-forgot-password")}
            className="text-sm font-medium text-primary transition-transform active:scale-95 cursor-pointer"
          >
            Забыл пароль?
          </button>
        </div>

        {/* Registration */}
        <button
          type="button"
          onClick={() => nav.push("auth-register")}
          className="mt-6 w-full rounded-2xl border border-border bg-card py-3.5 font-semibold text-foreground transition-transform active:scale-95 cursor-pointer"
        >
          Регистрация по email
        </button>
      </div>

      {/* Footer */}
      <div
        className={`relative z-10 mt-auto px-6 pb-6 pt-4 text-center text-[11px] leading-relaxed text-muted-foreground ${DESKTOP_FORM}`}
      >
        Продолжая, вы подтверждаете, что вам 18+ и принимаете условия
        использования.
      </div>
    </div>
  );
}
