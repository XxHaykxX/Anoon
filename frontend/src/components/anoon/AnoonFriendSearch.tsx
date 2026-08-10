"use client";

import { useEffect, useMemo, useState } from "react";
import { AnoonAvatar, PRESS_FX } from "@/components/anoon/_shared";
import { SearchIcon, CheckIcon } from "@/components/icons";
import { USE_TINODE } from "@/lib/tinode";
import { getCompanionClient } from "@/lib/companion";
import { useAnoonStore } from "@/store";
import type { FriendSearchResult } from "@/types/companion";


interface Person {
  id: string;
  hashId: string;
  name: string;
  initials: string;
  tone: number;
  note: string;
  /** Existing relationship, to pick the right CTA (real results only). */
  relation?: FriendSearchResult["relation"];
}

const DIRECTORY: Person[] = [
  { id: "p1", hashId: "#00042", name: "Лиса", initials: "Л", tone: 2, note: "был в сети недавно" },
  { id: "p2", hashId: "#00108", name: "Ворон", initials: "В", tone: 0, note: "в сети" },
  { id: "p3", hashId: "#00256", name: "Сойка", initials: "С", tone: 3, note: "был вчера" },
  { id: "p4", hashId: "#00317", name: "Мила", initials: "М", tone: 4, note: "в сети" },
  { id: "p5", hashId: "#00777", name: "Оникс", initials: "О", tone: 5, note: "был 3 ч назад" },
];

/**
 * Desktop column — the search field and the result cards read as a form, not as
 * a 60rem-wide banner. `lg:` is the width test and `.anoon-desktop` excludes the
 * showcase (which renders this screen inside a fixed 390px frame on a wide
 * monitor) — that class alone is on the app root at every width, so both halves
 * are needed. See docs/DESKTOP-LAYOUT.md.
 */
const DESKTOP_COL =
  "lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:w-full lg:[.anoon-desktop_&]:max-w-[36rem]";

