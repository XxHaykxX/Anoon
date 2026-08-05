"use client";

import { createContext, useContext } from "react";

/** Every navigable screen in the anoon app shell. */
export type AnoonRoute =
  | "onboarding"
  | "auth-login"
  | "auth-register"
  | "auth-forgot-password"
  | "auth-reset-password"
  | "auth-verify-email"
  | "auth-gender"
  | "auth-profile-setup"
  | "home"
  | "searching"
  | "anon-chat"
  | "private-chat"
  | "chats"
  | "friends"
  | "friend-search"
  | "friend-requests"
  | "notifications"
  | "profile"
  | "settings"
  | "report"
  | "media-viewer"
  | "conversation-ended"
  | "reveal-prompt"
  | "invite"
  | "install"
  | "offline"
  | "banned"
  | "muted";

/** The 5 tabs backed by the bottom navigation (BUG-36: Чаты + Друзья split). */
export const ANOON_MAIN_TABS = [
  "chats",
  "friends",
  "home",
  "notifications",
  "profile",
] as const satisfies readonly AnoonRoute[];

export type AnoonMainTab = (typeof ANOON_MAIN_TABS)[number];

/**
 * The verb behind the most recent navigation. The shell reads this to give the
 * incoming screen a direction: `push` slides in from the right, `back` from the
 * left, `go` (lateral tab switch / stack reset) keeps the plain cross-fade.
 */
export type AnoonNavVerb = "push" | "back" | "go";

export interface AnoonNavApi {
  /** Push a route onto the stack (adds a back entry). */
  push: (route: AnoonRoute) => void;
  /** Pop the current route, returning to the previous one. */
  back: () => void;
  /** Jump to a top-level route, resetting the history stack. */
  go: (route: AnoonRoute) => void;
}

const noop = () => {};

/**
 * No-op default so screens that call `useAnoonNav()` still render fine
 * standalone (e.g. inside the showcase page.tsx) without a provider.
 */
export const AnoonNavContext = createContext<AnoonNavApi>({
  push: noop,
  back: noop,
  go: noop,
});

/** Optional navigation hook — safe to call without a provider (no-op). */
export function useAnoonNav(): AnoonNavApi {
  return useContext(AnoonNavContext);
}
