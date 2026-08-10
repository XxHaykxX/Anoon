"use client";

import { useEffect, useMemo, useState } from "react";
import { AnoonAvatar, AnoonBottomNav, PRESS_FX, StatusDot } from "@/components/anoon/_shared";
import { SearchIcon, CloseIcon, ChevronRightIcon, ForwardIcon, ChatIcon } from "@/components/icons";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import { authedFileUrl, getTinodeClient, USE_TINODE } from "@/lib/tinode";
import { useAnoonStore } from "@/store";

/** Real photo when the contact has one set, else the usual gradient initials. */
function FriendAvatar({
  topic,
  initials,
  tone,
  size,
}: {
  topic?: string;
  initials: string;
  tone: number;
  size: number;
}) {
  const ref = USE_TINODE && topic ? getTinodeClient().avatarRefFor(topic) : null;
  return (
    <AnoonAvatar
      initials={initials}
      tone={tone}
      size={size}
      photoUrl={ref ? authedFileUrl(ref) : null}
    />
  );
}


interface Friend {
  id: string;
  hashId: string;
  name: string;
  initials: string;
  tone: number;
  online: boolean;
  lastSeen?: string;
  unread: number;
  /** Last message preview, real mode only. */
  lastMessage?: string;
  /** Unix ms of last activity (real mode only) — drives the row timestamp and sort order (BUG-25). */
  lastActiveAt?: number;
  /** Tinode p2p topic, for the real avatar photo. */
  topic?: string;
}

/** Coarse "N ago" label from a unix-ms timestamp (RU) — same phrasing as AnoonNotifications.tsx. */
function relativeTime(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  return d === 1 ? "вчера" : `${d} дн`;
}

// f1/f3/f5 carry a lastMessage so the mock «Чаты» view (BUG-36: active
// conversations only) isn't always empty in the showcase; f2/f4/f6 are
// friends with no chat started yet — visible only in the full «Друзья» list.
const INITIAL_FRIENDS: Friend[] = [
  { id: "f1", hashId: "#00042", name: "Лиса", initials: "Л", tone: 2, online: true, unread: 3, lastMessage: "Привет! Как дела?" },
  { id: "f2", hashId: "#00108", name: "Ворон", initials: "В", tone: 0, online: false, lastSeen: "был 5 мин назад", unread: 0 },
  { id: "f3", hashId: "#00317", name: "Мила", initials: "М", tone: 4, online: true, unread: 12, lastMessage: "Ты видел фото?" },
  { id: "f4", hashId: "#00521", name: "Тень", initials: "Т", tone: 5, online: false, lastSeen: "была 2 ч назад", unread: 0 },
  { id: "f5", hashId: "#00777", name: "Оникс", initials: "О", tone: 3, online: false, lastSeen: "был вчера", unread: 1, lastMessage: "Договорились, до встречи" },
  { id: "f6", hashId: "#00934", name: "Ирис", initials: "И", tone: 1, online: true, unread: 0 },
];

function capBadge(n: number): string {
  return n > 9 ? "9+" : String(n);
}

/**
 * Desktop column. On ≥1024px the work area is up to 60rem wide, so a phone-width
 * row stretched across it puts the name at one edge and the chevron at the other
 * — the row stops reading as one object. Centre a 36rem column instead — the
 * same width «Заявки» and «Найти друга» use, so moving between the three
 * screens of this tab doesn't shift the content sideways.
 *
 * BOTH halves of `lg:[.anoon-desktop_&]:` are load-bearing, and neither works
 * alone: `lg:` is the width test, but the showcase (`src/app/page.tsx`) renders
 * this very screen inside fixed 390px frames on a wide monitor, so `lg:` on its
 * own fires there too; `.anoon-desktop` excludes the showcase (only AnoonApp
 * carries that class), but it sits on the app root at EVERY width, so on its own
 * it would restyle the phone. See docs/DESKTOP-LAYOUT.md.
 */
const DESKTOP_COL =
  "lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:w-full lg:[.anoon-desktop_&]:max-w-[36rem]";

/**
 * Header actions. These used to be bare `<svg onClick>` with an aria-label — a
 * Tab walk over «Чаты» never stopped on them, so «Пригласить друга» and «Поиск
 * друзей» were unreachable from the keyboard entirely. A real <button> fixes
 * that and brings the focus ring the project rule demands wherever there's a
 * press effect.
 *
 * `p-1.5 -m-1.5` grows the tap target (24→36px) and rounds the focus ring
 * without moving anything: the negative margin cancels the padding, so the
 * header's `gap-4` still measures 16px between the icons themselves.
 */
