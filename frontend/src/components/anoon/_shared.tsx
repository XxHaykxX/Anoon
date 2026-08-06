"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChatIcon, PeopleIcon, BellIcon, UserCircleIcon } from "@/components/icons";
import { useAnoonNav } from "@/components/anoon/anoonNav";

/**
 * Shared press feedback for tappable elements. One definition for the whole
 * app so the scale, the easing and the reduced-motion escape stay in sync.
 * Rule of thumb: `active:scale-95` (this) for buttons/icons/chips,
 * `active:scale-[0.99]` for full-width rows, `active:scale-[0.98]` for media.
 */
export const PRESS_FX =
  "cursor-pointer transition-transform active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100";

/* Calm, desaturated avatar gradients — shared visual language across all screens. */
export const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #8E9BC0 0%, #5F6F9E 100%)", // slate
  "linear-gradient(135deg, #93BEA0 0%, #64977B 100%)", // sage
  "linear-gradient(135deg, #CE93A6 0%, #AC6C86 100%)", // rose
  "linear-gradient(135deg, #E7B75F 0%, #C98F3B 100%)", // amber
  "linear-gradient(135deg, #A995C9 0%, #7F68A8 100%)", // violet
  "linear-gradient(135deg, #86B7BD 0%, #5D939B 100%)", // teal
] as const;

/** Gradient circle avatar with initials (no photos, per brand). */
export function AnoonAvatar({
  initials,
  tone = 0,
  size = 44,
  className,
}: {
  initials: string;
  tone?: number;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("relative flex shrink-0 items-center justify-center rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: AVATAR_GRADIENTS[tone % AVATAR_GRADIENTS.length],
      }}
    >
      <span className="font-semibold text-white/95" style={{ fontSize: Math.round(size * 0.34) }}>
        {initials}
      </span>
    </div>
  );
}

/** Small online/offline presence dot. */
export function StatusDot({ online = true, className }: { online?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-2.5 rounded-full ring-2 ring-background",
        online ? "bg-online" : "bg-muted-foreground/50",
        className,
      )}
    />
  );
}

/**
 * anoon wordmark — the only place the product name is drawn (10 screens use it).
 *
 * Split across two spans so the initial can carry the brand yellow while the
 * rest stays foreground; that is also why a grep for the name finds nothing —
 * the 2026-08-05 rename missed this file because «badu» was never one string.
 */
export function AnoonLogo({ className }: { className?: string }) {
  return (
    <span className={cn("select-none text-2xl font-extrabold tracking-tight", className)}>
      <span className="text-primary">a</span>
      <span className="text-foreground">noon</span>
    </span>
  );
}

/** Two crossing arrows — "shuffle a new match", the roulette action's glyph. */
const RouletteIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M4 7h11l-2.5-2.5M15 7l-2.5 2.5" />
    <path d="M20 17H9l2.5 2.5M9 17l2.5-2.5" />
  </svg>
);

export type AnoonTab = "chats" | "friends" | "home" | "notifications" | "profile";

/**
 * Tab order (BUG-36 — reverses part of BUG-24): 5 slots, symmetric around the
 * center FAB — [Чаты] [Друзья] (Рулетка, raised center) [Уведомления] [Профиль].
 * «Чаты» (id `"chats"`, a NEW route — see AnoonApp.tsx) is the post-login
 * landing screen, active conversations only. «Друзья» (id `"friends"`, the
 * original route, unchanged) is the full contact list/search/requests — its
 * own screen again, not folded into Чаты. «Рулетка» (id `"home"`) stays the
 * elevated center action — see the special-cased render branch below.
 */
const TABS: { id: AnoonTab; label: string; Icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
  { id: "chats", label: "Чаты", Icon: ChatIcon },
  { id: "friends", label: "Контакты", Icon: PeopleIcon },
  { id: "home", label: "Рулетка", Icon: RouletteIcon },
  { id: "notifications", label: "Уведомления", Icon: BellIcon },
  { id: "profile", label: "Профиль", Icon: UserCircleIcon },
];

function capBadge(n: number): string {
  return n > 9 ? "9+" : String(n);
}

/** Stable QA anchors — route ids don't always read as the label 1:1 (BUG-24/36). */
const NAV_TESTID: Record<AnoonTab, string> = {
  chats: "nav-chats",
  friends: "nav-friends",
  home: "nav-roulette",
  notifications: "nav-notifications",
  profile: "nav-profile",
};

/**
 * Bottom navigation for the 4 main sections (hidden inside chat screens).
 *
 * Desktop (≥1024px, inside AnoonApp only): hidden by `.anoon-bottom-nav` in
 * globals.css and replaced by {@link AnoonSideNav}, which the app SHELL renders
 * — not the screens. The hook is a class and not a `lg:hidden` utility on
 * purpose: the showcase draws these same screens inside fixed 390px frames on a
 * wide monitor, where a viewport media query would wrongly hide the bar.
 */
