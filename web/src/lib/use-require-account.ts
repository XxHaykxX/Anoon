"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { accountsEnabled } from "@/lib/supabase";
import { useSession } from "@/store/session";

export type AccountGateState = "checking" | "blocked" | "ready";

// Гейт для страниц, требующих аккаунт. Если фича выключена (флаг off) — гейт всегда
// "ready" сразу: старое анонимное поведение (Onboarding/FindPeer по hasProfile) не трогаем.
// Если включена — гидрирует сессию с сервера (провайдер-агностичный gender-gate) и редиректит:
//   нет сессии → /register; сессия есть, но пол не залочен → /register/confirm; иначе пускает.
export function useRequireAccount(): AccountGateState {
  const router = useRouter();
  const hydrateFromSession = useSession((s) => s.hydrateFromSession);
  const [state, setState] = useState<AccountGateState>(accountsEnabled ? "checking" : "ready");

  useEffect(() => {
    if (!accountsEnabled) return;
    let cancelled = false;
    void (async () => {
      const result = await hydrateFromSession();
      if (cancelled) return;
      if (result === "none") {
        router.replace("/register");
        setState("blocked");
      } else if (result === "confirm") {
        router.replace("/register/confirm");
        setState("blocked");
      } else {
        setState("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
