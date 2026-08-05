"use client";

import { useState } from "react";
import { ChevronLeftIcon, CheckIcon } from "@/components/icons";
import { AnoonLogo } from "@/components/anoon/_shared";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import { getCompanionClient } from "@/lib/companion";

export default function AnoonForgotPassword() {
  const nav = useAnoonNav();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = /\S+@\S+\.\S+/.test(email);

  // Backend SMTP delivery is stubbed for now — a `{queued: true}` reply just
  // means the request landed, not that mail actually went out. We still show
  // the normal "check your email" success state; there's nothing more real to
  // wait for on this side of the boundary.
  async function handleSend() {
    if (!emailValid || sending) return;
    setSending(true);
    setError(null);
    try {
      await getCompanionClient().requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить письмо");
    } finally {
      setSending(false);
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

      {sent ? (
        <div className="relative z-10 flex flex-1 flex-col items-center px-6 pt-16 text-center">
          <div className="grid size-20 place-items-center rounded-full bg-online/15 text-online">
            <CheckIcon className="size-10" />
          </div>
          <h1 className="mt-6 text-2xl font-bold">Ссылка отправлена</h1>
          <p className="mt-2 max-w-[18rem] text-sm text-muted-foreground">
            Мы отправили ссылку для восстановления пароля на
          </p>
          <p className="mt-1 font-medium text-foreground">{email}</p>
          <p className="mt-4 max-w-[18rem] text-xs text-muted-foreground">
            Перейдите по ссылке из письма, чтобы задать новый пароль. Проверьте
            папку «Спам», если письма нет.
          </p>

          <button
            type="button"
            onClick={() => nav.push("auth-reset-password")}
            className="mt-8 w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-95 cursor-pointer"
            style={{ boxShadow: "0 8px 24px -6px rgba(253,191,45,0.4)" }}
          >
            Ввести новый пароль
          </button>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="mt-3 w-full rounded-xl border border-border bg-card py-3.5 font-medium text-foreground transition-transform active:scale-95 cursor-pointer"
          >
            Отправить снова
          </button>
        </div>
      ) : (
        <div className="relative z-10 flex flex-1 flex-col px-6 pt-8">
          <h1 className="text-2xl font-bold">Восстановление пароля</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Введите почту от аккаунта — мы пришлём ссылку для сброса пароля.
          </p>

          <div className="mt-7">
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

          <button
            type="button"
            disabled={!emailValid || sending}
            onClick={handleSend}
            className={`mt-6 w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-95 cursor-pointer ${
              emailValid && !sending ? "" : "cursor-not-allowed opacity-50"
            }`}
            style={
              emailValid && !sending
                ? { boxShadow: "0 8px 24px -6px rgba(253,191,45,0.4)" }
                : undefined
            }
          >
            {sending ? "Отправка…" : "Отправить ссылку"}
          </button>

          {error && (
            <p className="mt-3 text-center text-sm text-destructive">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