const ICON_BTN =
  `grid place-items-center rounded-full p-1.5 -m-1.5 text-foreground ${PRESS_FX} ` +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * BUG-36: this single screen renders BOTH nav tabs — «Чаты» (route "chats",
 * the post-login landing screen, active conversations only) and «Друзья»
 * (route "friends", the full contact list + search/requests/add-by-#ID).
 * The two thin wrappers live in AnoonApp.tsx; this component just switches on
 * `mode` for the title, the empty-state copy, the list filter, and which
 * bottom-nav tab lights up. Defaults to "friends" so `SCREENS.friends =
 * AnoonFriends` (no wrapper needed there) keeps working with zero props.
 *
 * `onOpen`/`selectedId` are the desktop two-pane hook-up (#34): with `onOpen`
 * the list reports the tapped row to its parent instead of navigating to the
 * chat route, and `selectedId` marks which row the right pane is showing. Both
 * absent = the phone behaviour, a push to "private-chat".
 */
export default function AnoonFriends({
  mode = "friends",
  selectedId = null,
  onOpen,
}: {
  mode?: "chats" | "friends";
  selectedId?: string | null;
  onOpen?: (id: string) => void;
}) {
  const isChats = mode === "chats";
  const nav = useAnoonNav();
  const [mockFriends, setMockFriends] = useState<Friend[]>(INITIAL_FRIENDS);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // Real mode: contacts come from the Tinode `me` topic via the store.
  const storeFriends = useAnoonStore((s) => s.friends);
  const setChatTarget = useAnoonStore((s) => s.setChatTarget);
  const startContacts = useAnoonStore((s) => s.startContacts);
  // Bell badge: real unread-notifications count when signed in; stub otherwise
  // (same pattern as AnoonHome/AnoonNotifications — never hardcode a phantom count).
  const unreadCount = useAnoonStore((s) => s.unreadCount);
  const notifBadge = USE_TINODE ? unreadCount : 2;
  // Друзья tab badge: pending incoming friend requests — the natural signal
  // for that tab now that Чаты owns the unread-messages badge (BUG-36).
  const storeRequests = useAnoonStore((s) => s.requests);
  const pendingIncoming = USE_TINODE
    ? storeRequests.filter((r) => r.direction === "incoming").length
    : 0;

  useEffect(() => {
    if (USE_TINODE) void startContacts();
  }, [startContacts]);

  const friendsFull: Friend[] = USE_TINODE
    ? storeFriends
        .map((f) => ({
          id: f.id,
          hashId: f.hashId,
          name: f.displayName,
          initials: (f.displayName.trim()[0] ?? "?").toUpperCase(),
          tone: f.avatarTone,
          online: f.online,
          lastSeen: f.online ? undefined : f.lastSeen,
          unread: f.unread ?? 0,
          lastMessage: f.lastMessage ?? "",
          lastActiveAt: f.lastActiveAt,
          topic: f.topic,
        }))
        // Most-recent-activity first — the expected order for a chat list
        // (BUG-25); mock rows have no lastActiveAt so this is a no-op there.
        .sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))
    : mockFriends;

  // Чаты = active conversations only (BUG-36); Друзья = every contact.
  const friends = isChats ? friendsFull.filter((f) => !!f.lastMessage) : friendsFull;

  const openFriend = (id: string) => {
    const sf = storeFriends.find((x) => x.id === id);
    if (sf) {
      // Stash the target and let the chat screen's mount effect drive openChat.
      // Opening here (before the screen mounts) races the screen's own
      // unmount-cleanup under React StrictMode and leaves activeChat null.
      setChatTarget(sf);
    } else if (USE_TINODE) {
      // Real mode with no store friend behind the row: nothing to open.
      return;
    }
    // Mock mode falls through with chatTarget untouched — the chat screen then
    // renders its own mock thread. Before this, the mock branch bailed out here
    // and a tapped row simply did nothing.
    if (onOpen) onOpen(id);
    else nav.push("private-chat");
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return friends;
    return friends.filter(
      (f) => f.name.toLowerCase().includes(needle) || f.hashId.toLowerCase().includes(needle),
    );
  }, [friends, query]);

  // Unread badge is always computed off the full contact list — Чаты and
  // Друзья show the same total, only the row list itself is filtered.
  const totalUnread = friendsFull.reduce((sum, f) => sum + f.unread, 0);

  const removeFriend = (id: string) => {
    setMockFriends((prev) => prev.filter((f) => f.id !== id));
    setMenuFor(null);
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className={`flex items-center justify-between px-5 pb-2 pt-3 ${DESKTOP_COL}`}>
        {/* BUG-36: title matches whichever nav tab led here. */}
        <h1 className="text-2xl font-bold">{isChats ? "Чаты" : "Контакты"}</h1>
        <div className="flex items-center gap-4">
          {!searchOpen && (
            <button
              type="button"
              className={ICON_BTN}
              aria-label="Пригласить друга"
              onClick={() => nav.push("invite")}
            >
              <ForwardIcon className="size-6" />
            </button>
          )}
          {searchOpen ? (
            <button
              type="button"
              className={ICON_BTN}
              aria-label="Закрыть поиск"
              onClick={() => {
                setSearchOpen(false);
                setQuery("");
              }}
            >
              <CloseIcon className="size-6" />
            </button>
          ) : (
            <button
              type="button"
              className={ICON_BTN}
              aria-label="Поиск друзей"
              onClick={() => {
                setSearchOpen(true);
                nav.push("friend-search");
              }}
            >
              <SearchIcon className="size-6" />
            </button>
          )}
        </div>
      </div>

      {searchOpen && (
        <div className={`px-5 pb-2 ${DESKTOP_COL}`}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск среди друзей"
            autoFocus
            className="w-full rounded-full border border-transparent bg-muted px-4 py-2 text-sm text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2"
          />
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          query.trim() ? (
            // Search narrowed the list to nothing — distinct from the
            // true-empty state below (BUG-25: Чаты is the post-login landing
            // page, so a brand-new account with zero chats must not see
            // "no search results" copy).
            <div className="flex flex-col items-center justify-center px-8 pt-24 text-center">
              <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-muted">
                <SearchIcon className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Никого не нашлось</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Попробуйте другой ник или #ID
              </p>
            </div>
          ) : isChats ? (
            <div className="flex flex-col items-center justify-center px-8 pt-24 text-center">
              <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-muted">
                <ChatIcon className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Пока нет чатов</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Начните рулетку или добавьте друга по #ID
              </p>
            </div>
          ) : (
            // BUG-36: Друзья's own true-empty state (0 contacts at all) — the
            // ChatIcon copy above belongs to Чаты, not the full contact list.
            <div className="flex flex-col items-center justify-center px-8 pt-24 text-center">
              <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-muted">
                <ForwardIcon className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">Пока нет друзей</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Добавьте друга по #ID или через рулетку
              </p>
            </div>
          )
        ) : (
          visible.map((f) => (
            <div
              key={f.id}
              data-testid="friend-row"
              data-topic={f.topic}
              data-fid={f.id}
              className={`anoon-cv-row relative flex cursor-pointer items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted active:bg-muted/40 active:scale-[0.99] motion-reduce:transition-none ${DESKTOP_COL} lg:[.anoon-desktop_&]:rounded-2xl lg:[.anoon-desktop_&]:py-3 ${
                selectedId === f.id ? "bg-muted" : ""
              }`}
              // The row IS the chat, in both modes. The mock-only actions menu
              // («Убрать» has no other entry point) moved onto the context
              // menu — right-click on desktop, long-press on touch — so that
              // tapping the row can open the chat like it does in real mode.
              // The click itself lives on the stretched button below, not here:
              // a <div onClick> is invisible to Tab, and the row can't BE a
              // button because it contains one («Убрать»).
              onContextMenu={(e) => {
                if (USE_TINODE) return;
                e.preventDefault();
                setMenuFor((cur) => (cur === f.id ? null : f.id));
              }}
            >
              {/* The row's click target, stretched over the whole row: one Tab
                  stop per conversation, Enter/Space for free, and a focus ring
                  that outlines the row itself. */}
              <button
                type="button"
                onClick={() => openFriend(f.id)}
                aria-label={`Открыть чат: ${f.name || f.hashId}`}
                className="absolute inset-0 z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:[.anoon-desktop_&]:rounded-2xl"
              />

              <div className="relative shrink-0">
                <FriendAvatar topic={f.topic} initials={f.initials} tone={f.tone} size={48} />
                <StatusDot online={f.online} className="absolute bottom-0 right-0" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {/* Anonymous friends have no nickname → name IS the #ID; don't
                        render it twice (BUG-42). */}
                    {f.name && f.name.replace(/^#/, "") !== f.hashId.replace(/^#/, "") ? (
                      <>
                        <span className="truncate font-semibold">{f.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{f.hashId}</span>
                      </>
                    ) : (
                      <span className="truncate font-semibold">{f.hashId}</span>
                    )}
                  </div>
                  {/* Last-activity timestamp (BUG-25) — real mode only, mock rows have no lastActiveAt. */}
                  {f.lastActiveAt && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {relativeTime(f.lastActiveAt)}
                    </span>
                  )}
                </div>
                {/* Chat-list convention (BUG-25): the last message is the
                    secondary line when there is one — online/last-seen text
                    only stands in before the first message exists. */}
                <p
                  className={`truncate text-sm ${
                    f.lastMessage
                      ? "text-muted-foreground"
                      : f.online
                        ? "text-online"
                        : "text-muted-foreground"
                  }`}
                >
                  {f.lastMessage || (f.online ? "в сети" : f.lastSeen)}
                </p>
              </div>

              {!USE_TINODE && menuFor === f.id ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFriend(f.id);
                  }}
                  // z-[2]: above the row-wide open-chat button, or the click
                  // that should remove the friend would open the chat instead.
                  className={`relative z-[2] shrink-0 rounded-full bg-destructive px-3 py-1.5 text-xs font-semibold text-white ${PRESS_FX} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                >
                  Убрать
                </button>
              ) : (
                <div className="flex shrink-0 items-center gap-2">
                  {f.unread > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                      {capBadge(f.unread)}
                    </span>
                  )}
                  {/* Decoration only: the whole row is the button now, so a
                      second control doing the same thing would just be a second
                      Tab stop per conversation for screen-reader users. */}
                  <span className="grid size-7 place-items-center text-muted-foreground" aria-hidden="true">
                    <ChevronRightIcon className="size-5" />
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <AnoonBottomNav
        active={isChats ? "chats" : "friends"}
        badges={{ chats: totalUnread, friends: pendingIncoming, notifications: notifBadge }}
      />
    </div>
  );
}
