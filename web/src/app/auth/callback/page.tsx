"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { supabase, supabaseConfigured } from "@/lib/supabase";
import { useSession } from "@/store/session";

// Приземление OAuth-редиректа (Google) и подтверждения email. PKCE-обмен code→session
// делает supabase-js автоматически (detectSessionInUrl). Ждём сессию, гидрируем профиль и
// разводим по gender-gate: пол не залочен (первый вход) → /register/confirm, иначе → /.
// Провайдер-агностично: OAuth не отдаёт пол, поэтому confirm обязателен для любого провайдера.

// detectSessionInUrl обменивает URL асинхронно после инициализации клиента — getSession может
// вернуть null в первый тик. Ждём через onAuthStateChange + короткий поллинг, с таймаутом.
function waitForSession(timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      listener.subscription.unsubscribe();
      clearInterval(poll);
      resolve(ok);
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish(true);
    });
    const poll = setInterval(async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) finish(true);
    }, 300);
    const timer = setTimeout(() => finish(false), timeoutMs);
    // Немедленная проверка — сессия могла уже появиться.
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish(true);
    });
  });
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const hydrate = useSession((s) => s.hydrateFromSession);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      if (!supabaseConfigured) {
        router.replace("/register");
        return;
      }
      const ok = await waitForSession();
      if (!ok) {
        setError("Не удалось завершить вход. Попробуйте снова.");
        setTimeout(() => router.replace("/register"), 1500);
        return;
      }
      const target = await hydrate();
      // "none" не ожидается (сессия есть) — на всякий случай ведём на регистрацию.
      router.replace(target === "confirm" ? "/register/confirm" : target === "ready" ? "/" : "/register");
    })();
  }, [hydrate, router]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center">
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : (
        <>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden />
          <p className="text-sm text-fg-secondary">Входим…</p>
        </>
      )}
    </div>
  );
}
