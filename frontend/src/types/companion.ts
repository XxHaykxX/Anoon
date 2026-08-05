/**
 * Types matching the companion service contract (see ../../anoon/BUILD-PLAN.md
 * and COMPANION-PLAN.md). The companion service (Go) owns login/OAuth, roulette
 * matchmaking, friends, reports, money and realtime anoon events. Tinode owns the
 * actual chat transport.
 *
 * These are hand-written stubs for the scaffold — keep them in sync with the real
 * Go/JSON contract once the companion API lands (Phase A3+).
 */

/** Gender as collected on the anoon gender-select screen. */
export type Gender = "male" | "female";

/** Paid tiers. Free users have `null`/"free"; paid tiers get roulette queue priority. */
export type SubscriptionTier = "free" | "premium" | "super_premium";

/** Ban / mute moderation state on an account. */
export type ModerationState = "ok" | "muted" | "banned";

/**
 * The signed-in user. `hashId` is the public **#ID** used for friend search and
 * sharing; `tinodeUid` / `tinodeToken` are what we hand to the Tinode SDK.
 */
export interface User {
  /** Companion-side stable user id (opaque). */
  id: string;
  /** Public shareable identifier shown as "#ID" in the UI. */
  hashId: string;
  /** Display name (only revealed to friends / after profile reveal). */
  displayName: string;
  gender: Gender;
  /** Age in years; collected at onboarding, used for matching. */
  age: number;
  /** Avatar tone index into AVATAR_GRADIENTS (no photos, per brand). */
  avatarTone: number;
  subscription: SubscriptionTier;
  /** Spendable in-app coins balance. */
  coins: number;
  moderation: ModerationState;
  /** Tinode account uid ("usrXXXX"), present once provisioned. */
  tinodeUid?: string;
  /** Short-lived Tinode auth token issued by companion after login. */
  tinodeToken?: string;
}

/** A confirmed friend (mutual). Chat happens over Tinode on `topic`. */
export interface Friend {
  /** Companion user id of the friend. */
  id: string;
  hashId: string;
  displayName: string;
  avatarTone: number;
  /** Presence, driven by companion events (Tinode presence is a fallback). */
  online: boolean;
  /** Tinode p2p topic name for the private chat with this friend. */
  topic?: string;
  /** Unix ms of last activity, for sorting the friends/chats list. */
  lastActiveAt?: number;
  /** Unread message count for this friend's private chat (Tinode seq - read). Wave-2 #93. */
  unread?: number;
  /** Preview text of the last message in the chat. Wave-2 #93. */
  lastMessage?: string;
  /** Human "был N назад" string derived from lastActiveAt when offline. Wave-2 #83/#93. */
  lastSeen?: string;
}

/** An incoming or outgoing friend request. */
export interface FriendRequest {
  id: string;
  /** The other party. */
  hashId: string;
  displayName: string;
  avatarTone: number;
  direction: "incoming" | "outgoing";
  createdAt: number;
}

/** Result of a friend search by #ID. */
export interface FriendSearchResult {
  hashId: string;
  displayName: string;
  avatarTone: number;
  /**
   * Relationship with the current user, to pick the right CTA.
   *
   * `blocked` and `self` exist because both states were previously
   * unrepresentable and collapsed to `none`, so the card offered «Добавить»
   * for someone you had blocked, and for yourself — where the request then
   * failed server-side with `self_request`.
   */
  relation:
    | "none"
    | "friends"
    | "request_sent"
    | "request_received"
    | "blocked"
    | "self";
}

/**
 * A roulette match. Both peers are subscribed to the anon `topic` on Tinode; the
 * anonymity patch blanks identity until reveal. `peerHashId` becomes known only
 * after a mutual profile reveal.
 */
