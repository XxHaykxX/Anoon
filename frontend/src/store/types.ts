/**
 * Shared types for the zustand store slices (see ./index.ts). Each slice below is
 * combined into one root store. State only — the actual network calls live in
 * `@/lib/companion` and `@/lib/tinode`; slice actions call into those clients.
 *
 * SCAFFOLD: shapes + action signatures with TODO bodies. Not wired into UI yet.
 */
import type {
  Friend,
  FriendRequest,
  Gender,
  Notification,
  RouletteMatch,
  RouletteQueueState,
  SubscriptionTier,
  TinodeMessageLite,
  User,
} from "./sliceModels";
import type { CallRecord } from "@/lib/tinode";

/** Fields the auth screens collect; the rest of {@link User} is synthesized. */
export interface BasicSignInInput {
  email: string;
  password: string;
  /** true → create a new account; false → log into an existing one. */
  isNew: boolean;
  displayName?: string;
  gender?: Gender;
  /** Self-reported age (13–120), collected at registration only. */
  age?: number;
}

/** Current signed-in user + connection status (owns the client singletons). */
export interface SessionSlice {
  user: User | null;
  /** Convenience mirror of `user.hashId` (the public #ID). */
  hashId: string | null;
  status: "signed_out" | "authenticating" | "connecting" | "ready";
  /** Last auth error (invalid creds, server down), for the auth screens. */
  authError: string | null;
  /**
   * Google ID token held between a first sign-in and the gender answer it needs.
   * Set when {@link signInWithGoogle} raises `NeedsGenderError`, cleared once the
   * retry succeeds — the gender screen picks it up from here so the login form
   * does not have to grow a second identity flow inside itself.
   */
  pendingGoogleToken: string | null;
  /** Populate user + open Tinode/companion connections. */
  signIn: (user: User, tinodeToken: string, sessionToken: string) => Promise<void>;
  /**
   * Real auth against the self-hosted Tinode server (basic scheme, no companion
   * yet). Connects, creates-or-logs-in, and synthesizes a placeholder User from
   * the uid. Throws on failure (and sets {@link authError}).
   */
  signInWithBasic: (input: BasicSignInInput) => Promise<void>;
  /**
   * Sign in with a Google ID token obtained in the browser.
   *
   * `gender` is only used on a first sign-in and companion refuses the call
   * without it, so the caller retries with one after {@link NeedsGenderError}.
   * Throws on failure (and sets {@link authError}), same as the basic path.
   */
  signInWithGoogle: (idToken: string, gender?: Gender, age?: number) => Promise<void>;
  /**
   * Restore a persisted session on app boot: re-login to Tinode with the saved
   * auth token so a page reload doesn't dump the user back on the login screen
   * (BUG-44). Resolves `true` if a session was restored, `false` otherwise.
   */
  restoreSession: () => Promise<boolean>;
  signOut: () => void;
  setUser: (user: User | null) => void;
  /**
   * Persist the editable profile fields, then mirror them into the store.
   *
   * Lives here because the two fields go to two different servers: the display
   * name is the account's Tinode `public.fn`, while the age is companion's (the
   * match queue filters on it). Both clients — web and phone — have a profile
   * screen and a settings screen that can change these, and all four used to
   * call {@link setUser} alone: memory only, so a rename reverted on the next
   * boot (the shell re-reads the name from Tinode) and the age was never stored
   * anywhere at all.
   *
   * Only the fields that actually changed are sent. Throws on failure — a save
   * that silently did nothing is the bug this replaces, so the screen has to be
   * able to say so.
   */
  saveProfile: (edits: { displayName?: string; age?: number }) => Promise<void>;
  /**
   * A refusal from the backend that the user has to see, rendered as a toast by
   * AnoonApp. Distinct from {@link authError}, which belongs to the auth screens
   * and stays on the form.
   *
   * This exists because the alternative kept producing the same bug: a call
   * fails, nobody can show it, so the screen draws a success (a friend request
   * that was never created, a friendship nobody's server has, an empty list
   * that means "we could not read yours"). Set it through `showError`, which
   * every companion catch block can reach without the screen needing its own
   * error UI.
   */
  uiError: string | null;
  showError: (message: string) => void;
  dismissError: () => void;
}

/** Confirmed friends + pending requests. Chats list is derived from friends. */
export interface FriendsSlice {
  friends: Friend[];
  requests: FriendRequest[];
  setFriends: (friends: Friend[]) => void;
  upsertFriend: (friend: Friend) => void;
  setRequests: (requests: FriendRequest[]) => void;
  addRequest: (request: FriendRequest) => void;
  removeRequest: (id: string) => void;
  /** Reflect a presence event pushed by companion. */
  setFriendOnline: (hashId: string, online: boolean) => void;
}

/**
 * Real friend 1:1 chats over Tinode (distinct from the anon roulette chat).
 * Contacts come from the `me` topic; each open chat is a p2p topic subscription.
 */
