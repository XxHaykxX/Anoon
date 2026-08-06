"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeftIcon } from "@/components/icons";
import { USE_TINODE } from "@/lib/tinode";
import { useAnoonStore } from "@/store";
import { hasPersistedSession } from "@/store/slices";
import { useCallStore, type CallMedia } from "@/store/callStore";
import { onCall, sendCall } from "@/lib/callSignaling";
import { getCompanionClient } from "@/lib/companion";
import { notifyOnce, startRing, stopRing } from "@/lib/notify";
import CallScreen from "@/components/anoon/CallScreen";
import IncomingCall from "@/components/anoon/IncomingCall";
import AnoonMediaViewer from "@/components/anoon/AnoonMediaViewer";
import { useMediaViewerStore } from "@/store/mediaViewerStore";
import {
  AnoonNavContext,
  useAnoonNav,
  type AnoonNavApi,
  type AnoonNavVerb,
  type AnoonRoute,
} from "@/components/anoon/anoonNav";
import { AnoonSideNav, type AnoonTab } from "@/components/anoon/_shared";

// Statically imported: onboarding/auth entry + the always-reachable primary
// tabs (first-paint or hot paths). These live in the main app chunk.
import AnoonOnboarding from "@/components/anoon/AnoonOnboarding";
import AnoonLogin from "@/components/anoon/AnoonLogin";
import AnoonRegister from "@/components/anoon/AnoonRegister";
import AnoonGenderSelect from "@/components/anoon/AnoonGenderSelect";
import AnoonProfileSetup from "@/components/anoon/AnoonProfileSetup";
import AnoonHome from "@/components/anoon/AnoonHome";
import AnoonSearching from "@/components/anoon/AnoonSearching";
import AnoonAnonChat from "@/components/anoon/AnoonAnonChat";
import AnoonPrivateChat from "@/components/anoon/AnoonPrivateChat";
import AnoonFriends from "@/components/anoon/AnoonFriends";
import AnoonNotifications from "@/components/anoon/AnoonNotifications";
import AnoonProfile from "@/components/anoon/AnoonProfile";
import AnoonConversationEnded from "@/components/anoon/AnoonConversationEnded";
import AnoonRevealPrompt from "@/components/anoon/AnoonRevealPrompt";
// AnoonOffline is imported statically because it also renders as a global
// overlay (below) whenever the browser goes offline — not only as a route.
import AnoonOffline from "@/components/anoon/AnoonOffline";

/** Lightweight fallback shown while a code-split screen chunk loads. */
function ScreenFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <span className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

// Code-split: screens that are never the first paint and are reached only via
// explicit navigation (settings, invite, media viewer, moderation/ban screens,
// secondary auth flows, friend sub-screens). Each becomes its own chunk, kept
// out of the initial JS and fetched on first visit. The client-side stack
// router starts at "onboarding", so none of these are in the first render tree;
// a Suspense-style `loading` fallback covers the brief chunk fetch on nav.
const loading = () => <ScreenFallback />;
const AnoonForgotPassword = dynamic(() => import("@/components/anoon/AnoonForgotPassword"), { loading });
const AnoonResetPassword = dynamic(() => import("@/components/anoon/AnoonResetPassword"), { loading });
const AnoonVerifyEmail = dynamic(() => import("@/components/anoon/AnoonVerifyEmail"), { loading });
const AnoonFriendSearch = dynamic(() => import("@/components/anoon/AnoonFriendSearch"), { loading });
const AnoonFriendRequests = dynamic(() => import("@/components/anoon/AnoonFriendRequests"), { loading });
const AnoonSettings = dynamic(() => import("@/components/anoon/AnoonSettings"), { loading });
const AnoonReport = dynamic(() => import("@/components/anoon/AnoonReport"), { loading });
const AnoonMediaViewerDemo = dynamic(() => import("@/components/anoon/AnoonMediaViewerDemo"), { loading });
const AnoonInvite = dynamic(() => import("@/components/anoon/AnoonInvite"), { loading });
const AnoonInstall = dynamic(() => import("@/components/anoon/AnoonInstall"), { loading });
const AnoonBanned = dynamic(() => import("@/components/anoon/AnoonBanned"), { loading });
const AnoonMuted = dynamic(() => import("@/components/anoon/AnoonMuted"), { loading });

