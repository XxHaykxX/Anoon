"use client";

import { ArrowLeft, Search, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Avatar } from "@/components/avatar";
import {
  addFriend,
  fetchFriends,
  removeFriend,
  respondFriend,
  searchUsers,
  type SearchHit,
  sendBlock,
} from "@/lib/api";
import { isOnline, presenceLabel } from "@/lib/last-seen";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { useRequireAccount } from "@/lib/use-require-account";
import { cn } from "@/lib/utils";
import { useFriendsCache } from "@/store/friends";

async function token(): Promise<string | null> {
  if (!supabaseConfigured) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

const fullName = (p: { firstName?: string | null; lastName?: string | null }) =>
  [p.firstName, p.lastName].filter(Boolean).join(" ").trim();

export default function FriendsPage() {
  const gate = useRequireAccount();
  const router = useRouter();

  // Кэш друзей/заявок — мгновенный рендер из localStorage + фоновый refresh (без блокировки).
  const friends = useFriendsCache((s) => s.friends);
  const incoming = useFriendsCache((s) => s.incoming);
  const loaded = useFriendsCache((s) => s.loaded);
  const setAll = useFriendsCache((s) => s.setAll);
  const removeFriendLocal = useFriendsCache((s) => s.removeFriendLocal);
  const removeIncomingLocal = useFriendsCache((s) => s.removeIncomingLocal);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    const t = await token();
    if (!t) return;
    const data = await fetchFriends(t);
    setAll(data);
  }, [setAll]);

  useEffect(() => {
    if (gate !== "ready") return;
    // Фоновый refresh — НЕ блокирует рендер (кэш уже на экране). Скелет только при первой загрузке.
    void load();
  }, [gate, load]);

  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    const t = await token();
    if (!t) {
      setSearching(false);
      return;
    }
    setResults(await searchUsers(q, t));
    setSearching(false);
  };

  const onAdd = async (publicId: string) => {
    const t = await token();
    if (!t) return;
    await addFriend(publicId, t).catch(() => {});
    setResults((r) => r?.map((h) => (h.publicId === publicId ? { ...h, status: "pending_me" } : h)) ?? null);
  };

  const onAccept = async (publicId: string) => {
    const t = await token();
    if (!t) return;
    await respondFriend(publicId, "accept", t).catch(() => {});
    await load();
  };

  const onDecline = async (publicId: string) => {
    const t = await token();
    if (!t) return;
    removeIncomingLocal(publicId); // оптимистично (снапшот-кэш)
    await respondFriend(publicId, "decline", t).catch(() => {});
  };

  const onRemove = async (publicId: string) => {
    if (!window.confirm("Убрать из друзей? Личка пропадёт. Профиль вы уже видели — анонимность не вернётся.")) return;
    const t = await token();
    if (!t) return;
    removeFriendLocal(publicId); // оптимистично
    await removeFriend(publicId, t);
  };

  const onBlock = async (publicId: string) => {
    const t = await token();
    if (!t) return;
    await sendBlock(publicId, t).catch(() => {});
    setResults((r) => r?.filter((h) => h.publicId !== publicId) ?? null);
  };

  if (gate !== "ready") return null;

  return (
    <div className="mx-auto max-w-lg px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
      <header className="mb-4 flex items-center gap-3">
        <button
          onClick={() => router.push("/")}
          className="flex h-9 w-9 items-center justify-center rounded-full text-fg-secondary hover:bg-surface-2"
          aria-label="Назад"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold">Друзья</h1>
      </header>

      {/* Поиск по #ID или нику */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border bg-surface-1 px-4">
          <Search size={16} className="shrink-0 text-fg-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
            }}
            inputMode="text"
            placeholder="#ID или ник"
            aria-label="Поиск по #ID или нику"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {query ? (
            <button
              onClick={() => {
                setQuery("");
                setResults(null);
              }}
              className="shrink-0 text-fg-muted hover:text-fg"
              aria-label="Очистить"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
        <button
          onClick={() => void runSearch()}
          className="min-h-11 shrink-0 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg"
        >
          Найти
        </button>
      </div>

      {/* Результаты поиска */}
      {results !== null ? (
        <section className="mb-4">
          {searching ? (
            <div className="h-14 animate-pulse rounded-2xl bg-surface-2" />
          ) : results.length === 0 ? (
            <p className="px-1 py-3 text-sm text-fg-muted">Никого с таким #ID или ником</p>
          ) : (
            <ul className="space-y-2">
              {results.map((h) => (
                <li key={h.publicId} className="flex items-center gap-3 rounded-2xl bg-surface-1 p-3">
                  <Avatar publicId={h.publicId} name={h.nickname} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{h.nickname}</div>
                    <div className="truncate font-mono text-xs text-fg-muted">#{h.publicId}</div>
                  </div>
                  {h.status === "accepted" ? (
                    <Link href={`/dm/${h.publicId}`} className="rounded-full bg-surface-2 px-3 py-2 text-xs font-medium text-fg-secondary">
                      Открыть
                    </Link>
                  ) : h.status === "pending_me" ? (
                    <span className="px-3 py-2 text-xs text-fg-muted">Запрос отправлен</span>
                  ) : h.status === "pending_peer" ? (
                    <button onClick={() => void onAccept(h.publicId)} className="rounded-full bg-accent px-3 py-2 text-xs font-medium text-accent-fg">
                      Принять
                    </button>
                  ) : (
                    <button
                      onClick={() => void onAdd(h.publicId)}
                      className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-2 text-xs font-medium text-accent-fg"
                    >
                      <UserPlus size={14} />
                      Запрос
                    </button>
                  )}
                  <button
                    onClick={() => void onBlock(h.publicId)}
                    className="rounded-full px-2 py-2 text-xs text-fg-muted hover:text-danger"
                    aria-label="Заблокировать"
                  >
                    Блок
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* Входящие запросы */}
      {incoming.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Входящие</h2>
          <ul className="space-y-2">
            {incoming.map((p) => (
              <li key={p.publicId} className="flex items-center gap-3 rounded-2xl bg-surface-1 p-3">
                <Avatar publicId={p.publicId} name={p.nickname} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.nickname}</div>
                  <div className="truncate font-mono text-xs text-fg-muted">#{p.publicId} хочет открыть профили</div>
                </div>
                <button onClick={() => void onAccept(p.publicId)} className="rounded-full bg-accent px-3 py-2 text-xs font-medium text-accent-fg">
                  Открыть
                </button>
                <button onClick={() => void onDecline(p.publicId)} className="rounded-full px-2 py-2 text-xs text-fg-muted hover:text-fg">
                  Отклонить
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Список друзей */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Мои друзья</h2>
        {!loaded ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface-2" />
            ))}
          </div>
        ) : friends.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center">
            <p className="text-sm text-fg-secondary">Пока никого. Найди по #ID или раскройся в чате.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {friends.map((f) => (
              <li key={f.publicId} className="flex items-center gap-3 rounded-2xl bg-surface-1 p-3">
                <Link href={`/dm/${f.publicId}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar avatarUrl={f.avatarUrl ?? undefined} publicId={f.publicId} name={fullName(f) || f.nickname} size={44} online={isOnline(f.lastSeen)} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{fullName(f) || f.nickname}</div>
                    <div className={cn("truncate text-xs", isOnline(f.lastSeen) ? "text-success" : "text-fg-muted")}>
                      {presenceLabel(f.lastSeen)}
                    </div>
                  </div>
                </Link>
                <button
                  onClick={() => void onRemove(f.publicId)}
                  className="rounded-full px-2 py-2 text-xs text-fg-muted hover:text-danger"
                  aria-label="Убрать из друзей"
                >
                  Убрать
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
