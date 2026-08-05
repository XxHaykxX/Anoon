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

/** anoon wordmark. */
export function AnoonLogo({ className }: { className?: string }) {
  return (
    <span className={cn("select-none text-2xl font-extrabold tracking-tight", className)}>
      <span className="text-primary">b</span>
      <span className="text-foreground">adu</span>
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

/** Bottom navigation for the 4 main sections (hidden inside chat screens). */
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
    <nav className="relative mt-auto flex shrink-0 items-stretch justify-around border-t border-border bg-background pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-2">
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