export function AnoonBottomNav({
  active,
  onChange,
  badges = {},
}: {
  active: AnoonTab;
  onChange?: (tab: AnoonTab) => void;
  badges?: Partial<Record<AnoonTab, number>>;
}) {
  // Self-wired: falls back to the shell's nav.go(tab) so every main screen's
  // bottom bar is interactive without each having to pass onChange. In the
  // showcase (no provider) nav.go is a no-op, so standalone rendering is safe.
  const nav = useAnoonNav();
  return (
    <nav className="anoon-bottom-nav relative mt-auto flex shrink-0 items-stretch justify-around border-t border-border bg-background pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-2">
      {TABS.map(({ id, label, Icon }) => {
        const isActive = id === active;
        const badge = badges[id] ?? 0;

        // «Рулетка» is the primary action (BUG-24): a bigger, raised,
        // accent-colored disc that pokes up above the bar via a negative top
        // margin, rather than an equal-weight tab like the other three.
        if (id === "home") {
          return (
            <button
              key={id}
              type="button"
              data-testid={NAV_TESTID[id]}
              onClick={() => (onChange ? onChange(id) : nav.go(id))}
              className="relative flex flex-1 select-none flex-col items-center gap-1 transition-transform active:scale-95"
              aria-current={isActive}
            >
              <span
                className="relative -mt-7 flex size-14 items-center justify-center rounded-full bg-primary ring-4 ring-background"
                style={{ boxShadow: "0 10px 24px -6px rgba(253,191,45,0.55)" }}
              >
                <Icon className="size-7 text-primary-foreground" />
                {badge > 0 && (
                  <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
                    {capBadge(badge)}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-semibold text-primary">{label}</span>
            </button>
          );
        }

        return (
          <button
            key={id}
            type="button"
            data-testid={NAV_TESTID[id]}
            onClick={() => (onChange ? onChange(id) : nav.go(id))}
            className={cn(
              "relative flex flex-1 select-none flex-col items-center gap-0.5 transition-transform active:scale-95",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
            aria-current={isActive}
          >
            <span className="relative">
              <Icon className="size-6" />
              {badge > 0 && (
                <span className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
                  {capBadge(badge)}
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Desktop navigation rail — the ≥1024px counterpart of {@link AnoonBottomNav},
 * built from the same {@link TABS} list so the two can never drift apart.
 *
 * Rendered by the SHELL (AnoonApp), once, not by each screen: on desktop the
 * rail has to survive screen changes and sub-screens (настройки, заявки) that
 * carry no bottom bar of their own. Visibility is entirely CSS
 * (`.anoon-side-nav`, globals.css) — it is in the DOM at every width, so the
 * shell must not gate it on a JS-measured viewport.
 *
 * Test ids are suffixed `-desktop` because both navs coexist in the DOM at all
 * widths; reusing the phone ids would give every `nav-*` query two hits.
 */
export function AnoonSideNav({
  active,
  onChange,
  badges = {},
}: {
  active: AnoonTab;
  onChange?: (tab: AnoonTab) => void;
  badges?: Partial<Record<AnoonTab, number>>;
}) {
  const nav = useAnoonNav();
  return (
    <nav
      aria-label="Основная навигация"
      className="anoon-side-nav w-[var(--anoon-nav-w)] shrink-0 flex-col gap-1 border-r border-border bg-background px-3 py-5"
    >
      <AnoonLogo className="mb-4 px-3 text-xl" />
      {TABS.map(({ id, label, Icon }) => {
        const isActive = id === active;
        const badge = badges[id] ?? 0;
        const isPrimary = id === "home";
        return (
          <button
            key={id}
            type="button"
            data-testid={`${NAV_TESTID[id]}-desktop`}
            onClick={() => (onChange ? onChange(id) : nav.go(id))}
            aria-current={isActive}
            className={cn(
              "relative flex select-none items-center gap-3 rounded-xl py-2 pl-4 pr-3 text-sm",
              // Desktop has a keyboard: a rail with hover styling and no focus
              // ring reads as broken tab navigation.
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              PRESS_FX,
              // "Where am I" is carried by exactly ONE treatment — the filled
              // row + the accent bar below — and nothing else in the rail may
              // borrow it. See the primary-icon comment for why.
              isActive
                ? "bg-secondary font-semibold text-foreground"
                : cn(
                    "font-medium hover:bg-secondary/60 hover:text-foreground",
                    isPrimary ? "text-primary" : "text-muted-foreground",
                  ),
            )}
          >
            {isActive && (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary"
              />
            )}
            {/*
              «Рулетка» is the primary ACTION, not a place — on the phone bar it
              says so by being a raised yellow disc in the center slot. A rail
              has no center slot, and a full-width yellow row said "you are
              here" instead: two tabs then looked selected at once. So the disc
              survives as a disc, at icon size, and the filled-row treatment is
              left to mean selection and nothing else. Every icon sits in the
              same 28px box so the labels stay on one vertical line.
            */}
            <span className="grid size-7 shrink-0 place-items-center">
              {isPrimary ? (
                <span
                  className="grid size-7 place-items-center rounded-full bg-primary"
                  style={{ boxShadow: "0 6px 16px -8px rgba(253,191,45,0.75)" }}
                >
                  <Icon className="size-4 text-primary-foreground" />
                </span>
              ) : (
                <Icon className="size-5" />
              )}
            </span>
            <span className="truncate">{label}</span>
            {badge > 0 && (
              <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-white">
                {capBadge(badge)}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
