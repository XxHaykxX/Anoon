"use client";

import { useState } from "react";
import { BellIcon, DownloadIcon } from "@/components/icons";
import { AnoonAvatar, AnoonLogo, AnoonBottomNav } from "@/components/anoon/_shared";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import { authedFileUrl, getTinodeClient, USE_TINODE } from "@/lib/tinode";
import { useAnoonStore } from "@/store";

/** The signed-in account's own Tinode topic — avatar lives on `me`. */
const MY_TOPIC = "me";

/* Age ranges shared by both filters. */
const AGE_RANGES = ["18–21", "22–25", "26–35", "36+"] as const;
type AgeRange = (typeof AGE_RANGES)[number];

/** Two-letter avatar initials from a display name (1 word → first 2 letters). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Desktop column — same 36rem the other tab screens use, so switching tabs in
 * the rail doesn't slide the content sideways.
 *
 * `lg:[.anoon-desktop_&]:` needs both halves: `lg:` alone would also fire in the
 * showcase (it renders this screen in a fixed 390px frame on a wide monitor),
 * and `.anoon-desktop` alone sits on the app root at every width and would
 * restyle the phone. See docs/DESKTOP-LAYOUT.md.
 */
const DESKTOP_COL =
  "lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:w-full lg:[.anoon-desktop_&]:max-w-[36rem]";

/** Bucket a numeric age (from the profile) into one of the shared ranges. */
function ageRangeFor(age: number): AgeRange {
  if (age <= 21) return "18–21";
  if (age <= 25) return "22–25";
  if (age <= 35) return "26–35";
  return "36+";
}

export default function AnoonHome() {
  const nav = useAnoonNav();
  // Partner age — multi-select set of ranges. (BUG-21: the user's OWN age is
  // no longer picked here — it's redundant with the profile's age, set once
  // at registration — see `ownAgeRange` below.)
  const [partnerAges, setPartnerAges] = useState<AgeRange[]>([]);
  const [searching, setSearching] = useState(false);

  // Real mode: join the companion queue with the chosen filters. The #ID card
  // shows the signed-in user's real hashId when available (stub otherwise).
  const joinQueue = useAnoonStore((s) => s.joinQueue);
  const user = useAnoonStore((s) => s.user);
  // Bell badge: real unread-notifications count when signed in; stub otherwise.
  const unreadCount = useAnoonStore((s) => s.unreadCount);
  const real = USE_TINODE && !!user;
  const hashId = real ? `#${user!.hashId}` : "#00001";
  const cardName = real ? user!.displayName : "Аноним";
  const cardInitials = real ? initialsOf(user!.displayName) : "Ан";
  const cardTone = real ? user!.avatarTone : 4;
  const notifBadge = real ? unreadCount : 3;
  const cardAvatarRef = real ? getTinodeClient().avatarRefFor(MY_TOPIC) : null;
  // Own age range, sourced from the profile (not user-picked) — showcase
  // stub mirrors the same default the mock previously seeded by hand.
  const ownAgeRange: AgeRange = real ? ageRangeFor(user!.age) : "22–25";

  const togglePartnerAge = (range: AgeRange) => {
    setPartnerAges((prev) =>
      prev.includes(range) ? prev.filter((r) => r !== range) : [...prev, range],
    );
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className={`flex items-center justify-between px-5 pt-4 ${DESKTOP_COL}`}>
        {/* Desktop: the rail already carries the anoon wordmark two centimetres
            to the left, so the screen's own copy is a duplicate. Swap it for the
            tab's title, which is what every other screen shows here. */}
        <AnoonLogo className="lg:[.anoon-desktop_&]:hidden" />
        <h1 className="hidden text-2xl font-bold lg:[.anoon-desktop_&]:block">Рулетка</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => nav.push("install")}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold transition-transform active:scale-95"
          >
            <DownloadIcon className="size-4" />
            Установить
          </button>
          <button
            type="button"
            onClick={() => nav.go("notifications")}
            className="relative flex size-9 items-center justify-center rounded-full border border-border bg-card transition-transform active:scale-95"
            aria-label="Уведомления"
          >
            <BellIcon className="size-5" />
            {notifBadge > 0 && (
              <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
                {notifBadge > 9 ? "9+" : notifBadge}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Scrollable content. On the phone this box eats the leftover height so
          «Начать чат» sits above the nav bar. On a 900px-tall desktop that same
          rule left 560px of nothing between the age filter and the button, so
          there the box is only as tall as its content and the button follows it
          — this screen is three short blocks, it never needs the scroll. */}
      <div
        className={`flex-1 overflow-y-auto px-5 pb-4 pt-4 lg:[.anoon-desktop_&]:flex-none ${DESKTOP_COL}`}
      >
        {/* Own card */}
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
          <AnoonAvatar
            initials={cardInitials}
            tone={cardTone}
            size={48}
            photoUrl={cardAvatarRef ? authedFileUrl(cardAvatarRef) : null}
          />

          <div className="min-w-0">
            <p className="truncate font-semibold">{cardName}</p>
            <p className="text-xs text-muted-foreground">{hashId}</p>
          </div>
        </div>

        {/* Partner age — multi-select chips */}
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Возраст собеседника</h2>
            <span className="text-[11px] text-muted-foreground">можно несколько</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {AGE_RANGES.map((range) => {
              const active = partnerAges.includes(range);
              return (
                <button
                  key={range}
                  type="button"
                  onClick={() => togglePartnerAge(range)}
                  className={[
                    "select-none rounded-full border px-4 py-2 text-xs font-semibold transition-transform active:scale-95",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground",
                  ].join(" ")}
                >
                  {range}
                </button>
              );
            })}
          </div>
        </section>

        {/* Gender note */}
        <p className="mt-5 rounded-xl bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          Пол собеседника подбирается автоматически — противоположный вашему.
        </p>
      </div>

      {/* Start button (pinned above nav) — always enabled now that own age
          isn't a manual step (BUG-21). */}
      <div className={`px-5 pb-3 ${DESKTOP_COL}`}>
        <button
          type="button"
          onClick={() => {
            setSearching(true);
            // Real mode: enqueue via companion; the `matched` event opens the
            // chat. Mock mode: the searching screen auto-advances on a timer.
            if (USE_TINODE) {
              // A refused enqueue (suspended account, rate limit) used to be
              // answered with a fabricated match. Now it rejects, and there is
              // no queue to wait in — so leave the search screen instead of
              // spinning on a `matched` event that will never arrive.
              void joinQueue({ ownAgeRange, peerAgeRanges: partnerAges }).catch(() => {
                setSearching(false);
                nav.go("home");
              });
            }
            nav.push("searching");
          }}
          className="w-full select-none rounded-2xl bg-primary py-4 text-base font-bold text-primary-foreground transition-transform active:scale-95"
        >
          {searching ? "Поиск…" : "Начать чат"}
        </button>
      </div>

      <AnoonBottomNav active="home" badges={{ notifications: notifBadge }} />
    </div>
  );
}
