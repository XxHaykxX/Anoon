"use client";

import { useEffect, useState } from "react";
import { ChevronLeftIcon } from "@/components/icons";
import { AnoonLogo } from "@/components/anoon/_shared";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import { CompanionHttpError, getCompanionClient } from "@/lib/companion";

function EnvelopeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export default function AnoonVerifyEmail() {
  const nav = useAnoonNav();
  const email = "you@example.com";
  const [seconds, setSeconds] = useState(60);
  const [resends, setResends] = useState(0);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  // No route-param plumbing between screens and no real inbox to click through
  // (SMTP is stubbed) — the code from the verification email is entered here.
  const [token, setToken] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const canResend = seconds <= 0 && !resending;

  async function handleResend() {
    if (!canResend) return;
    setResending(true);
    setResendError(null);
    try {
      await getCompanionClient().requestEmailVerify();
      setResends((r) => r + 1);
      setSeconds(60);
    } catch (err) {
      setResendError(err instanceof Error ? err.message : "Не удалось отправить письмо");
    } finally {
      setResending(false);
    }
  }

  async function handleConfirm() {
    if (!token.trim() || confirming) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      await getCompanionClient().confirmEmailVerify(token.trim());
      // `go`, not `push`: the verification token is spent, so returning here is
      // meaningless — reset the stack instead of leaving an unreachable entry.
      nav.go("auth-gender");
    } catch (err) {
      // 409 `email_changed`: the address was changed after this letter went out,
      // so the token is spent and re-entering it can never succeed. A fresh link
      // is the only way forward — say so, and free the resend button immediately
      // rather than leaving the user retyping a code that cannot work.
      if (err instanceof CompanionHttpError && err.status === 409) {
        setConfirmError("Адрес почты изменился — эта ссылка больше не действует. Запросите новое письмо.");
        setSeconds(0);
      } else if (err instanceof CompanionHttpError) {
        // Any other rejection: the raw message is «companion /auth/…: 400», which
        // is not something to show a person.
        setConfirmError("Неверный или истёкший код");
      } else {
        setConfirmError(err instanceof Error ? err.message : "Неверный или истёкший код");
      }
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: "rgba(253,191,45,0.14)" }}
      />

      <div className="relative z-10 flex items-center gap-1 px-6 pt-6">
        <button
          type="button"
          onClick={() => nav.back()}
          aria-label="Назад"
          className="-ml-5 grid size-12 shrink-0 place-items-center rounded-full text-foreground transition-transform active:scale-95 cursor-pointer"
        >
          <ChevronLeftIcon className="size-6" />
        </button>
        <AnoonLogo className="text-xl" />
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center px-6 pt-10 text-center">
        <div className="grid size-20 place-items-center rounded-full bg-primary/15 text-primary">
          <EnvelopeIcon />
        </div>

        <h1 className="mt-6 text-2xl font-bold">Подтвердите почту</h1>
        <p className="mt-2 max-w-[18rem] text-sm text-muted-foreground">
          Мы отправили письмо со ссылкой для подтверждения на адрес
        </p>
        <p className="mt-1 font-medium text-foreground">{email}</p>
        <p className="mt-4 max-w-[18rem] text-xs text-muted-foreground">
          Перейдите по ссылке из письма, чтобы завершить регистрацию. Не забудьте
          проверить папку «Спам».
        </p>

        <button
          type="button"
          disabled={!canResend}
          onClick={handleResend}
          className={`mt-8 w-full rounded-xl py-3.5 font-semibold transition-transform active:scale-95 cursor-pointer ${
            canResend
              ? "bg-primary text-primary-foreground"
              : "cursor-not-allowed bg-muted text-muted-foreground"
          }`}
          style={
            canResend
              ? { boxShadow: "0 8px 24px -6px rgba(253,191,45,0.4)" }
              : undefined
          }
        >
          {resending
            ? "Отправка…"
            : canResend
              ? "Отправить снова"
              : `Отправить снова через ${seconds} с`}
        </button>

        {resendError && (
          <p className="mt-3 text-xs text-destructive">{resendError}</p>
        )}

        {resends > 0 && (
          <p className="mt-4 text-xs text-online">
            Письмо отправлено повторно ({resends}).
          </p>
        )}

        <div className="mt-6 w-full">
          <label className="mb-1.5 block text-left text-xs text-muted-foreground">
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

        {confirmError && (
          <p className="mt-2 text-xs text-destructive">{confirmError}</p>
        )}

        <button
          type="button"
          disabled={!token.trim() || confirming}
          onClick={handleConfirm}
          className={`mt-4 w-full rounded-xl border border-border bg-card py-3.5 font-medium text-foreground transition-transform active:scale-95 cursor-pointer ${
            !token.trim() || confirming ? "cursor-not-allowed opacity-50" : ""
          }`}
        >
          {confirming ? "Проверка…" : "Я подтвердил — продолжить"}
        </button>
      </div>

      <div className="relative z-10 mt-auto px-6 pb-6 text-center text-sm">
        <button
          type="button"
          onClick={() => nav.back()}
          className="font-medium text-primary transition-transform active:scale-95 cursor-pointer"
        >
          Изменить почту
        </button>
      </div>
    </div>
  );
}
