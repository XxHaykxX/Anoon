"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/avatar";
import { addFriend, respondFriend, searchUsers, type FriendStatus } from "@/lib/api";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { useRequireAccount } from "@/lib/use-require-account";
import { useSession } from "@/store/session";

const PENDING_KEY = "anoon-pending-add";

async function token(): Promise<string | null> {
  if (!supabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// Deep-link приглашения по QR/ссылке: /add/{publicId} → «Добавить #{publicId}?».
// Незалогиненного гейт уводит на /register; пока он не вернётся, запоминаем цель
// в sessionStorage — home (page.tsx) вернёт сюда сразу после входа.
export default function AddFriendPage() {
  const params = useParams<{ publicId: string }>();
  const targetId = params.publicId;
  const router = useRouter();
  const gate = useRequireAccount();
  const myPublicId = useSession((s) => s.publicId);

  const [nickname, setNickname] = useState<string | null>(null);
  const [status, setStatus] = useState<FriendStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Гейт ещё редиректит незалогиненного — запоминаем цель, чтобы вернуться сюда после регистрации.
  useEffect(() => {
    if (gate === "blocked") {
      try {
        sessionStorage.setItem(PENDING_KEY, targetId);
      } catch {}
    }
  }, [gate, targetId]);

  useEffect(() => {
    if (gate !== "ready") return;
    // Своя ссылка — искать себя незачем (поиск и так скрывает self-хиты); ветка рендерится
    // отдельно и loading для неё не участвует (см. JSX ниже).
    if (myPublicId && myPublicId === targetId) return;
    void (async () => {
      const t = await token();
      if (!t) {
        setLoading(false);
        return;
      }
      const hits = await searchUsers(targetId, t);
      const hit = hits.find((h) => h.publicId === targetId);
      if (!hit) {
        setNotFound(true);
      } else {
        setNickname(hit.nickname);
        setStatus(hit.status);
        // Цель найдена и открыта вживую — больше не нужно возвращаться сюда после логина.
        try {
          sessionStorage.removeItem(PENDING_KEY);
        } catch {}
      }
      setLoading(false);
    })();
  }, [gate, targetId, myPublicId]);

  if (gate !== "ready") return null;

  const isSelf = myPublicId === targetId;

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const t = await token();
      if (!t) throw new Error("нет сессии");
      const next = await addFriend(targetId, t);
      setStatus(next);
    } catch {
      setError("Не удалось отправить запрос");
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const t = await token();
      if (!t) throw new Error("нет сессии");
      const next = await respondFriend(targetId, "accept", t);
      setStatus(next);
    } catch {
      setError("Не удалось принять запрос");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      {isSelf ? (
        <div className="w-full max-w-sm">
          <p className="text-sm text-fg-secondary">Это твоя собственная ссылка — поделись ей с кем-нибудь ещё.</p>
          <Link
            href="/"
            className="mt-6 flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-4 text-base font-semibold text-accent-fg"
          >
            На главную
          </Link>
        </div>
      ) : loading ? (
        <>
          <div className="h-[88px] w-[88px] animate-pulse rounded-full bg-surface-2" />
          <div className="mt-4 h-5 w-32 animate-pulse rounded bg-surface-2" />
        </>
      ) : notFound ? (
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-bold">Пользователь не найден</h1>
          <p className="mt-2 text-sm text-fg-secondary">Ссылка устарела или #ID указан неверно.</p>
          <Link
            href="/"
            className="mt-6 flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-surface-1 px-4 text-base font-medium text-fg-secondary"
          >
            На главную
          </Link>
        </div>
      ) : (
        <div className="w-full max-w-sm">
          <Avatar publicId={targetId} name={nickname ?? undefined} size={88} className="mx-auto" />
          <h1 className="mt-4 text-xl font-bold">Добавить {nickname ?? `#${targetId}`}?</h1>
          <p className="mt-1 font-mono text-xs text-fg-muted">#{targetId}</p>

          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="mt-6">
            {status === "accepted" ? (
              <Link
                href={`/dm/${targetId}`}
                className="flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-4 text-base font-semibold text-accent-fg"
              >
                Открыть переписку
              </Link>
            ) : status === "pending_me" ? (
              <button disabled className="min-h-11 w-full rounded-xl border border-border bg-surface-1 px-4 text-base font-medium text-fg-muted">
                Запрос отправлен
              </button>
            ) : status === "pending_peer" ? (
              <button
                onClick={() => void accept()}
                disabled={busy}
                className="min-h-11 w-full rounded-xl bg-accent px-4 text-base font-semibold text-accent-fg transition disabled:opacity-60"
              >
                {busy ? "Принимаем…" : "Принять запрос дружбы"}
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={busy}
                className="min-h-11 w-full rounded-xl bg-accent px-4 text-base font-semibold text-accent-fg transition disabled:opacity-60"
              >
                {busy ? "Отправляем…" : "Отправить запрос дружбы"}
              </button>
            )}
          </div>

          <button onClick={() => router.push("/")} className="mt-4 text-sm text-fg-muted transition hover:text-fg">
            На главную
          </button>
        </div>
      )}
    </div>
  );
}
