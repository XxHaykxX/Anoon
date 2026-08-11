"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChatIcon, ChevronLeftIcon } from "@/components/icons";
import { getTinodeClient, USE_TINODE } from "@/lib/tinode";
import { useAnoonStore } from "@/store";
import { hasPersistedSession } from "@/store/slices";
import { useCallStore, type CallEndReason, type CallMedia } from "@/store/callStore";
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
 * Is the app running on the desktop branch (≥1024px)? A JS media query, not a
 * CSS one, because the two-pane «Чаты» below is a different TREE, not different
 * styling — CSS can't mount a second component.
 *
 * It lives here, in AnoonApp, and the answer is handed to screens as a PROP:
 * the showcase (`src/app/page.tsx`) renders those same screens inside fixed
 * 390px frames on a wide monitor, where a media query of their own would answer
 * "desktop" and give a phone frame two panes. See docs/DESKTOP-LAYOUT.md.
 *
 * Starts false so SSR and first paint are the phone tree; the effect corrects it
 * before anything is interactive.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return isDesktop;
}

/**
 * «Чаты» (BUG-36) — active conversations only, the post-login landing
 * screen. Reuses AnoonFriends' rendering with `mode="chats"`; the "friends"
 * route below renders the same component with the (default) full-list mode.
 *
 * Desktop (#34): the same list becomes the left pane of a Telegram-style
 * two-pane layout, with the conversation on the right. The selection is local
 * state here rather than a route, which is what keeps the rail, the list and
 * the thread all on screen at once — pushing "private-chat" would replace the
 * whole work area. `key={selectedId}` remounts the thread per peer, so
 * AnoonPrivateChat's own openChat/closeChat effect tears the previous
 * subscription down before opening the next one.
 */
function ChatsScreen() {
  const desktop = useIsDesktop();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!desktop) return <AnoonFriends mode="chats" />;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[22rem] min-h-0 shrink-0 flex-col border-r border-border">
        <AnoonFriends mode="chats" selectedId={selectedId} onOpen={setSelectedId} />
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        {selectedId ? (
          <AnoonPrivateChat key={selectedId} onBack={() => setSelectedId(null)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-muted">
              <ChatIcon className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">Выберите чат, чтобы начать переписку</p>
          </div>
        )}
      </div>
    </div>
  );
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
  // «Установить» is reached from the roulette header (AnoonHome), not from the
  // profile — highlighting «Профиль» told the user they were somewhere they
  // had not been.
  install: "home",
};

/**
 * Desktop only: routes that get the FULL work area instead of the centred
 * `--anoon-content-max` column — for layouts that genuinely use the width.
 * Every other screen is still a phone layout, where clamping is the safer
 * default. A screen cannot opt out from the inside — the clamp is on its parent
 * — so widening one is a one-line entry here.
 *
 * «Чаты» (#34) is the two-pane list+conversation layout: 60rem would leave the
 * thread barely wider than the list beside it.
 */
const WIDE_ROUTES: Partial<Record<AnoonRoute, true>> = { chats: true };

/**
 * The app shell: the dark scope plus the box every screen lays out inside.
 *
 * There used to be a drawn phone here — a fixed 390x844 bezel with a rounded
 * border, scaled to fit by a ladder of width/height breakpoints, dropped only
 * from `lg` up. It was backwards in both directions: a real phone (which is
 * below `lg`) got a picture of a phone drawn around the phone in the user's
 * hand, losing a gutter on all four sides and shrinking the layout below its
 * own design size, while a desktop window narrower than 1024px got the same
 * treatment and read as "the site opens as mobile". The app now fills whatever
 * viewport it is given; the framed previews live in /showcase, which is what
 * that page is for.
 *
 * `100dvh`, not `100%`: the parent carries only a min-height, which is not a
 * definite height for a percentage to resolve against, and dvh follows the
 * browser chrome as it collapses on scroll. The top safe-area inset is what
 * keeps content off the notch now that the bezel is gone; the bottom one is
 * already handled by the nav and the sheets that sit on it.
 *
 * `anoon-desktop` is the scope hook every desktop rule in globals.css hangs off.
 * It sits here and nowhere else, which is what keeps the showcase's own fixed
 * phone frames on the phone branch at any window width.
 *
 * Plain `lg:` utilities are fine INSIDE this file (nothing here is reused by the
 * showcase); shared components under `_shared.tsx` must use the class scope.
 */