/** Thin router adapters for screens whose real trigger is a callback prop, not bare navigation. */
function ReportScreen() {
  const nav = useAnoonNav();
  return <AnoonReport onClose={() => nav.back()} />;
}

/**
 * «Чаты» (BUG-36) — active conversations only, the post-login landing
 * screen. Reuses AnoonFriends' rendering with `mode="chats"`; the "friends"
 * route below renders the same component with the (default) full-list mode.
 */
function ChatsScreen() {
  return <AnoonFriends mode="chats" />;
}

function ConversationEndedScreen() {
  const nav = useAnoonNav();
  return (
    <AnoonConversationEnded onSubmit={() => nav.go("home")} onSkip={() => nav.go("home")} />
  );
}

/**
 * Standalone reveal-prompt route for direct addressability / QA. The real
 * flow lives inline inside AnoonAnonChat (shown automatically on the
 * companion `reveal_request` event) — this modal has no live match to act on.
 */
function RevealPromptScreen() {
  const nav = useAnoonNav();
  return (
    <AnoonRevealPrompt
      asModal
      onOpen={() => nav.back()}
      onDecline={() => nav.back()}
      onBlock={() => nav.back()}
    />
  );
}

const SCREENS: Record<AnoonRoute, React.ComponentType> = {
  onboarding: AnoonOnboarding,
  "auth-login": AnoonLogin,
  "auth-register": AnoonRegister,
  "auth-forgot-password": AnoonForgotPassword,
  "auth-reset-password": AnoonResetPassword,
  "auth-verify-email": AnoonVerifyEmail,
  "auth-gender": AnoonGenderSelect,
  "auth-profile-setup": AnoonProfileSetup,
  home: AnoonHome,
  searching: AnoonSearching,
  "anon-chat": AnoonAnonChat,
  "private-chat": AnoonPrivateChat,
  chats: ChatsScreen,
  friends: AnoonFriends,
  "friend-search": AnoonFriendSearch,
  "friend-requests": AnoonFriendRequests,
  notifications: AnoonNotifications,
  profile: AnoonProfile,
  settings: AnoonSettings,
  report: ReportScreen,
  "media-viewer": AnoonMediaViewerDemo,
  "conversation-ended": ConversationEndedScreen,
  "reveal-prompt": RevealPromptScreen,
  invite: AnoonInvite,
  install: AnoonInstall,
  offline: AnoonOffline,
  banned: AnoonBanned,
  muted: AnoonMuted,
};

/**
 * Sub-screens that have no back affordance of their own → shell adds a top bar
 * carrying ONLY the back chevron. Both screens print their own `<h1>`
 * («Найти друга» / «Заявки в друзья»), so the shell must not print a title of
 * its own — that rendered the heading twice, one above the other.
 */
const NEEDS_TOP_BAR: Partial<Record<AnoonRoute, true>> = {
  "friend-search": true,
  "friend-requests": true,
};

/**
 * Desktop only (≥1024px): which routes show the navigation rail, and which tab
 * it highlights while they are open. See docs/DESKTOP-LAYOUT.md.
 *
 * The set is deliberately wider than the phone's bottom bar (which only the 5
 * tab screens draw): on a desktop the rail must not disappear under a pushed
 * sub-screen — «Настройки» or «Заявки» sliding in should not make the whole
 * layout jump left. It is deliberately NARROWER than "everything": routes left
 * out are the ones where a stray tab click would abandon live state or a flow
 * the user has to finish — onboarding/auth, `searching` and `anon-chat` (leaving
 * a match has to go through leaveQueue/closeAnon, see the back-overlay below),
 * the moderation/terminal screens, and the modal-style routes.
 */