/** Bare digits of a #ID, so «#00012» and «00012» compare equal. */
const bareId = (id: string) => id.replace(/^#/, "").trim().toLowerCase();

/** Locally-known relationship + avatar tone for a searched #ID. */
interface LocalKnowledge {
  relation?: FriendSearchResult["relation"];
  tone?: number;
}

/**
 * Map a companion search result to the row model this screen renders.
 *
 * `local` fills the gaps the live companion leaves: `GET /friends/search` only
 * answers `{displayName, hashId}` — no `relation`, no `avatarTone` — so a
 * search for someone who is ALREADY a friend used to render the «Добавить»
 * CTA and invite a duplicate friend request. The store already knows the
 * answer (friends + pending requests), so fall back to it. A `relation` the
 * backend does send still wins.
 */
function resultToPerson(r: FriendSearchResult, local: LocalKnowledge = {}): Person {
  const relation = r.relation ?? local.relation;
  return {
    id: r.hashId,
    // companion already returns the id WITH its leading «#» — prefixing
    // unconditionally rendered «##00012» (BUG-42 regression). Normalise so the
    // screen is correct whichever shape the backend sends.
    hashId: r.hashId.startsWith("#") ? r.hashId : `#${r.hashId}`,
    name: r.displayName,
    initials: (r.displayName.trim()[0] ?? "?").toUpperCase(),
    tone: r.avatarTone ?? local.tone ?? 0,
    note:
      relation === "friends"
        ? "уже в друзьях"
        : relation === "request_sent"
          ? "запрос отправлен"
          : "нажмите «Добавить», чтобы отправить запрос",
    relation,
  };
}

export default function AnoonFriendSearch() {
  const [query, setQuery] = useState("");
  const [sent, setSent] = useState<Record<string, boolean>>({});
  // Real mode: debounced RAW rows from the companion search endpoint. Kept raw
  // (not pre-mapped) so the store-derived relation below re-applies whenever
  // friends/requests change while a result is on screen.
  const [realRows, setRealRows] = useState<FriendSearchResult[]>([]);

  const friends = useAnoonStore((s) => s.friends);
  const requests = useAnoonStore((s) => s.requests);
  const showError = useAnoonStore((s) => s.showError);

  /** #ID → what we already know locally about that person. */
  const localById = useMemo(() => {
    const m = new Map<string, LocalKnowledge>();
    for (const r of requests) {
      m.set(bareId(r.hashId), {
        relation: r.direction === "outgoing" ? "request_sent" : "request_received",
        tone: r.avatarTone,
      });
    }
    // Friendship outranks any stale request row for the same person.
    for (const f of friends) m.set(bareId(f.hashId), { relation: "friends", tone: f.avatarTone });
    return m;
  }, [friends, requests]);

  // Debounced companion search (real mode only).
  useEffect(() => {
    if (!USE_TINODE) return;
    const q = query.trim();
    // The field's onChange already cleared the rows for an empty query.
    if (!q) return;
    const t = setTimeout(() => {
      void getCompanionClient()
        .friendsSearch(q)
        .then((rows) => setRealRows(rows))
        // A refused search (rate limit) shows nothing rather than the offline
        // mock directory, which would list people who do not exist.
        .catch(() => setRealRows([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const realResults = useMemo(
    () => realRows.map((r) => resultToPerson(r, localById.get(bareId(r.hashId)))),
    [realRows, localById],
  );

  const mockResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return DIRECTORY.filter(
      (p) => p.name.toLowerCase().includes(needle) || p.hashId.toLowerCase().includes(needle),
    );
  }, [query]);

  const results = USE_TINODE ? realResults : mockResults;

  const addFriend = (p: Person) => {
    if (!USE_TINODE) {
      setSent((prev) => ({ ...prev, [p.id]: true }));
      return;
    }
    // «Отправлено» is a claim about the backend, so it waits for the backend to
    // agree. It used to be set unconditionally next to a fire-and-forget call
    // that swallowed refusals, which turned "blocked you" / "no such #ID" /
    // rate-limited into a request the user believes is pending.
    setSent((prev) => ({ ...prev, [p.id]: true }));
    void getCompanionClient()
      .friendRequest(p.id)
      .catch(() => {
        setSent((prev) => {
          const next = { ...prev };
          delete next[p.id];
          return next;
        });
        showError("Не удалось отправить заявку. Попробуйте ещё раз");
      });
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className={`px-5 pb-3 pt-3 ${DESKTOP_COL}`}>
        <h1 className="text-2xl font-bold">Найти друга</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Введите ID пользователя</p>
      </div>

      {/* Search field */}
      <div className={`px-5 pb-3 ${DESKTOP_COL}`}>
        <div className="flex items-center gap-2 rounded-full border border-transparent bg-muted px-4 py-2.5 ring-primary/40 transition-shadow focus-within:border-primary focus-within:ring-2">
          <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              const next = e.target.value;
              setQuery(next);
              // Emptying the field drops the previous query's rows right away.
              // Done here rather than in the debounce effect below: clearing
              // state is a consequence of this event, not of a render.
              if (!next.trim()) setRealRows([]);
            }}
            placeholder="Например, 00042"
            autoFocus
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Results. `px-5` lives on the children, not here: the desktop cap must
          include it the way the header's and the search field's do — with the
          padding on this scroller the cards were centred inside an already-inset
          box and sat 18px left of the field they answer. */}
      <div className="flex-1 overflow-y-auto">
        {query.trim() === "" ? (
          <div className="flex flex-col items-center justify-center px-5 pt-20 text-center">
            <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-muted">
              <SearchIcon className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              Введите ID — можно с решёткой или без
            </p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-5 pt-20 text-center">
            <p className="text-sm font-medium">Ничего не найдено</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Проверьте ID и попробуйте снова
            </p>
          </div>
        ) : (
          <div className={`flex flex-col gap-2.5 px-5 ${DESKTOP_COL}`}>
            {results.map((p) => {
              const isFriend = p.relation === "friends";
              const isSent = sent[p.id] || p.relation === "request_sent";
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
                >
                  <AnoonAvatar initials={p.initials} tone={p.tone} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{p.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{p.hashId}</span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{p.note}</p>
                  </div>
                  {isFriend ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-online/15 px-3 py-1.5 text-xs font-medium text-online">
                      <CheckIcon className="size-4" />
                      В друзьях
                    </span>
                  ) : isSent ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      <CheckIcon className="size-4" />
                      Запрос отправлен
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addFriend(p)}
                      className={`shrink-0 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground ${PRESS_FX}`}
                    >
                      Добавить
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
