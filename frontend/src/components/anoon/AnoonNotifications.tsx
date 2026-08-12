"use client";

import { useState } from "react";
import { AnoonBottomNav, AnoonAvatar } from "@/components/anoon/_shared";
import { BellIcon, CloseIcon, CheckIcon, PeopleIcon } from "@/components/icons";
import { useAnoonStore } from "@/store";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import { getCompanionClient } from "@/lib/companion";
import { isPushPrefEnabled, pushSupported, setPushPrefEnabled, subscribePush } from "@/lib/push";
import { USE_TINODE } from "@/lib/tinode";
import type {
  FriendRequest as StoreFriendRequest,
  Notification as StoreNotification,
} from "@/types/companion";

/**
 * Desktop clamp for the feed column — and for the header above it whenever the
 * feed is the only column. Both halves of the variant are load-bearing: `lg:`
 * alone would also fire in the showcase (it draws this screen in a fixed 390px
 * frame on a wide monitor), and `.anoon-desktop` alone sits on the app root at
 * every width and would restyle the phone. See docs/DESKTOP-LAYOUT.md.
 */
const FEED_COL =
  "lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:w-full lg:[.anoon-desktop_&]:max-w-[34rem]";

/* ── Friend requests ───────────────────────────────────────── */

interface FriendRequest {
  id: string;
  name: string;
  initials: string;
  tone: number;
  meta: string;
  /** Real-mode #ID used to answer via companion.friendRespond (absent for mocks). */
  hashId?: string;
}

/** Two-char avatar initials from a #ID handle ("#04821" → "04"). */
function initialsFromHash(hashId: string): string {
  const clean = hashId.replace(/^#/, "");
  return (clean.slice(0, 2) || "··").toUpperCase();
}

/** Stable avatar tone (0–5) from a hash string. */
function toneFromHash(hashId: string): number {
  return [...hashId].reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
}

/** Coarse "N ago" label from a unix-ms timestamp (RU). */
function relativeTime(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  return d === 1 ? "вчера" : `${d} дн назад`;
}

const initialRequests: FriendRequest[] = [
  { id: "r1", name: "Собеседник #04821", initials: "04", tone: 4, meta: "хочет добавить вас в друзья" },
  { id: "r2", name: "Собеседник #01390", initials: "01", tone: 0, meta: "2 общих собеседника" },
  { id: "r3", name: "Собеседник #07715", initials: "07", tone: 2, meta: "хочет добавить вас в друзья" },
];

/* ── Notification feed ─────────────────────────────────────── */

type FeedKind = "message" | "friend" | "like" | "system";

interface FeedItem {
  id: string;
  kind: FeedKind;
  text: string;
  time: string;
  initials?: string;
  tone?: number;
  unread: boolean;
}

const initialFeed: FeedItem[] = [
  {
    id: "n1",
    kind: "message",
    text: "Собеседник #04821 отправил вам сообщение",
    time: "только что",
    initials: "04",
    tone: 4,
    unread: true,
  },
  {
    id: "n2",
    kind: "like",
    // Алиас, а не «#01390»: предложение раскрыться приходит ДО раскрытия, то
    // есть в тот момент настоящего #ID собеседника не существует ни у кого из
    // двоих — именно это и закрывала H2. Фикстура демонстрационная, но она
    // задаёт образец строки, и «#ID до раскрытия» из неё легко переедет в
    // живой текст. Остальные фикстуры этого файла — про уже раскрытых, там #ID
    // законен.
    text: "Собеседник ~K7X2QM предложил раскрыть профили",
    time: "5 мин назад",
    initials: "~K",
    tone: 0,
    unread: true,
  },
  {
    id: "n3",
    kind: "friend",
    text: "Собеседник #07715 принял вашу заявку в друзья",
    time: "18 мин назад",
    initials: "07",
    tone: 2,
    unread: true,
  },
  {
    id: "n4",
    kind: "message",
    text: "Собеседник #02244 отправил вам сообщение",
    time: "вчера",
    initials: "02",
    tone: 5,
    unread: false,
  },
  {
    id: "n5",
    kind: "system",
    text: "Ваш профиль был показан 12 собеседникам",
    time: "вчера",
    unread: false,
  },
];

function FeedIcon({ item }: { item: FeedItem }) {
  if (item.initials) {
    return <AnoonAvatar initials={item.initials} tone={item.tone ?? 0} size={40} />;
  }
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
      <BellIcon className="size-5 text-muted-foreground" />
    </div>
  );
}

/** Map a store friend request → the local view-model the list renders. */
function requestToView(r: StoreFriendRequest): FriendRequest {
  return {
    id: r.id,
    name: r.displayName || `Собеседник ${r.hashId}`,
    initials: initialsFromHash(r.hashId),
    tone: r.avatarTone,
    meta: "хочет добавить вас в друзья",
    hashId: r.hashId,
  };
}