function AppShell({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="anoon-desktop dark h-dvh w-full">
      <div
        className={`anoon-shell relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground ${className}`}
      >
        {children}
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
  // …and if that session was in the middle of an anonymous chat, go back INTO
  // it rather than to Чаты. The pairing outlives the reload server-side (the
  // socket has a grace period for exactly this), so the peer is still sitting
  // there — see `restoreActiveMatch`.
  const restoreActiveMatch = useAnoonStore((s) => s.restoreActiveMatch);
  // Starts true for EVERYONE, including the server render. Reading
  // `hasPersistedSession()` in the initialiser instead — as this did — makes the
  // first client render disagree with the server one for anybody who is logged
  // in (the server has no localStorage, so it renders onboarding while the
  // browser renders the splash), and React reports that as a hydration text
  // mismatch: `Minified React error #418`, twice per load, on every reload.
  // The splash is the one screen both sides can agree on before the browser has
  // been consulted, so the decision moves into the effect below.
  const [booting, setBooting] = useState(true);
  useEffect(() => {
    let cancelled = false;
    if (!USE_TINODE || !hasPersistedSession()) {
      setBooting(false);
      return;
    }
    void (async () => {
      const ok = await restoreSession().catch(() => false);
      if (cancelled) return;
      if (!ok) {
        setBooting(false);
        return;
      }
      go("chats");
      // The splash comes down HERE, before asking about an anonymous match, and
      // not after. That question is a companion round-trip on every single
      // reload — including the overwhelming majority who were never in a
      // roulette chat — and holding the splash for it meant one slow or wedged
      // request left the app on a spinner with no way out. It cost a real
      // reload test 60s of waiting for a nav bar that never rendered.
      //
      // The trade is a brief «Чаты» before the redirect lands for whoever WAS
      // mid-chat. That is the right way round: the app is usable while the
      // answer is in flight, instead of everyone waiting for an answer that is
      // almost always "no".
      setBooting(false);
      const inChat = await restoreActiveMatch().catch(() => false);
      if (cancelled) return;
      if (inChat) go("anon-chat");
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adopt the name the account carries in Tinode (`me.public.fn`) when the
  // store still holds the "no name known" placeholder. That is the Google case:
  // companion seeds `fn` + `photo` from the ID token when it creates the account
  // (googleAccountPublic), but the store's User is built from companion's /me,
  // which only knows the #ID — so an otherwise complete profile rendered as
  // «Аноним» everywhere. The me-topic is subscribed a beat after login reports
  // ready, hence the short poll (same shape as the peer-avatar poll in
  // AnoonAnonChat). Runs ONLY against the placeholder, so a name the user typed
  // themselves is never overwritten.
  const profileUser = useAnoonStore((s) => s.user);
  const setUser = useAnoonStore((s) => s.setUser);
  const nameUnknown = USE_TINODE && profileUser?.displayName === "Аноним";
  useEffect(() => {
    if (!nameUnknown) return;
    let tries = 0;
    const adopt = () => {
      const fn = getTinodeClient().myDisplayName();
      if (!fn) return false;
      const u = useAnoonStore.getState().user;
      if (u) setUser({ ...u, displayName: fn });
      return true;
    };
    if (adopt()) return;
    const iv = window.setInterval(() => {
      if (adopt() || ++tries > 6) window.clearInterval(iv);
    }, 500);
    return () => window.clearInterval(iv);
  }, [nameUnknown, setUser]);

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
          // Ringing screen: the caller gave up before we answered, so this side
          // records a missed call (the caller's own side records «отменён»).
          useCallStore.getState().endCall(frame.type === "call:unavailable" ? "unavailable" : "missed");
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
    useCallStore.getState().endCall("declined");
  }, [call]);
  const endCall = useCallback((reason?: CallEndReason) => {
    stopRing();
    useCallStore.getState().endCall(reason);
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
      <AppShell className="items-center justify-center">
        <div className="animate-in fade-in-0 duration-500 motion-reduce:animate-none text-3xl font-bold text-primary">
          anoon
        </div>
      </AppShell>
    );
  }

  return (
    <AnoonNavContext.Provider value={nav}>
      <AppShell>
        {/* Phone: one column. Desktop: nav rail + work area, side by side. */}
        <div className="flex h-full flex-col lg:flex-row">
          {sideTab && <AnoonSideNav active={sideTab} badges={sideBadges} />}
          {/* `min-w-0` so a wide child (chat bubbles, long handles) can't push
              the flex row past the viewport and give the rail a scrollbar. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                  {/* «Повторить» probes the network itself; when it comes back
                      the banner has to go, and only the shell owns that flag —
                      the browser's `online` event can lag behind a link that
                      already carries traffic again. */}
                  <AnoonOffline onOnline={() => setOffline(false)} />
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
      </AppShell>
    </AnoonNavContext.Provider>
  );
}