export interface ChatSlice {
  /** True once the `me`-topic subscription is live. */
  contactsReady: boolean;
  /** The friend whose chat is currently open, if any. */
  activeChat: Friend | null;
  /**
   * The friend the chat screen should open. Set by the friends list *before*
   * navigating, and read by the chat screen's mount effect to drive
   * {@link openChat}. Kept separate from {@link activeChat} (which
   * {@link closeChat} nulls on unmount) so a React StrictMode double-mount —
   * mount → cleanup(closeChat) → mount — can re-open the same target on the
   * second mount instead of landing on a null chat. Survives closeChat.
   */
  chatTarget: Friend | null;
  /** Messages in the active chat, oldest→newest. */
  chatMessages: TinodeMessageLite[];
  /** Peer is typing in the active chat (auto-clears at the call site). */
  chatPeerTyping: boolean;
  /** Live presence of the active chat peer, driven by onPres (Wave-2 #83). */
  chatPeerOnline: boolean;
  /** Human "был в сети N назад" for the active peer when offline, else null (Wave-2 #83). */
  chatPeerLastSeen: string | null;
  /** Subscribe the `me` topic → populate {@link FriendsSlice.friends} from real contacts. */
  startContacts: () => Promise<void>;
  /** Open a friend's p2p topic: subscribe, load history, stream messages/typing. */
  openChat: (friend: Friend) => Promise<void>;
  /** Stash the friend the chat screen should open on mount (see {@link chatTarget}). */
  setChatTarget: (friend: Friend | null) => void;
  /** Leave the active chat's topic and clear its state. */
  closeChat: () => void;
  /**
   * Send a text message to the active chat (optimistic, reconciled on ack).
   * Pass `reply` to quote another message (Wave-2 #85).
   */
  sendChatMessage: (text: string, reply?: { seq: number; text: string }) => Promise<void>;
  /** Emit a typing notification on the active chat. */
  notifyTyping: () => void;
  /** Add an emoji reaction to a message (by seq) in the active chat (Wave-2 #84). */
  sendChatReaction: (seq: number, emoji: string) => Promise<void>;
  /** Edit an own text message in place, by seq (Wave-2 #86). */
  editChatMessage: (seq: number, text: string) => Promise<void>;
  /** Delete a message: `hard` removes it for everyone, else only for me (Wave-2 #86). */
  deleteChatMessage: (seq: number, hard: boolean) => Promise<void>;
  /**
   * Record a finished call in the conversation with `peer`, as a message in that
   * conversation's Tinode topic (#41). `peer` is the signaling handle the call
   * used: a friend's #ID, or a per-match anon alias; the topic is resolved from
   * it here.
   *
   * It used to be a purely local system line, which meant the whole trace of a
   * call died with the tab — and the other party never saw one at all. Writing
   * it into the topic puts it where every other message already lives: both
   * sides get it, it survives a reload, and no new storage was needed for it.
   *
   * Only the side that PLACED the call writes (`rec.incoming` is false for
   * them). Both sides run this on hangup, and a topic message is seen by both,
   * so letting both write would double every record.
   */
  logCall: (peer: string, rec: CallLogRecord) => void;
}

/**
 * What {@link ChatSlice.logCall} is told about a call that just ended.
 * `incoming` is local-only — it decides who writes the record, and the reader's
 * own direction is derived from who sent the message (see `sendCallRecord`).
 */
export interface CallLogRecord extends CallRecord {
  /** True when WE were the callee. */
  incoming: boolean;
}

/**
 * Reveal progress inside an anon chat. `declined` is requester-side: the peer
 * turned our request down. It is not terminal — asking again is allowed, and
 * doing so returns the state to `none`.
 */
export type AnonRevealState = "none" | "peer_requested" | "declined" | "revealed";