export interface RouletteMatch {
  /** Companion match id. */
  matchId: string;
  /** Anonymous Tinode topic both peers join. */
  topic: string;
  /** Coarse peer info allowed during the anon phase. */
  peerGender: Gender;
  peerAge?: number;
  /** Coarse peer age bucket from the match event (e.g. "22–25"). */
  peerAgeRange?: string;
  /**
   * The peer's anonymous handle for this match — shown as «Собеседник #peerHashId».
   * Known at match time; the server anonymity patch keeps the real identity hidden.
   */
  peerHashId?: string;
  /** Populated only after a mutual reveal. */
  peerDisplayName?: string;
  /** Whether the peer is currently online (companion-driven). */
  peerOnline: boolean;
  startedAt: number;
}

/** Current state of the local user in the matchmaking queue. */
export type RouletteQueueState =
  | { status: "idle" }
  | { status: "searching"; since: number; queuePosition?: number }
  | { status: "matched"; match: RouletteMatch };

/** Reason categories offered on the report screen. */
export type ReportReason =
  | "spam"
  | "harassment"
  | "nudity"
  | "underage"
  | "scam"
  | "other";

/** A moderation report filed against another user / match. */
export interface Report {
  id?: string;
  /** Reported party's hashId (or match peer). */
  targetHashId?: string;
  /** Match this report is about, if filed from an anon chat. */
  matchId?: string;
  reason: ReportReason;
  /** Free-text detail. */
  details?: string;
  createdAt?: number;
}

/** A notification item shown on the notifications screen. */
export interface Notification {
  id: string;
  kind: "friend_request" | "friend_accepted" | "revealed" | "system" | "moderation";
  title: string;
  body?: string;
  /** Related hashId, if any (e.g. who sent the request). */
  hashId?: string;
  read: boolean;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Realtime events (companion WebSocket → client) — the exact contract  */
/* the backend agent implements. JSON frames of shape `{ type, ... }`.  */
/* ------------------------------------------------------------------ */

/** A match was found: both peers join the anon Tinode `topic`. */
export interface MatchedEvent {
  type: "matched";
  /** Anonymous Tinode topic both peers subscribe to. */
  topic: string;
  /** Peer's anonymous handle for this match («Собеседник #peerHashId»). */
  peerHashId: string;
  /** Coarse peer age bucket, if the server shares it. */
  peerAgeRange?: string;
}

/** The peer asked to reveal profiles in the current anon chat. */
export interface RevealRequestEvent {
  type: "reveal_request";
  topic: string;
  /** Anonymous handle of the peer who asked to reveal. */
  fromHashId: string;
}

/** Both sides revealed → the chat becomes a normal friend chat. */
export interface RevealedEvent {
  type: "revealed";
  topic: string;
  /** The peer's now-public #ID. */
  peerHashId: string;
  /** The peer's now-visible display name. */
  peerDisplayName: string;
}

/** Someone sent the local user a friend request. */
export interface FriendRequestEvent {
  type: "friend_request";
  fromHashId: string;
  displayName: string;
}

/**
 * The #ID friend request the local user sent was accepted. Carries everything
 * needed to add the new friend live (with a working p2p chat topic) — the
 * requester never gets this otherwise and their Contacts stay empty (BUG-42).
 */
export interface FriendAcceptedEvent {
  type: "friend_accepted";
  /** The accepter's #ID (already `#`-prefixed). */
  hashId: string;
  displayName: string;
  /** p2p Tinode topic to open the chat (the accepter's uid). */
  topic: string;
  online: boolean;
}

/** Discriminated union of everything the companion WebSocket can push. */
export type CompanionEvent =
  | MatchedEvent
  | RevealRequestEvent
  | RevealedEvent
  | FriendRequestEvent
  | FriendAcceptedEvent;

/** Auth result returned by login / OAuth endpoints. */
export interface AuthResult {
  user: User;
  /** Tinode token to open the chat connection with. */
  tinodeToken: string;
  /** Companion session token (bearer) for subsequent REST calls. */
  sessionToken: string;
}