/** Map a store notification → the local feed item the list renders. */
function notificationToFeed(n: StoreNotification): FeedItem {
  const kind: FeedKind =
    n.kind === "friend_request" || n.kind === "friend_accepted"
      ? "friend"
      : n.kind === "revealed"
        ? "like"
        : "system";
  return {
    id: n.id,
    kind,
    text: n.body ? `${n.title} — ${n.body}` : n.title,
    time: relativeTime(n.createdAt),
    initials: n.hashId ? initialsFromHash(n.hashId) : undefined,
    tone: n.hashId ? toneFromHash(n.hashId) : undefined,
    unread: !n.read,
  };
}

export default function AnoonNotifications() {
  const nav = useAnoonNav();
  // Offer the banner only where it can lead somewhere: a browser that can do
  // Web Push and hasn't been switched on already. Lazy init reads localStorage,
  // so SSR renders the same "no banner" as a browser that can't push.
  const [showPushBanner, setShowPushBanner] = useState(
    () => pushSupported() && !isPushPrefEnabled(),
  );
  const [pushBusy, setPushBusy] = useState(false);
  /** Set when the browser or the backend refused — the banner stays and says so. */
  const [pushFailed, setPushFailed] = useState(false);

  // Real state (store) vs. offline demo state (local mock). USE_TINODE flips
  // the source; the mock arrays remain the standalone-showcase fallback.
  const storeRequests = useAnoonStore((s) => s.requests);
  const storeNotifications = useAnoonStore((s) => s.notifications);
  const storeUnread = useAnoonStore((s) => s.unreadCount);
  const removeRequest = useAnoonStore((s) => s.removeRequest);
  const addRequest = useAnoonStore((s) => s.addRequest);
  const showError = useAnoonStore((s) => s.showError);
  const markRead = useAnoonStore((s) => s.markRead);
  const markAllReadStore = useAnoonStore((s) => s.markAllRead);

  const [mockRequests, setMockRequests] = useState<FriendRequest[]>(initialRequests);
  const [mockFeed, setMockFeed] = useState<FeedItem[]>(initialFeed);

  const requests: FriendRequest[] = USE_TINODE
    ? storeRequests.filter((r) => r.direction === "incoming").map(requestToView)
    : mockRequests;

  const feed: FeedItem[] = USE_TINODE
    ? storeNotifications.map(notificationToFeed)
    : mockFeed;

  const unreadCount = USE_TINODE ? storeUnread : feed.filter((f) => f.unread).length;

  const handleRequest = (req: FriendRequest, accept: boolean) => {
    if (USE_TINODE) {
      if (req.hashId) {
        // Keep the STORE row (not this screen's view model) so a refusal can
        // put back exactly what was there.
        const original = storeRequests.find((r) => r.id === req.id);
        void getCompanionClient()
          .friendRespond(req.hashId, accept)
          .catch(() => {
            // Refused — put the request back rather than let the user think it
            // was answered (same reasoning as AnoonFriendRequests.respond).
            if (original) addRequest(original);
            showError("Не удалось ответить на заявку. Попробуйте ещё раз");
          });
      }
      removeRequest(req.id);
    } else {
      setMockRequests((prev) => prev.filter((r) => r.id !== req.id));
    }
  };

  const handleMarkAllRead = () => {
    if (USE_TINODE) markAllReadStore();
    else setMockFeed((prev) => prev.map((f) => ({ ...f, unread: false })));
  };

  const handleFeedClick = (item: FeedItem) => {
    if (USE_TINODE) markRead(item.id);
    else setMockFeed((prev) => prev.map((f) => (f.id === item.id ? { ...f, unread: false } : f)));
    // Friend-related items deep-link to the friends tab; the rest are informational.
    if (item.kind === "friend") nav.go("friends");
  };

  // Desktop only: is there anything to put in the left column next to the feed?
  const twoColumnDesktop = showPushBanner || requests.length > 0;

  /**
   * «Включить» has to end with a push subscription registered at companion, not
   * with a granted permission. It used to call `Notification.requestPermission()`
   * and close the banner: the browser prompt appeared, the user said yes, and no
   * push ever arrived — the one outcome worse than a button that does nothing.
   * `subscribePush` asks for the permission itself and never throws, so a
   * refusal (denied, backend down) keeps the banner up instead of claiming
   * success.
   */
  const handleEnablePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    setPushFailed(false);
    const ok = await subscribePush();
    setPushPrefEnabled(ok);
    setPushBusy(false);
    if (ok) setShowPushBanner(false);
    else setPushFailed(true);
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      {/* Header. It follows whichever layout the body picks below: across the
          full work area while there are two columns, and on the feed's own
          34rem clamp when the feed is alone — otherwise the title and
          «Прочитать все» sat 148px away from the rows they label. */}
      <div
        className={`flex items-center justify-between px-5 pt-4 pb-2 ${
          twoColumnDesktop ? "lg:[.anoon-desktop_&]:px-8" : FEED_COL
        }`}
      >
        <h1 className="text-3xl font-bold">Уведомления</h1>
        {unreadCount > 0 ? (
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="cursor-pointer select-none rounded-full px-3 py-1.5 text-sm font-medium text-primary transition-transform active:scale-95"
          >
            Прочитать все
          </button>
        ) : null}
      </div>

      {/*
        Desktop (≥1024) puts the banner + friend requests in one column and the
        feed in the other, without reordering the phone DOM. It only does so
        while that first column has something in it: with the banner dismissed
        and no pending requests it would otherwise be an empty half-screen, so
        the feed falls back to a single capped column (see the wrapper below).
        Desktop utilities are `lg:[.anoon-desktop_&]:…` and need both halves:
        `lg:` alone would fire in the showcase's 390px frame on a wide monitor,
        `.anoon-desktop` alone would fire on the phone, since that class is on
        the AnoonApp root at every width (docs/DESKTOP-LAYOUT.md).
      */}
      <div
        className={`flex-1 overflow-y-auto pb-2 ${
          twoColumnDesktop
            ? "lg:[.anoon-desktop_&]:grid lg:[.anoon-desktop_&]:grid-cols-2 lg:[.anoon-desktop_&]:items-start lg:[.anoon-desktop_&]:gap-x-4 lg:[.anoon-desktop_&]:px-3 lg:[.anoon-desktop_&]:pt-1"
            : ""
        }`}
      >
        <div>
          {/* Push banner */}
          {showPushBanner ? (
            <div className="mx-5 mt-1 mb-3 flex items-center gap-3 rounded-2xl bg-card p-3.5 ring-1 ring-border">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary">
                <BellIcon className="size-5 text-primary-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Включите уведомления</p>
                {/* `truncate` is a phone measure — 233px of text in a 202px
                    slot. On desktop the banner has room to spare, so the line
                    is allowed to finish. */}
                <p
                  className={`truncate text-xs lg:[.anoon-desktop_&]:overflow-visible lg:[.anoon-desktop_&]:whitespace-normal ${
                    pushFailed ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {pushFailed
                    ? "Не удалось включить — разрешите уведомления в браузере"
                    : "Не пропускайте новые сообщения и заявки"}
                </p>
              </div>
              <button
                type="button"
                disabled={pushBusy}
                onClick={() => void handleEnablePush()}
                className="shrink-0 cursor-pointer select-none rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-transform active:scale-95 disabled:opacity-60"
              >
                {pushBusy ? "Включаем…" : "Включить"}
              </button>
              {/* The icon is 16px, so the button was a 15×15 hit area — half the
                  24px minimum, and it sits next to «Включить», which is the one
                  control you must not hit by accident. The negative margin keeps
                  the banner's spacing identical. */}
              <button
                type="button"
                onClick={() => setShowPushBanner(false)}
                className="-m-2 shrink-0 cursor-pointer select-none p-2 text-muted-foreground transition-transform active:scale-95"
                aria-label="Закрыть"
              >
                <CloseIcon className="size-4" />
              </button>
            </div>
          ) : null}

          {/* Friend requests */}
          {requests.length > 0 ? (
            <div className="mb-3">
              <div className="flex items-center gap-2 px-5 pb-2 pt-1">
                <PeopleIcon className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-muted-foreground">Заявки в друзья</h2>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                  {requests.length}
                </span>
              </div>
              <div className="space-y-2 px-5">
                {requests.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border"
                  >
                    <AnoonAvatar initials={req.initials} tone={req.tone} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{req.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{req.meta}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleRequest(req, true)}
                        className="flex size-9 cursor-pointer select-none items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
                        aria-label="Принять"
                      >
                        <CheckIcon className="size-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRequest(req, false)}
                        className="flex size-9 cursor-pointer select-none items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform active:scale-95"
                        aria-label="Отклонить"
                      >
                        <CloseIcon className="size-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Feed. The width cap only bites in the single-column fallback above —
            in the two-column layout this wrapper is already narrower than it. */}
        <div className={FEED_COL}>
          <h2 className="px-5 pb-1 pt-1 text-sm font-semibold text-muted-foreground">Лента</h2>
          <div className="divide-y divide-border">
            {feed.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleFeedClick(item)}
                className={`anoon-cv-row flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none active:bg-muted ${
                  item.kind === "friend" ? "cursor-pointer" : "cursor-default"
                }`}
              >
                <FeedIcon item={item} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${item.unread ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                    {item.text}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.time}</p>
                </div>
                {item.unread ? (
                  <span className="mt-1 size-2.5 shrink-0 self-start rounded-full bg-primary" />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      <AnoonBottomNav
        active="notifications"
        badges={{ notifications: unreadCount, friends: requests.length }}
      />
    </div>
  );
}