const SIDE_NAV_TAB: Partial<Record<AnoonRoute, AnoonTab>> = {
  chats: "chats",
  "private-chat": "chats",
  friends: "friends",
  "friend-search": "friends",
  "friend-requests": "friends",
  home: "home",
  notifications: "notifications",
  profile: "profile",
  settings: "profile",
  invite: "profile",
  install: "profile",
};

/**
 * Desktop only: routes that get the FULL work area instead of the centred
 * `--anoon-content-max` column — for layouts that genuinely use the width
 * (e.g. a future list+conversation two-pane «Чаты»). Empty today: every screen
 * is still a phone layout, and clamping is the safer default. A screen cannot
 * opt out from the inside — the clamp is on its parent — so widening one is a
 * one-line entry here.
 */
const WIDE_ROUTES: Partial<Record<AnoonRoute, true>> = {};

/**
 * Viewport-fit for the fixed 390x844 phone frame. Same technique as the
 * showcase's own PhoneFrame (`app/page.tsx`) — a breakpoint-driven transform
 * scale — extended to fit BOTH axes: `--anoon-fw` is the largest scale the
 * viewport WIDTH allows, `--anoon-fh` the largest its HEIGHT allows, and the
 * frame uses `min()` of the two. Steps are cut so that `frame * scale + 16px`
 * (the page wrapper's `p-2`) never exceeds the viewport on either axis.
 *
 * The outer `.anoon-frame-fit` box reserves the SCALED footprint (a transform
 * doesn't affect layout, so without it a centred flex parent would clip the
 * top of the frame); the inner `.anoon-frame-scale` keeps the untouched
 * 390x844 coordinate system every screen lays out against.
 *
 * All of this is PHONE-ONLY. From 1024px up, globals.css cancels the scale and
 * the fixed box (`.anoon-desktop .anoon-frame-fit`) so the same markup fills the
 * viewport instead — that is the single desktop breakpoint, don't add another.
 */
const FRAME_FIT_CSS = `
.anoon-frame-fit {
  --anoon-fw: 0.65;
  --anoon-fh: 0.45;
  --anoon-fs: min(var(--anoon-fw), var(--anoon-fh));
  flex-shrink: 0;
  width: calc(390px * var(--anoon-fs));
  height: calc(844px * var(--anoon-fs));
}
.anoon-frame-scale {
  width: 390px;
  height: 844px;
  transform: scale(var(--anoon-fs));
  transform-origin: top left;
}
@media (min-width: 289px) { .anoon-frame-fit { --anoon-fw: 0.7; } }
@media (min-width: 309px) { .anoon-frame-fit { --anoon-fw: 0.75; } }
@media (min-width: 328px) { .anoon-frame-fit { --anoon-fw: 0.8; } }
@media (min-width: 348px) { .anoon-frame-fit { --anoon-fw: 0.85; } }
@media (min-width: 367px) { .anoon-frame-fit { --anoon-fw: 0.9; } }
@media (min-width: 387px) { .anoon-frame-fit { --anoon-fw: 0.95; } }
@media (min-width: 406px) { .anoon-frame-fit { --anoon-fw: 1; } }
@media (min-height: 438px) { .anoon-frame-fit { --anoon-fh: 0.5; } }
@media (min-height: 481px) { .anoon-frame-fit { --anoon-fh: 0.55; } }
@media (min-height: 523px) { .anoon-frame-fit { --anoon-fh: 0.6; } }
@media (min-height: 565px) { .anoon-frame-fit { --anoon-fh: 0.65; } }
@media (min-height: 607px) { .anoon-frame-fit { --anoon-fh: 0.7; } }
@media (min-height: 649px) { .anoon-frame-fit { --anoon-fh: 0.75; } }
@media (min-height: 692px) { .anoon-frame-fit { --anoon-fh: 0.8; } }
@media (min-height: 734px) { .anoon-frame-fit { --anoon-fh: 0.85; } }
@media (min-height: 776px) { .anoon-frame-fit { --anoon-fh: 0.9; } }
@media (min-height: 818px) { .anoon-frame-fit { --anoon-fh: 0.95; } }
@media (min-height: 860px) { .anoon-frame-fit { --anoon-fh: 1; } }
`;

