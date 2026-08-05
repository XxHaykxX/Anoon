/**
 * Re-exports of the companion contract types the store slices use, plus a couple
 * of store-local view models. Keeps `./types.ts` importing from one place.
 */
export type {
  Friend,
  FriendRequest,
  Gender,
  Notification,
  RouletteMatch,
  RouletteQueueState,
  SubscriptionTier,
  User,
} from "@/types/companion";

/** A single reaction folded onto a message (Wave-2 #84). */
export interface MessageReaction {
  /** The reaction emoji, e.g. "👍". */
  emoji: string;
  /** True if the local user added this reaction (drives the "own" highlight). */
  mine: boolean;
}

/** A lightweight chat message as rendered in the store (decoded from Tinode). */
export interface TinodeMessageLite {
  /** Local id (seq or client-generated for optimistic sends). */
  id: string;
  /** True if sent by the local user. */
  mine: boolean;
  /** Plain-text preview / body. Media handled separately later. */
  text: string;
  ts: number;
  /** Delivery state for out bubbles (Wave-2 #82 adds "delivered"). */
  status?: "sending" | "sent" | "delivered" | "read";
  /** Reactions folded onto this message from `head.reaction` frames (Wave-2 #84). */
  reactions?: MessageReaction[];
  /** The message this one quotes / replies to (Wave-2 #85). */
  replyTo?: { seq: number; text: string };
  /** True once an edit (head.replace) replaced this message's body in place (Wave-2 #86). */
  edited?: boolean;
  /** True once this message was deleted — render a "сообщение удалено" tombstone (Wave-2 #86). */
  deleted?: boolean;
  /** Anon view-once photo: shown blurred until opened, then permanently "просмотрено" (Wave-2 #88). */
  viewOnce?: boolean;
}
