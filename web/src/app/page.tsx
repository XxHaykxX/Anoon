"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { FindPeer } from "@/components/find-peer";
import { Onboarding } from "@/components/onboarding";
import { accountsEnabled } from "@/lib/supabase";
import { useMounted } from "@/lib/use-mounted";
import { useRequireAccount } from "@/lib/use-require-account";
import { useSession } from "@/store/session";

const PENDING_ADD_KEY = "anoon-pending-add";

export default function Home() {
  const hasProfile = useSession((s) => s.hasProfile);
  const router = useRouter();
  // Persist гидрируется на клиенте — ждём mount, иначе SSR-mismatch.
  const mounted = useMounted();
  // Гейт аккаунтов (гидрация + редирект на /register или /register/confirm) — активен только
  // за NEXT_PUBLIC_ACCOUNTS_ENABLED. hasProfile — локальный флаг ник-онбординга (старый анон-флоу),
  // НЕ путать с реальным логином: пока флаг выключен, гейт всегда "ready" и не мешает.
  const gate = useRequireAccount();

  // Если сюда попали после регистрации по QR/ссылке-приглашению (/add/{id} запомнил цель,
  // потому что гейт увёл незалогиненного на /register) — довозвращаем на приглашение.
  useEffect(() => {
    if (gate !== "ready") return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_ADD_KEY);
      if (pending) sessionStorage.removeItem(PENDING_ADD_KEY);
    } catch {}
    // push (не replace) — назад с экрана приглашения должен вернуть на "/", а не выйти из PWA.
    if (pending) router.push(`/add/${pending}`);
  }, [gate, router]);

  if (!mounted) return null;
  if (!accountsEnabled) return hasProfile ? <FindPeer /> : <Onboarding />;
  if (gate !== "ready") return null; // "checking"/"blocked" — редирект уже в пути

  // Вход в друзей теперь — таб «Друзья» в нижней навигации (bottom-nav.tsx). Прежняя плавающая
  // FAB-кнопка убрана: она дублировала таб и физически перекрывалась фиксированным навбаром
  // (виднелся только «кончик» под панелью).
  return <FindPeer />;
}