/**
 * The app shell: dark scope + the self-scaling 390x844 bezel below `lg`, and
 * the same box full-bleed from `lg` up (bezel, notch and shadow all drop away —
 * a desktop app is not a phone in a frame).
 *
 * `anoon-desktop` is the scope hook every desktop rule in globals.css hangs off.
 * It sits here and nowhere else, which is what keeps the showcase's own fixed
 * phone frames on the phone branch at any window width.
 *
 * Plain `lg:` utilities are fine INSIDE this file (nothing here is reused by the
 * showcase); shared components under `_shared.tsx` must use the class scope.
 */
function PhoneFrame({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="anoon-desktop dark">
      <style>{FRAME_FIT_CSS}</style>
      <div className="anoon-frame-fit mx-auto">
        <div className="anoon-frame-scale">
          <div
            className={`relative flex h-[844px] w-[390px] flex-col overflow-hidden rounded-[44px] border-[10px] border-neutral-800 bg-background text-foreground shadow-2xl lg:h-full lg:w-full lg:rounded-none lg:border-0 lg:shadow-none ${className}`}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Enter animation per navigation verb, so a push and a pop no longer look
 * identical: forward moves come in from the right, back from the left, and a
 * lateral `go` (tab switch / stack reset) keeps the plain cross-fade. There is
 * deliberately no exit animation — the outgoing screen unmounts on the same
 * frame, which at 250ms and a 2rem offset reads as a direction, not a gap.
 * `motion-reduce:animate-none` is required on the tw-animate-css classes:
 * unlike `.anoon-screen-in` (guarded in globals.css) they are not auto-gated.
 */
const SCREEN_ANIM: Record<AnoonNavVerb, string> = {
  push: "animate-in slide-in-from-right-8 fade-in-0 duration-250 ease-out motion-reduce:animate-none",
  back: "animate-in slide-in-from-left-8 fade-in-0 duration-250 ease-out motion-reduce:animate-none",
  go: "anoon-screen-in",
};

export default function AnoonApp() {
  // Simple screen-stack router: the last entry is the current route.
  const [stack, setStack] = useState<AnoonRoute[]>(["onboarding"]);
  const current = stack[stack.length - 1];

  // Direction of the last navigation, read during the render that navigation
  // itself triggers. A ref rather than state: the verb is only ever consumed
  // alongside a stack change, so storing it must not cost an extra render.
  const navVerb = useRef<AnoonNavVerb>("go");

  const push = useCallback((route: AnoonRoute) => {
    navVerb.current = "push";
    setStack((s) => [...s, route]);
  }, []);

  const back = useCallback(() => {
    setStack((s) => {
      // Only record the verb when the pop really happens: a no-op back at the
      // root bails out of the state update, and a stale "back" would make the
      // next unrelated re-render replay the slide on the screen already shown.
      if (s.length <= 1) return s;
      navVerb.current = "back";
      return s.slice(0, -1);
    });
  }, []);

  const go = useCallback((route: AnoonRoute) => {
    // Jump to a top-level route, clearing history (used by tabs + terminal jumps).
    navVerb.current = "go";
    setStack([route]);
  }, []);

  const nav = useMemo<AnoonNavApi>(() => ({ push, back, go }), [push, back, go]);

  // Session restore on boot (BUG-44): a page reload drops the in-memory Tinode
  // token → onboarding. If a token was persisted, silently re-login and jump
  // straight to Чаты. `booting` starts true ONLY when a stored session exists,
  // so first-time visitors go straight to onboarding with no splash flash.
  const restoreSession = useAnoonStore((s) => s.restoreSession);
  const [booting, setBooting] = useState(() => USE_TINODE && hasPersistedSession());
  useEffect(() => {
    if (!booting) return;
    let cancelled = false;
    void (async () => {
      const ok = await restoreSession().catch(() => false);
      if (cancelled) return;
      if (ok) go("chats");
      setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global connectivity banner: shows AnoonOffline over whatever screen is
  // active while the browser reports it's offline. Effect-only so SSR never
  // touches `navigator`.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setOffline(!navigator.onLine);
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Real mode only: open the companion event stream (matched / reveal / friend
  // events). Browser-only via effect, so SSR never opens a socket.
  const startCompanionEvents = useAnoonStore((s) => s.startCompanionEvents);
  const stopCompanionEvents = useAnoonStore((s) => s.stopCompanionEvents);
  const closeAnon = useAnoonStore((s) => s.closeAnon);
  useEffect(() => {
    if (!USE_TINODE) return;
    startCompanionEvents();
    return () => stopCompanionEvents();
  }, [startCompanionEvents, stopCompanionEvents]);

  // Global call overlay: one `onCall` listener for the whole app (mirrors the
  // companion-events effect above — same USE_TINODE/session gate). CallScreen
  // and IncomingCall are prop-driven and mounted below whenever `call` says
  // so; each also owns its own signaling for frames tied to its own callId
  // (offer/answer/ICE/hangup once a call is under way — see CallScreen). This
  // listener only has to cover the gaps where nothing is mounted yet: a fresh
  // incoming offer, and a remote hangup/unavailable that arrives while the
  // callee is still on the ringing screen (which has no signaling of its own).
  const call = useCallStore((s) => s.call);
  const friends = useAnoonStore((s) => s.friends);
  const [callToast, setCallToast] = useState<string | null>(null);
  useEffect(() => {
    if (!callToast) return;
    const t = window.setTimeout(() => setCallToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [callToast]);

  // The one place a refused backend call becomes visible. Lives here rather
  // than on each screen because the screens that most need it (friend search,
  // requests, blacklist) have no error UI of their own, which is exactly why
  // those refusals used to be drawn as successes. Longer-lived than the call
  // toast: this one reports that something the user asked for did not happen.
  const uiError = useAnoonStore((s) => s.uiError);
  const dismissError = useAnoonStore((s) => s.dismissError);
  useEffect(() => {
    if (!uiError) return;
    const t = window.setTimeout(dismissError, 5000);
    return () => window.clearTimeout(t);
  }, [uiError, dismissError]);
  useEffect(() => {
    if (!USE_TINODE) return;
    return onCall((frame) => {
      const active = useCallStore.getState().call;
      if (frame.type === "call:offer") {
        if (active && active.status !== "ended") {
          // Already on a call — decline the new one as busy rather than
          // silently dropping it (peer sees a normal hangup, not a hang).
          if (frame.from) {
            sendCall({ type: "call:hangup", to: frame.from, callId: frame.callId, reason: "busy" });
          }
          return;
        }
        // `from` is server-stamped: a real #ID from a friend, or a per-match
        // anon alias from a roulette peer. The friends lookup misses on an
        // alias by design — an anonymous caller has no name to show.
        //
        // The fallback is a bare «Собеседник» and not `Собеседник ${from}`:
        // IncomingCall renders the handle on its own line directly underneath
        // this one, so interpolating it here printed it twice («Собеседник
        // ~K7X2QM» above «~K7X2QM»). This also matches what the caller's own
        // side already shows (AnoonAnonChat passes headerName, which is plain
        // «Собеседник» until a reveal).
        const from = frame.from ?? "";
        const peerName = friends.find((f) => f.hashId === from)?.displayName ?? "Собеседник";
        useCallStore.getState().receiveIncoming({
          status: "incoming",
          peerHashId: from,
          peerName,
          callId: frame.callId,
          media: (frame.media as CallMedia | undefined) ?? "audio",
          incomingOffer: frame.sdp as RTCSessionDescriptionInit | undefined,
        });
      } else if (frame.type === "call:hangup" || frame.type === "call:unavailable") {
        if (!active || active.callId !== frame.callId) return;
        // Once "active"/"outgoing", CallScreen is mounted and owns its own
        // teardown for these frame types — only the ringing ("incoming")
        // screen and the pre-answer caller state have nothing else watching.
        if (active.status === "incoming" || frame.type === "call:unavailable") {
          if (frame.type === "call:unavailable") setCallToast("Собеседник недоступен");
          useCallStore.getState().endCall();
        }
      }
    });
  }, [friends]);

  const acceptIncoming = useCallback(() => {
    stopRing();
    useCallStore.getState().setActive();
  }, []);
  const declineIncoming = useCallback(() => {
    stopRing();
    if (call) {
      sendCall({ type: "call:hangup", to: call.peerHashId, callId: call.callId, reason: "declined" });
    }
    useCallStore.getState().endCall();
  }, [call]);
  const endCall = useCallback(() => {
    stopRing();
    useCallStore.getState().endCall();
  }, []);

  // Ring for as long as (and only while) a call is "incoming" — the effect
  // cleanup fires stopRing() the instant status leaves "incoming" (accept →
  // "active", decline/hangup/unavailable → cleared), so every teardown path
  // is covered even the ones this component doesn't drive itself (e.g. the
  // onCall listener above ending the call remotely). The explicit stopRing()
  // calls in accept/decline/endCall above are belt-and-braces for the same
  // render tick, not a substitute for this.
  const callStatus = call?.status;
  useEffect(() => {
    if (callStatus !== "incoming") return;
    startRing();
    return () => stopRing();
  }, [callStatus]);
  // Extra safety net: stop on unmount no matter what (e.g. route away from
  // the whole app shell mid-ring — shouldn't happen, but no leaked ring).
  useEffect(() => () => stopRing(), []);

  // Real-time friend-request beep (Wave-2 #103): a direct second listener on
  // the companion event socket — `onEvent` fans out to every subscriber, so
  // this rides alongside (not instead of) the one slices.ts registers via
  // `startCompanionEvents` for the actual friends-list state update. Kept
  // separate rather than reactively diffing `requests.length` so the beep
  // fires the instant the event lands, not on the next render after it.
  useEffect(() => {
    if (!USE_TINODE) return;
    return getCompanionClient().onEvent((e) => {
      if (e.type === "friend_request") notifyOnce("request");
    });
  }, []);

  // New-message beep: unlike friend requests, incoming chat messages don't
  // ride the companion event socket at all (they arrive over each Tinode
  // topic subscription, owned by slices.ts's openChat/anon-chat wiring), so
  // there's no event to tap directly here. Reactive diffing against the
  // store's message arrays is the least-coupled way to still catch them:
  // a length increase whose newest message isn't `mine` is a genuine
  // incoming message, and skipping it while that chat is the active screen
  // avoids beeping at a bubble already on screen.
  const chatMessages = useAnoonStore((s) => s.chatMessages);
  const anonMessages = useAnoonStore((s) => s.messages);
  const prevChatLen = useRef(chatMessages.length);
  const prevAnonLen = useRef(anonMessages.length);

  useEffect(() => {
    const last = chatMessages[chatMessages.length - 1];
    if (chatMessages.length > prevChatLen.current && last && !last.mine && current !== "private-chat") {
      notifyOnce("message");
    }
    prevChatLen.current = chatMessages.length;
  }, [chatMessages, current]);

  useEffect(() => {
    const last = anonMessages[anonMessages.length - 1];
    if (anonMessages.length > prevAnonLen.current && last && !last.mine && current !== "anon-chat") {
      notifyOnce("message");
    }
    prevAnonLen.current = anonMessages.length;
  }, [anonMessages, current]);

  // Global fullscreen media viewer (lightbox): mounted once here, gated on the
  // store's `open` flag exactly like the call overlay below. Chat screens fill
  // the store via `openViewer(items, index)`; mounting only while open means the
  // viewer initialises fresh from the tapped index each session (BUG-10).
  const mediaViewerOpen = useMediaViewerStore((s) => s.open);

  const Screen = SCREENS[current];
  const needsTopBar = NEEDS_TOP_BAR[current];

  // Desktop rail (≥1024px). Its badges are derived here, from the same store
  // fields the phone screens read, because the rail outlives any one screen —
  // on the phone each tab screen hands its own numbers to AnoonBottomNav, and
  // there is no such screen behind «Настройки» or «Заявки».
  const unreadCount = useAnoonStore((s) => s.unreadCount);
  const requests = useAnoonStore((s) => s.requests);
  const sideTab = SIDE_NAV_TAB[current];
  /** Desktop content clamp — empty for routes that asked for the full width. */
  const clampCls = WIDE_ROUTES[current] ? "" : "lg:max-w-[var(--anoon-content-max)]";
  const sideBadges = useMemo(
    () => ({
      chats: friends.reduce((sum, f) => sum + (f.unread ?? 0), 0),
      friends: requests.filter((r) => r.direction === "incoming").length,
      notifications: unreadCount,
    }),
    [friends, requests, unreadCount],
  );

  // Splash while a persisted session is being restored (BUG-44) — keeps the
  // onboarding screen from flashing before the silent re-login lands.
  if (booting) {
    return (
      <PhoneFrame className="items-center justify-center">
        <div className="animate-in fade-in-0 duration-500 motion-reduce:animate-none text-3xl font-bold text-primary">
          anoon
        </div>
      </PhoneFrame>
    );
  }

  return (
    <AnoonNavContext.Provider value={nav}>
      <PhoneFrame>
        {/* Notch — decorative, part of the phone bezel only */}
        <div className="pointer-events-none absolute left-1/2 top-0 z-20 h-6 w-36 -translate-x-1/2 rounded-b-2xl bg-neutral-800 lg:hidden" />
        {/* Phone: one column. Desktop: nav rail + work area, side by side. */}
        <div className="flex h-full flex-col lg:flex-row">
          {sideTab && <AnoonSideNav active={sideTab} badges={sideBadges} />}
          {/* `min-w-0` so a wide child (chat bubbles, long handles) can't push
              the flex row past the viewport and give the rail a scrollbar. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Status bar spacer — clears the decorative notch */}
            <div className="h-7 shrink-0 bg-background lg:hidden" />
            {/* Shell-provided back bar for sub-screens without their own. The
                hairline runs the full work area; the chevron inside sits on the
                same clamp as the content, so on desktop it lines up with the
                screen's own heading instead of floating off to the left. */}
            {needsTopBar && (
              <div className="shrink-0 border-b border-border bg-background">
                <div className={`mx-auto flex h-11 w-full items-center gap-1 px-2 ${clampCls}`}>
                  <button
                    type="button"
                    onClick={back}
                    aria-label="Назад"
                    className="grid size-9 place-items-center rounded-full text-foreground transition-transform active:scale-95"
                  >
                    <ChevronLeftIcon className="size-6" />
                  </button>
                </div>
              </div>
            )}

            {/*
              The work area, and on desktop the content clamp: screens AND every
              shell overlay below live inside it, so a floating button or a
              banner still lands next to the content it belongs to instead of at
              the far edge of a 4K monitor. Below `lg` this is exactly the old
              full-width box.
            */}
            <div className={`relative mx-auto min-h-0 w-full min-w-0 flex-1 ${clampCls}`}>
              <div
                key={current}
                className={`${SCREEN_ANIM[navVerb.current]} anoon-noscroll flex h-full flex-col overflow-x-hidden`}
              >
                <Screen />
              </div>

              {/*
                Anonymous chat: an invisible hit target sitting exactly on the
                screen's own back chevron. NOT redundant with that chevron —
                it deliberately overrides where "back" goes. The screen's own
                handler calls nav.back(), which pops to "searching" (anon-chat
                is pushed from there, AnoonSearching.tsx:29/35) and that screen
                immediately re-pushes anon-chat on its match state — a loop the
                user can't escape. Leaving the match has to be go("home").
                Sized to the header's own 44x44 box so it no longer clips the
                left edge of the peer avatar (which starts at x=46).

                This is also why `anon-chat` has no desktop nav rail (see
                SIDE_NAV_TAB): every way out of a match has to pass through
                closeAnon(), and a rail tab would be a way out that doesn't.
              */}
              {current === "anon-chat" && (
                <button
                  type="button"
                  onClick={() => {
                    // The real "leave the match" point — closeAnon() is no
                    // longer tied to AnoonAnonChat's own unmount (see its
                    // comment) so it must fire explicitly here.
                    closeAnon();
                    go("home");
                  }}
                  aria-label="Назад"
                  className="absolute left-0 top-0 z-30 size-11"
                />
              )}

              {/* Friends: floating entry to the friend-requests screen.
                  `bottom-[72px]` clears the 57px bottom nav — at bottom-16 the
                  pill's lower edge sat 7px above it and read as overlapping.
                  On desktop that bar is gone (it's a rail), so the pill drops
                  back down to the normal corner inset. */}
              {current === "friends" && (
                <button
                  type="button"
                  onClick={() => push("friend-requests")}
                  className="absolute bottom-[72px] right-4 z-30 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg transition-transform active:scale-95 lg:bottom-4"
                >
                  Заявки
                </button>
              )}

              {/* Global connectivity banner — overlays whatever screen is active. */}
              {offline && (
                <div className="absolute inset-0 z-40">
                  <AnoonOffline />
                </div>
              )}

              {/* Global call overlay — ringing / outgoing / in-call, above everything else. */}
              {call?.status === "incoming" && (
                <IncomingCall
                  peerName={call.peerName}
                  peerId={call.peerHashId}
                  media={call.media}
                  onAccept={acceptIncoming}
                  onDecline={declineIncoming}
                />
              )}
              {(call?.status === "outgoing" || call?.status === "active") && (
                <CallScreen
                  key={call.callId}
                  callId={call.callId}
                  peerId={call.peerHashId}
                  peerName={call.peerName}
                  media={call.media}
                  role={call.incomingOffer ? "callee" : "caller"}
                  initialOffer={call.incomingOffer}
                  onEnded={endCall}
                />
              )}
              {callToast && (
                <div className="pointer-events-none absolute inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-50 flex justify-center">
                  <div className="rounded-full bg-black/80 px-4 py-2 text-center text-xs text-white shadow-lg">
                    {callToast}
                  </div>
                </div>
              )}
              {uiError && (
                <div
                  role="alert"
                  className="absolute inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-50 flex justify-center px-4"
                >
                  <button
                    type="button"
                    onClick={dismissError}
                    className="max-w-full cursor-pointer rounded-2xl bg-destructive px-4 py-2.5 text-center text-xs font-medium text-white shadow-lg transition-transform active:scale-95"
                  >
                    {uiError}
                  </button>
                </div>
              )}

              {/* Global fullscreen media viewer — real chat media, above all screens. */}
              {mediaViewerOpen && <AnoonMediaViewer />}
            </div>
          </div>
        </div>
      </PhoneFrame>
    </AnoonNavContext.Provider>
  );
}
