"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { accountsEnabled } from "@/lib/supabase";
import { useSession } from "@/store/session";

export type AccountGateState = "checking" | "blocked" | "ready";

// Гидрируем сервер РОВНО ОДИН раз за живой сеанс/reload, а не на каждой навигации —
// иначе каждый переход на гейт-страницу = getSession + GET /api/profile/me (сеть +
// холодный serverless + запрос БД) и страница «долго открывается».
let hydratedThisSession = false;

// Гейт для страниц, требующих аккаунт.
// - Флаг off → сразу "ready" (старое анонимное поведение не трогаем).
// - Уже знаем из persist, что аккаунт дозаполнен (genderLocked=true) → "ready" МГНОВЕННО,
//   без блокирующего сетевого запроса; профиль фоново разово освежаем.
// - Иначе (свежая загрузка, persist пуст) → блокирующая гидрация с редиректом.
export function useRequireAccount(): AccountGateState {
  const router = useRouter();
  const hydrateFromSession = useSession((s) => s.hydrateFromSession);
  const genderLocked = useSession((s) => s.genderLocked);

  // Оптимистичный синхронный гейт из персиста — без сетевого round-trip на каждой странице.
  const optimistic: AccountGateState = !accountsEnabled || genderLocked ? "ready" : "checking";
  const [state, setState] = useState<AccountGateState>(optimistic);

  useEffect(() => {
    if (!accountsEnabled) return;
    // Дозаполненный аккаунт уже освежали в этом сеансе → не блокируем и не дёргаем сеть.
    if (genderLocked && hydratedThisSession) return;

    let cancelled = false;
    void (async () => {
      const result = await hydrateFromSession();
      hydratedThisSession = true;
      if (cancelled) return;
      if (result === "none") {
        // Сессии нет (разлогинен) — уводим на регистрацию при любом оптимизме.
        router.replace("/register");
        setState("blocked");
      } else if (result === "confirm") {
        // Пол не залочен. Если persist уже считал аккаунт готовым (optimistic ready) —
        // НЕ бросаем на confirm по одному фоновому ответу (защита от ложного бунса на
        // транзиентном null); блокируем только когда изначально были в "checking".
        if (optimistic === "checking") {
          router.replace("/register/confirm");
          setState("blocked");
        } else {
          setState("ready");
        }
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