/** The active anonymous roulette chat, if any. */
export interface AnonChatSlice {
  activeMatch: RouletteMatch | null;
  messages: TinodeMessageLite[];
  /** Peer is typing right now (auto-clears at call site). */
  peerTyping: boolean;
  /** Reveal handshake state for the active match. */
  anonRevealState: AnonRevealState;
  /** True after we asked to reveal and are waiting on the peer. */
  anonRevealPending: boolean;
  /**
   * How many more times the local user may ask to reveal in this match (2/1/0),
   * or null when not yet known. 0 is a SETTLED answer, not a retryable failure:
   * a further request is refused for the rest of the chat. It never blocks
   * accepting a request the peer makes, and the peer's own budget is separate.
   */
  anonRevealAsksLeft: number | null;
  /** Seqs of anon view-once photos already opened → render them as "просмотрено" (Wave-2 #88). */
  anonViewed: Record<number, true>;
  setActiveMatch: (match: RouletteMatch | null) => void;
  appendMessage: (msg: TinodeMessageLite) => void;
  setPeerTyping: (typing: boolean) => void;
  /** Open the anon chat for a match: subscribe its Tinode topic (real) or seed mock. */
  openAnonChat: (match: RouletteMatch) => Promise<void>;
  /**
   * Send a message in the anon chat (optimistic on Tinode, echo in mock).
   * Pass `reply` to quote another message (Wave-2 #85).
   */
  sendAnonMessage: (text: string, reply?: { seq: number; text: string }) => Promise<void>;
  /** Emit a typing notification on the anon topic. */
  notifyAnonTyping: () => void;
  /** Add an emoji reaction to a message (by seq) in the anon chat (Wave-2 #84). */
  sendAnonReaction: (seq: number, emoji: string) => Promise<void>;
  /** Edit an own text message in place, by seq (Wave-2 #86). */
  editAnonMessage: (seq: number, text: string) => Promise<void>;
  /** Delete a message: `hard` for everyone, else only for me (Wave-2 #86). */
  deleteAnonMessage: (seq: number, hard: boolean) => Promise<void>;
  /** Mark a view-once photo (by seq) as opened so it becomes "просмотрено" (Wave-2 #88). */
  markAnonViewed: (seq: number) => void;
  /** Ask to reveal profiles (companion `reveal`). */
  requestReveal: () => Promise<void>;
  /** Accept / decline the peer's reveal request. */
  respondReveal: (accept: boolean) => Promise<void>;
  /** Rate the peer after the conversation ends (companion `rate`). */
  rateMatch: (rating: number) => Promise<void>;
  /** End the conversation server-side + leave the topic (keeps match for rating). */
  endMatch: () => Promise<void>;
  /** Tear down the anon chat and clear its state (after rating / block). */
  closeAnon: () => void;
  /** Bridge setter: the peer asked to reveal. */
  setPeerRequestedReveal: () => void;
  /** Bridge setter: the peer declined the request we sent (topic-guarded). */
  applyRevealDeclined: (topic: string) => void;
  /**
   * Re-read the reveal handshake from `GET /roulette/status` and heal local
   * state from it. For when a reveal frame was missed while backgrounded — the
   * socket is best-effort. Never applies `revealed` (that payload carries no
   * identity); no-op in mock mode or without an active match.
   */
  resyncAnonReveal: () => Promise<void>;
  /** Bridge setter: both sides revealed → flip to a friend chat. */
  applyRevealed: (peerHashId: string, peerDisplayName: string) => void;
  /**
   * Record that `seq` in the active anon topic is one of OUR messages, and
   * persist it. An anon topic blanks `from` on every message it delivers, live
   * and in history, so this is the only way a restored chat can tell our own
   * bubbles from the peer's. Called by the send paths — and by `logCall`, which
   * publishes into the same topic from outside this slice.
   */
  rememberOwnAnonSeq: (seq: number) => void;
}

/** Matchmaking queue state (idle / searching / matched). */
export interface RouletteSlice {
  queue: RouletteQueueState;
  setQueue: (queue: RouletteQueueState) => void;
  /** Join the queue via companion; transitions to "searching". */
  joinQueue: (prefs: { ownAgeRange: string; peerAgeRanges: string[] }) => Promise<void>;
  leaveQueue: () => Promise<void>;
  /** Register companion WS listeners + connect. Browser-only; call from an effect. */
  startCompanionEvents: () => void;
  /** Unregister companion listeners (logout / unmount). */
  stopCompanionEvents: () => void;
  /**
   * Re-open the companion event socket so it picks up a just-set session
   * token — the initial `startCompanionEvents()` call runs before login, so
   * that first socket is unauthenticated. Call right after `setSessionToken`.
   */
  reconnectCompanionEvents: () => void;
  /**
   * Re-enter the anon chat the user was in before this client (re)started, by
   * asking the companion who they are currently paired with.
   *
   * A reload or an app the OS unloaded drops the match out of memory, and
   * nothing rebuilt it: the peer stayed in the chat and only learned of the
   * "departure" through the disconnect grace window, ~20s later. The pairing
   * itself never went anywhere — it lives in `roulette_matches` and the socket
   * grace period (companion `wsDisconnectGrace`) exists precisely so a reload
   * does not end it — so all that was missing was asking.
   *
   * Only an ANON pairing is restored. A revealed pair are friends whose chat is
   * an ordinary conversation reachable from «Чаты», and their match row lingers
   * server-side after they walk away, so reopening it on every boot would drag
   * them back into a chat they already left.
   *
   * @returns true if a chat was restored — the shell navigates to it.
   */
  restoreActiveMatch: () => Promise<boolean>;
}

/** Notification center state. */
export interface NotificationsSlice {
  notifications: Notification[];
  unreadCount: number;
  setNotifications: (items: Notification[]) => void;
  addNotification: (item: Notification) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

/** Subscription tier + coin balance (money). */
export interface WalletSlice {
  tier: SubscriptionTier;
  coins: number;
  setTier: (tier: SubscriptionTier) => void;
  setCoins: (coins: number) => void;
  addCoins: (delta: number) => void;
}

/** The full app store: every slice merged. */
export type AnoonStore = SessionSlice &
  FriendsSlice &
  ChatSlice &
  AnonChatSlice &
  RouletteSlice &
  NotificationsSlice &
  WalletSlice;
