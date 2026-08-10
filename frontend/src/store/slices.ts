/**
 * Slice creators for the anoon store. Each is a zustand `StateCreator` producing
 * one slice of {@link AnoonStore}. Combined in ./index.ts.
 *
 * SCAFFOLD: state transitions are real; network side-effects are TODOs that will
 * call into `@/lib/companion` and `@/lib/tinode`.
 */
import type { StateCreator } from "zustand";
import { CompanionHttpError, getCompanionClient, type RegisterResult } from "@/lib/companion";
import {
  buildMediaDraft,
  getTinodeClient,
  parseEditTarget,
  parseMediaParts,
  parseReaction,
  plainText,
  tinodeLoginFromEmail,
  USE_TINODE,
  type MediaKind,
  type MediaPart,
  type MeContact,
  type TinodeMessage,
  type TopicHandlers,
  type UploadedMedia,
} from "@/lib/tinode";
import { notifyOnce } from "@/lib/notify";
import type {
  Friend,
  MatchedEvent,
  RouletteMatch,
  RouletteRevealStatus,
  User,
} from "@/types/companion";
import type { TinodeMessageLite } from "./sliceModels";
import type {
  AnonChatSlice,
  AnoonStore,
  BasicSignInInput,
  ChatSlice,
  FriendsSlice,
  NotificationsSlice,
  RouletteSlice,
  SessionSlice,
  WalletSlice,
} from "./types";

// `TinodeMessageLite` (./sliceModels) and `ChatSlice`/`AnonChatSlice` (./types)
// are owned by other files this task must not edit directly — extend them here
// via declaration merging instead (same-folder relative specifiers resolve to
// the same modules, so this augments the real interfaces program-wide).
declare module "./sliceModels" {
  interface TinodeMessageLite {
    /** Attachments recovered from the message's Drafty content (empty if none). */
    media?: MediaPart[];
    /**
     * True for a locally-injected system line (not a real Tinode message) —
     * e.g. the "Собеседник покинул чат" peer-left notice (BUG-15). ChatWiring
     * renders these as a centered muted line instead of a chat bubble.
     */
    system?: boolean;
  }
}

declare module "./types" {
  interface AnonChatSlice {
    /**
     * Send a media attachment in the active anon chat (optimistic, like
     * {@link AnonChatSlice.sendAnonMessage}). Pass `opts.viewOnce` to send a
     * one-time-view photo (Wave-2 #88).
     */
    sendAnonMedia: (
      up: UploadedMedia,
      kind: MediaKind,
      extra?: { width?: number; height?: number; duration?: number },
      opts?: { viewOnce?: boolean },
    ) => Promise<void>;
  }
  interface ChatSlice {
    /**
     * Send a media attachment in the active friend chat (optimistic, like
     * {@link ChatSlice.sendChatMessage}). Pass `opts.viewOnce` to send a
     * one-time-view photo, mirroring anon chat's VO-1 (#114).
     */
    sendFriendMedia: (
      up: UploadedMedia,
      kind: MediaKind,
      extra?: { width?: number; height?: number; duration?: number },
      opts?: { viewOnce?: boolean },
    ) => Promise<void>;
    /** Seqs of friend-chat view-once photos already opened → render "просмотрено" (#114). */
    chatViewed: Record<number, true>;
    /** Mark a friend-chat view-once photo (by seq) as opened (#114). */
    markChatViewed: (seq: number) => void;
    /**
     * True once the peer left the active friend chat (BUG-15). Set when a
     * `peer:left` companion frame arrives for {@link activeChat}; a system line
     * is also injected into {@link chatMessages}. Reset on the next openChat.
     */
    chatPeerLeft?: boolean;
    /**
     * The active friend chat peer's live activity indicator (BUG-18):
     * "typing" (Tinode kp) or "media" (peer is uploading an attachment), else
     * null. Auto-clears ~4s after the last signal. ChatWiring renders the
     * "печатает…" / "отправляет медиа…" line from this.
     */
    peerActivity?: "typing" | "media" | null;
    /** Set the peer-activity indicator with a ~4s auto-clear (BUG-18). */
    setPeerActivity: (activity: "typing" | "media" | null) => void;
    /**
     * Tell the peer we're uploading media in the active friend chat (BUG-18) so
     * their side shows "отправляет медиа…". Call at upload START (ChatWiring).
     */
    notifyMediaSending: () => void;
  }
  interface AnonChatSlice {
    /**
     * True once the peer left the active anon/revealed chat (BUG-15). Set when a
     * `peer:left` companion frame arrives for {@link activeMatch}; a system line
     * is also injected into {@link messages}. Reset on the next openAnonChat.
     */
    anonPeerLeft?: boolean;
    /** Active anon peer activity indicator (BUG-18): "typing" | "media" | null. */
    anonPeerActivity?: "typing" | "media" | null;
    /** Set the anon peer-activity indicator with a ~4s auto-clear (BUG-18). */
    setAnonPeerActivity: (activity: "typing" | "media" | null) => void;
    /** Tell the peer we're uploading media in the active anon chat (BUG-18). */
    notifyAnonMediaSending: () => void;
  }
  interface RouletteSlice {
    /**
     * Ask the companion for the authoritative roulette state and apply a match
     * it reports (BUG-ROULETTE-STUCK). The `matched` event is pushed
     * best-effort — a full socket send buffer, a mid-reconnect socket, or a
     * listener attached after the frame lands all lose it, stranding this
     * client on «Ищем собеседника…» while the peer is already in the chat.
     * The searching screen polls this; it converges on the same handler as the
     * event, so a double delivery is a no-op. Never throws.
     */
    resyncRouletteMatch: () => Promise<void>;
  }
}

/**
 * Body of `GET /roulette/status` — the REST mirror of the roulette state.
 * `match` carries the exact `matched` event payload (or null when the caller is
 * not paired), so both delivery paths feed one handler.
 */
interface RouletteStatusResponse {
  queued: boolean;
  match: MatchedEvent | null;
  /** Reveal handshake state; absent when there is no match. */
  reveal?: RouletteRevealStatus;
  /**
   * How many more times the CALLER may ask to reveal in this match (2/1/0).
   * Absent — not 0 — when there is no match, so "no match" and "exhausted" stay
   * distinguishable. Answers "can I ask?"; `reveal` answers "what happened
   * last?". They diverge on purpose: a fresh request clears the refusal, so
   * right after re-asking `reveal` reads `we_requested` while this has already
   * decremented and stays decremented.
   */
  revealAsksLeft?: number;
}

/**
 * Read the caller's roulette state from the companion, or null when the call is
 * unavailable/failed (offline, mock mode, backend down) — the poller simply
 * skips that tick.
 *
 * `rouletteStatus()` lives on the companion client in `@/lib/companion`; the
 * structural lookup keeps this file compiling (and the app running, minus the
 * self-heal) whether or not that wrapper is present.
 */
async function fetchRouletteStatus(): Promise<RouletteStatusResponse | null> {
  const client = getCompanionClient() as unknown as {
    rouletteStatus?: () => Promise<RouletteStatusResponse | null>;
  };
  if (typeof client.rouletteStatus !== "function") return null;
  try {
    return await client.rouletteStatus();
  } catch {
    return null;
  }
}

type Slice<T> = StateCreator<AnoonStore, [], [], T>;

// Monotonic suffix for optimistic message ids so two sends in the same
// millisecond (e.g. a photo then a voice note fired back-to-back) can't collide
// on `t${Date.now()}` and produce duplicate React keys in the thread.
let optimisticCounter = 0;
const nextTmpId = () => `t${Date.now()}_${++optimisticCounter}`;

// Monotonic suffix for injected system-line ids (peer-left etc.), same collision
// guard as optimistic message ids — two system lines in the same ms keep unique
// React keys.
let systemCounter = 0;
/**
 * Build a locally-injected system line (contract B, BUG-15). Not a real Tinode
 * message — `mine` is false and `system` is set so ChatWiring renders it as a
 * centered muted notice rather than a bubble.
 */
function systemMsg(text: string): TinodeMessageLite {
  return {
    id: `sys${Date.now()}_${++systemCounter}`,
    mine: false,
    system: true,
    text,
    ts: Date.now(),
  };
}

/**
 * Normalize a signaling handle so «#00012» and «00012» compare equal — the call
 * layer prefixes the #ID (AnoonAnonChat) or passes `Friend.hashId` raw
 * (AnoonPrivateChat). Anon aliases start with «~» and are unaffected.
 */
const peerKey = (handle: string) => handle.replace(/^#/, "");

/** Build the optimistic-bubble `media` entry for a just-uploaded attachment. */
function mediaPartFrom(
  up: UploadedMedia,
  kind: MediaKind,
  extra?: { width?: number; height?: number; duration?: number },
): MediaPart {
  return {
    kind,
    url: up.url,
    mime: up.mime,
    name: up.name,
    size: up.size,
    width: extra?.width,
    height: extra?.height,
    duration: extra?.duration,
  };
}

/** Stable avatar tone (0–5) from a topic/uid string. */
function toneFor(key: string): number {
  return [...key].reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
}

/** Map a `me`-topic contact to the companion {@link Friend} shape the UI renders. */
function contactToFriend(c: MeContact): Friend {
  return {
    id: c.topic,
    hashId: "#" + c.topic.replace(/^usr/, ""),
    displayName: c.fn || c.topic,
    avatarTone: toneFor(c.topic),
    online: c.online,
    topic: c.topic,
    lastActiveAt: c.touched,
    unread: c.unread,
    lastSeen: c.online
      ? undefined
      : humanLastSeen(getTinodeClient().getContactLastSeen(c.topic)) ?? undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Session persistence (BUG-44): a page reload drops the in-memory     */
/* Tinode token → login screen. Persist the token + User so boot can   */
/* silently re-login via loginToken.                                   */
/* ------------------------------------------------------------------ */
const SESSION_KEY = "anoon:session";

function saveSession(token: string, user: User): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
  } catch {
    /* storage full / disabled — session just won't persist */
  }
}

function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(GROUP_FRIENDS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * A friend made through roulette+reveal lives on the shared GROUP topic, and
 * that row cannot be rebuilt from the server after a reload: `subscribeMe`
 * surfaces `usr…` p2p contacts only, and the real #ID/displayName were captured
 * once, from the `revealed` event (companion's `GET /friends` reports the peer's
 * p2p uid as `topic`, so it can't be keyed to the group either). Nothing
 * restored them, so a reload emptied «Чаты»/«Контакты» and the whole
 * conversation — own messages included — became unreachable.
 *
 * Persist exactly those rows: p2p friends come back from the me-contact list on
 * their own, so this stays the smallest possible local mirror of server state.
 * The existing `prev`/`keepId` merge in startContacts then treats a restored row
 * the same way it already treats one that survived in memory.
 *
 * ponytail: local mirror, never pruned — a friend removed elsewhere lingers
 * until the next reveal-side update. Prune against `GET /friends` once that
 * endpoint reports the group topic (it reports the p2p uid today).
 */
const GROUP_FRIENDS_KEY = "anoon:friends:grp";

function saveGroupFriends(friends: Friend[]): void {
  try {
    const grp = friends.filter((f) => f.topic?.startsWith("grp"));
    if (grp.length) localStorage.setItem(GROUP_FRIENDS_KEY, JSON.stringify(grp));
    else localStorage.removeItem(GROUP_FRIENDS_KEY);
  } catch {
    /* storage full / disabled — the list just won't survive a reload */
  }
}

function readGroupFriends(): Friend[] {
  try {
    const raw = localStorage.getItem(GROUP_FRIENDS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as Friend[]) : [];
  } catch {
    return [];
  }
}

function readSession(): { token: string; user: User } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.token && parsed?.user ? parsed : null;
  } catch {
    return null;
  }
}

/** True if a persisted session exists — lets the shell skip onboarding on boot. */
export function hasPersistedSession(): boolean {
  try {
    return typeof localStorage !== "undefined" && !!localStorage.getItem(SESSION_KEY);
  } catch {
    return false;
  }
}

/** Replace a message with the same id, else append. Keeps insertion order. */
function upsertMsg(
  list: TinodeMessageLite[],
  msg: TinodeMessageLite,
): TinodeMessageLite[] {
  const i = list.findIndex((m) => m.id === msg.id);
  if (i < 0) return [...list, msg];
  const next = list.slice();
  next[i] = msg;
  return next;
}

/**
 * Reconcile an optimistic message (`tmpId`) with its server-assigned `seq`,
 * flipping it to "sent". If the topic already echoed the message back under
 * `String(seq)` before `sendMessage` resolved — a race on anon topics, whose
 * blanked `from` defeats the own-echo filter — that echo is dropped first so the
 * reconciled bubble isn't duplicated (which showed up as a duplicate React key).
 */
function reconcileTmp(
  list: TinodeMessageLite[],
  tmpId: string,
  seq: number | undefined,
): TinodeMessageLite[] {
  const newId = seq ? String(seq) : tmpId;
  return list
    .filter((m) => !(m.id === newId && m.id !== tmpId))
    .map((m) => (m.id === tmpId ? { ...m, id: newId, status: "sent" as const } : m));
}

/**
 * Fold an incoming/own reaction onto its target message (matched by seq → id).
 * Dedupes by emoji so each distinct emoji shows a single pill; a reaction that
 * is now ours promotes the pill's `mine` flag (used for the "own" highlight).
 * See {@link parseReaction} / `TinodeClient.sendReaction`.
 */
function applyReaction(
  list: TinodeMessageLite[],
  seq: number,
  emoji: string,
  mine: boolean,
): TinodeMessageLite[] {
  return list.map((m) => {
    if (m.id !== String(seq)) return m;
    const reactions = m.reactions ?? [];
    const existing = reactions.find((r) => r.emoji === emoji);
    if (existing) {
      if (mine && !existing.mine) {
        return {
          ...m,
          reactions: reactions.map((r) => (r.emoji === emoji ? { ...r, mine: true } : r)),
        };
      }
      return m;
    }
    return { ...m, reactions: [...reactions, { emoji, mine }] };
  });
}

/**
 * Delivery status an own message (`id` = its server seq) should show given the
 * peer's highest received/read seq. Optimistic ids (tmp `t…`, `r…`) parse to
 * NaN and keep their current status until reconciled to a real seq. `read`
 * dominates `delivered` dominates the current value.
 */
function receiptStatus(
  id: string,
  recvSeq: number,
  readSeq: number,
  current: TinodeMessageLite["status"],
): TinodeMessageLite["status"] {
  const n = Number(id);
  if (!Number.isFinite(n)) return current;
  if (n <= readSeq) return "read";
  if (n <= recvSeq) return "delivered";
  return current;
}

/**
 * Fold the peer's recv/read high-water marks (contract A, BUG-8) onto every own
 * bubble. Applied both on live `{info what:recv|read}` and right after an
 * optimistic send reconciles to a real seq — the latter fixes the fast-read
 * race where the peer's read receipt arrived before our own publish ack, which
 * previously left the message stuck on a single "sent" tick.
 */
function applyOwnReceipts(
  list: TinodeMessageLite[],
  recvSeq: number,
  readSeq: number,
): TinodeMessageLite[] {
  if (!recvSeq && !readSeq) return list;
  return list.map((m) => {
    if (!m.mine || m.status === "read") return m;
    const next = receiptStatus(m.id, recvSeq, readSeq, m.status);
    return next && next !== m.status ? { ...m, status: next } : m;
  });
}

/** Replace a message body in place with an edit (idempotent), marking it "изменено". */
function applyEdit(list: TinodeMessageLite[], seq: number, text: string): TinodeMessageLite[] {
  return list.map((m) => (m.id === String(seq) ? { ...m, text, edited: true } : m));
}

/**
 * Apply a delete. `hard` leaves a "сообщение удалено" tombstone (both parties
 * see it); soft simply drops the message from the local list ("удалить у меня").
 */
function applyDelete(list: TinodeMessageLite[], seq: number, hard: boolean): TinodeMessageLite[] {
  if (!hard) return list.filter((m) => m.id !== String(seq));
  return list.map((m) =>
    m.id === String(seq)
      ? { ...m, deleted: true, text: "", media: undefined, reactions: undefined, replyTo: undefined }
      : m,
  );
}

/**
 * Reply/view-once carry app-level metadata Tinode has no head slot the client
 * wrapper exposes for, so they ride as extra top-level keys on the Drafty
 * content object (`plainText`/`parseMediaParts` ignore unknown keys, and the
 * server relays `content` verbatim). Builders/parsers are paired here.
 */
function buildReplyContent(text: string, reply: { seq: number; text: string }): unknown {
  return { txt: text, reply };
}
function parseReplyRef(content: unknown): { seq: number; text: string } | undefined {
  if (!content || typeof content !== "object") return undefined;
  const r = (content as { reply?: { seq?: unknown; text?: unknown } }).reply;
  if (!r || typeof r.seq !== "number") return undefined;
  return { seq: r.seq, text: String(r.text ?? "") };
}
function buildViewOnceDraft(
  up: UploadedMedia,
  extra?: { width?: number; height?: number; duration?: number },
): unknown {
  const draft = buildMediaDraft("image", up, extra) as Record<string, unknown>;
  draft.viewOnce = true;
  return draft;
}
function parseViewOnce(content: unknown): boolean {
  return Boolean(
    content && typeof content === "object" && (content as { viewOnce?: unknown }).viewOnce === true,
  );
}

/** Short plain-text preview of a message for the friends/chats list (Wave-2 #93). */
function previewOf(m: TinodeMessageLite): string {
  if (m.text) return m.text;
  const kind = m.media?.[0]?.kind;
  if (kind === "image") return "📷 Фото";
  if (kind === "video") return "🎥 Видео";
  if (kind === "audio") return "🎤 Голосовое";
  if (kind === "file") return "📎 Файл";
  return "";
}

/** Russian "был в сети N назад" from a last-seen timestamp, or null if unknown. */
function humanLastSeen(ms: number | null): string | null {
  if (!ms) return null;
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return "был(а) в сети только что";
  if (min < 60) return `был(а) в сети ${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `был(а) в сети ${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `был(а) в сети ${d} дн назад`;
  const date = new Date(ms);
  const dd = date.getDate().toString().padStart(2, "0");
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  return `был(а) в сети ${dd}.${mm}`;
}

/** Build a decoded, store-ready inbound message from a raw Tinode frame. */
function inboundMsg(m: TinodeMessage, mine: boolean): TinodeMessageLite {
  return {
    id: String(m.seq || `r${m.ts}`),
    mine,
    text: plainText(m.content),
    media: parseMediaParts(m.content),
    replyTo: parseReplyRef(m.content),
    viewOnce: parseViewOnce(m.content) || undefined,
    ts: m.ts,
  };
}

/**
 * Build a placeholder {@link User} from a Tinode uid + the fields the auth
 * screens collect. Companion-owned bits (real #ID, coins, tier) are stubbed
 * until the companion service (Phase A3) provisions them.
 */
function synthesizeUser(uid: string, input: BasicSignInInput): User {
  // Cheap deterministic tone from the uid so the avatar is stable per account.
  const tone = [...uid].reduce((a, c) => a + c.charCodeAt(0), 0) % 6;
  return {
    id: uid,
    hashId: uid.replace(/^usr/, "").slice(0, 8).toUpperCase(),
    displayName: input.displayName?.trim() || tinodeLoginFromEmail(input.email),
    gender: input.gender ?? "male",
    age: input.age ?? 18,
    avatarTone: tone,
    subscription: "free",
    coins: 0,
    moderation: "ok",
    tinodeUid: uid,
  };
}

/**
 * Thrown when a Google sign-in turns out to be a FIRST one: companion needs a
 * gender before it will register the account, and gender is irreversible once
 * set. The login screen catches this, asks, and calls back with the answer.
 *
 * It exists as its own type so the screen does not have to reason about HTTP
 * status codes — and so a genuine failure is never mistaken for "just ask".
 */
export class NeedsGenderError extends Error {
  constructor() {
    super("Google: нужен пол для регистрации");
    this.name = "NeedsGenderError";
  }
}

export const createSessionSlice: Slice<SessionSlice> = (set, get) => ({
  user: null,
  hashId: null,
  status: "signed_out",
  authError: null,
  pendingGoogleToken: null,
  uiError: null,
  showError: (message) => set({ uiError: message }),
  dismissError: () => set({ uiError: null }),
  signInWithBasic: async (input) => {
    set({ status: "connecting", authError: null });
    try {
      const tinode = getTinodeClient();
      const companion = getCompanionClient();
      const login = tinodeLoginFromEmail(input.email);
      const rawAge = input.age;

      let uid: string;
      let registered: RegisterResult | null = null;

      if (input.isNew) {
        try {
          // Real path: companion creates the Tinode account itself (via its
          // ROOT connection) and allocates a #ID, writing the anoon.users row
          // that enqueue/friends/etc. all key off. We just log in next.
          registered = await companion.register({
            login,
            password: input.password,
            gender: input.gender ?? "male",
            age: rawAge,
          });
          uid = await tinode.loginBasic(login, input.password);
        } catch {
          // Companion unreachable — same fallback as before: create the
          // Tinode account directly. No #ID / companion features until it's
          // back (roulette enqueue etc. will 401 → the client's own mock mode).
          uid = await tinode.createAccountBasic(login, input.password, input.displayName);
        }
      } else {
        // Existing account: companion has no basic-login endpoint yet (it's a
        // 501 stub) — log into Tinode directly. Its anoon.users row already
        // exists from registration.
        uid = await tinode.loginBasic(login, input.password);
      }

      // Hand the just-issued Tinode auth token to companion as its own
      // session bearer — it validates it (`ResolveToken`) the same way for
      // both REST `Authorization` and the WS `?token=`, so this one token
      // authenticates everything. Then re-open the event socket: the one
      // AnoonApp opened on mount predates login and has no token.
      const token = tinode.getAuthToken();
      if (token) {
        companion.setSessionToken(token);
        get().reconnectCompanionEvents();
      }

      // Existing-user login: now that the session token is set, prefer the real
      // companion profile (real #ID, gender, coins, tier) over a synthesized
      // placeholder. Non-fatal — `me()` returns null when companion is down or
      // has no row yet, in which case we fall back to a synthesized User.
      const profile = input.isNew ? null : await companion.me();
      // `me()` swallows every failure and answers null, so a companion that is
      // down (or does not know this account) used to log the user in silently
      // with a synthesized #ID — every companion-backed screen then failed one
      // by one with no explanation. Say it once, here, and let the login
      // proceed: Tinode chat still works without companion.
      if (USE_TINODE && !input.isNew && !profile) {
        set({ uiError: "Профиль не загрузился: companion не отвечает" });
      }

      // Base placeholder always has every UI field populated (displayName,
      // avatarTone, …). For the login path we overlay the REAL identity fields
      // that GET /me returns (#ID, gender, age) — /me does NOT carry a
      // displayName/avatarTone, so using its payload directly as the User left
      // displayName undefined and crashed every `.displayName.trim()` call.
      const base = synthesizeUser(uid, input);
      const user: User = registered
        ? {
            id: uid,
            hashId: registered.hashId.replace(/^#/, ""),
            displayName: input.displayName?.trim() || tinodeLoginFromEmail(input.email),
            gender: registered.gender,
            age: rawAge ?? 18,
            avatarTone: toneFor(uid),
            subscription: "free",
            coins: 0,
            moderation: "ok",
            tinodeUid: uid,
          }
        : profile
          ? {
              ...base,
              hashId: profile.hashId
                ? String(profile.hashId).replace(/^#/, "")
                : base.hashId,
              gender: profile.gender ?? base.gender,
              age: profile.age ?? base.age,
            }
          : base;

      set({
        user,
        hashId: user.hashId,
        status: "ready",
        tier: user.subscription,
        coins: user.coins,
      });
      // Persist the session so a page reload silently re-logs in instead of
      // bouncing to the login screen (BUG-44).
      if (token) saveSession(token, user);
      // Populate the friends/chats list from the me-topic (non-fatal on failure).
      try {
        await get().startContacts();
      } catch {
        // No contacts yet or transient error — the list just stays empty.
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось войти";
      set({ status: "signed_out", authError: message });
      throw err;
    }
  },
  signInWithGoogle: async (idToken, gender, age) => {
    set({ status: "connecting", authError: null });
    try {
      const tinode = getTinodeClient();
      const companion = getCompanionClient();

      // Ask companion first: it is the only side that knows whether this Google
      // account is already ours. A returning user must not be asked for gender
      // again — it cannot be changed, so a second answer could only be wrong.
      try {
        await companion.oauthGoogle(idToken, gender, age);
      } catch (err) {
        // 400 means the token verified but the body was refused, and the only
        // field this client can be missing is gender (age is either absent or
        // already in range). Anything else — 401 bad token, 503 Google not
        // configured, network — is a real failure and must surface as one.
        if (err instanceof CompanionHttpError && err.status === 400 && !gender) {
          // Hold the token for the gender screen: it is the same token the retry
          // must present, and Google will not hand out a second one without
          // sending the person back through the account chooser.
          set({ status: "signed_out", pendingGoogleToken: idToken });
          throw new NeedsGenderError();
        }
        throw err;
      }

      // `rest` scheme, secret = the same ID token. For a first sign-in this is
      // what actually creates the Tinode account from the pending row above,
      // which is why it must not be skipped when status was registered_pending.
      const uid = await tinode.loginRest(idToken);

      const token = tinode.getAuthToken();
      if (token) {
        companion.setSessionToken(token);
        get().reconnectCompanionEvents();
      }

      // Now that the bearer is set, take the real identity from companion: the
      // #ID it allocated, and the gender/age it stored. There is nothing to
      // synthesize from here — Google gives us no display name we asked for,
      // and the placeholder path exists only for the basic-scheme fallback.
      const profile = await companion.me();
      if (!profile) {
        set({ uiError: "Профиль не загрузился: companion не отвечает" });
      }
      const user: User = {
        id: uid,
        hashId: profile?.hashId ? String(profile.hashId).replace(/^#/, "") : uid.replace(/^usr/, ""),
        displayName: profile?.displayName?.trim() || "Аноним",
        gender: profile?.gender ?? gender ?? "male",
        age: profile?.age ?? age ?? 18,
        avatarTone: toneFor(uid),
        subscription: profile?.subscription ?? "free",
        coins: profile?.coins ?? 0,
        moderation: profile?.moderation ?? "ok",
        tinodeUid: uid,
      };

      set({
        user,
        hashId: user.hashId,
        status: "ready",
        pendingGoogleToken: null,
        tier: user.subscription,
        coins: user.coins,
      });
      if (token) saveSession(token, user);
      try {
        await get().startContacts();
      } catch {
        // No contacts yet or transient error — the list just stays empty.
      }
    } catch (err) {
      // NeedsGender is a question, not a failure: showing it as authError would
      // paint a red line under the form while we are about to ask politely.
      if (err instanceof NeedsGenderError) throw err;
      const message = err instanceof Error ? err.message : "Не удалось войти через Google";
      set({ status: "signed_out", authError: message });
      throw err;
    }
  },
  restoreSession: async () => {
    if (!USE_TINODE) return false;
    const saved = readSession();
    if (!saved?.token) return false;
    set({ status: "connecting" });
    try {
      const tinode = getTinodeClient();
      const companion = getCompanionClient();
      await tinode.connect();
      // loginToken rejects an expired/revoked token → we fall through to clear.
      await tinode.loginToken(saved.token);
      const fresh = tinode.getAuthToken() ?? saved.token;
      companion.setSessionToken(fresh);
      get().reconnectCompanionEvents();
      set({
        user: saved.user,
        hashId: saved.user?.hashId ?? null,
        status: "ready",
        tier: saved.user?.subscription ?? "free",
        coins: saved.user?.coins ?? 0,
      });
      // Refresh the stored token (the SDK may have issued a new one).
      saveSession(fresh, saved.user);
      // Seed the revealed (group-topic) friends before contacts load, so the
      // me-contact re-emit merges onto them instead of starting from nothing.
      set({ friends: readGroupFriends() });
      try {
        await get().startContacts();
      } catch {
        /* contacts stay empty until they load */
      }
      return true;
    } catch {
      clearSession();
      set({ status: "signed_out" });
      return false;
    }
  },
  signIn: async (user, tinodeToken, sessionToken) => {
    set({ user, hashId: user.hashId, status: "connecting", tier: user.subscription, coins: user.coins });
    // TODO: companion.setSessionToken(sessionToken); companion.connectEvents();
    //       await tinode.connect(); await tinode.loginToken(tinodeToken);
    getCompanionClient().setSessionToken(sessionToken);
    void tinodeToken;
    set({ status: "ready" });
  },
  signOut: () => {
    clearSession(); // BUG-44: forget the persisted token so boot won't re-login.
    getCompanionClient().disconnect();
    getTinodeClient().disconnect();
    set({
      user: null,
      hashId: null,
      status: "signed_out",
      contactsReady: false,
      activeChat: null,
      chatTarget: null,
      chatMessages: [],
      friends: [],
    });
  },
  setUser: (user) => set({ user, hashId: user?.hashId ?? null }),
});

export const createFriendsSlice: Slice<FriendsSlice> = (set) => ({
  friends: [],
  requests: [],
  setFriends: (friends) => {
    saveGroupFriends(friends);
    set({ friends });
  },
  upsertFriend: (friend) =>
    set((s) => {
      const rest = s.friends.filter((f) => f.id !== friend.id);
      const friends = [...rest, friend];
      saveGroupFriends(friends);
      return { friends };
    }),
  setRequests: (requests) => set({ requests }),
  addRequest: (request) =>
    set((s) => ({ requests: [request, ...s.requests.filter((r) => r.id !== request.id)] })),
  removeRequest: (id) => set((s) => ({ requests: s.requests.filter((r) => r.id !== id) })),
  setFriendOnline: (hashId, online) =>
    set((s) => ({
      friends: s.friends.map((f) => (f.hashId === hashId ? { ...f, online } : f)),
    })),
});

export const createChatSlice: Slice<ChatSlice> = (set, get) => {
  // Subscription handles + timers live in the closure (not in state).
  let meUnsub: (() => void) | null = null;
  // Peer-activity ("typing"/"media") auto-clear timer (BUG-18).
  let activityTimer: ReturnType<typeof setTimeout> | null = null;
  // Topic of the currently-open chat, so background subscriptions never clobber
  // the active chat's handlers (BUG-17).
  let activeTopic: string | null = null;
  // Call system-lines for peers whose chat wasn't open when the call ended,
  // keyed by peerKey(hashId). Flushed (and cleared) by the next openChat — a
  // missed call rings on the app shell, not inside the thread it belongs to.
  const pendingCallLines = new Map<string, TinodeMessageLite[]>();
  // Background subscriptions to every friend topic so a friend's messages arrive
  // even when their chat is CLOSED (BUG-17). Value = the SDK unsub (leaves the
  // topic); only invoked on full teardown — an open/closed chat just swaps
  // handlers on the already-subscribed topic, it never leaves.
  const bgSubs = new Map<string, () => void>();
  // Topics whose unread we've locally cleared (opened/read) — authoritative
  // over the me-contact's server `unread`, which lags after noteRead and would
  // otherwise resurrect the badge for a chat the user just read (BUG-45). A new
  // inbound message removes the topic so the badge re-appears.
  const readTopics = new Set<string>();
  // Real #ID/displayName per p2p topic, from companion GET /friends — the
  // me-topic contact only knows the raw Tinode uid, so without this the chat
  // list/header showed "usrXXX"/"#<uid>" instead of the friend's #ID (BUG-43).
  const companionIds = new Map<string, { hashId: string; displayName: string }>();
  const refreshCompanionIds = async () => {
    try {
      const list = await getCompanionClient().friendsList();
      for (const f of list) {
        if (f.topic) {
          const hashId = f.hashId?.startsWith("#") ? f.hashId : `#${f.hashId ?? ""}`;
          companionIds.set(f.topic, { hashId, displayName: f.displayName || hashId });
        }
      }
    } catch {
      // Swallowed on purpose, and this is the one caller where that is right:
      // the map only ENRICHES rows the me-topic already produced, so a failure
      // degrades "#00012" to the raw uid instead of hiding anyone. Nothing here
      // claims a friend does or does not exist. (friendsList itself now rethrows
      // a refusal rather than answering it with [] — see companion.ts.)
    }
  };
  // Peer's highest received/read seq for the OPEN chat (contract A, BUG-8).
  // Kept in the closure so a reconciling send can re-apply them (fast-read
  // race). Reset whenever the open chat changes (openChat/closeChat).
  let peerRecvSeq = 0;
  let peerReadSeq = 0;

  // Set the peer-activity indicator (BUG-18) with a ~4s auto-clear. Keeps the
  // legacy `chatPeerTyping` flag in sync for callers still reading it.
  const setPeerActivity = (activity: "typing" | "media" | null) => {
    if (activityTimer) clearTimeout(activityTimer);
    set({ peerActivity: activity, chatPeerTyping: activity === "typing" });
    if (activity) {
      activityTimer = setTimeout(
        () => set({ peerActivity: null, chatPeerTyping: false }),
        4000,
      );
    }
  };

  // Update a friend's chats-list preview (last message + activity) in place.
  const touchFriend = (topic: string, preview: string, ts: number) =>
    set((s) => ({
      friends: s.friends.map((f) =>
        f.topic === topic ? { ...f, lastMessage: preview, lastActiveAt: ts } : f,
      ),
    }));

  // Bump a friend's unread badge (background message arrived, BUG-17).
  const bumpUnread = (topic: string) => {
    // A new message → the chat is no longer "read"; let the badge show again
    // and survive the next me-merge (BUG-45).
    readTopics.delete(topic);
    set((s) => ({
      friends: s.friends.map((f) =>
        f.topic === topic ? { ...f, unread: (f.unread ?? 0) + 1 } : f,
      ),
    }));
  };

  // Full handlers for the ACTIVE chat (folded onto `chatMessages`). Extracted so
  // openChat can attach them and closeChat can swap them for {@link bgHandlers}
  // without leaving the topic (BUG-17).
  const chatHandlers = (topic: string): TopicHandlers => {
    const client = getTinodeClient();
    const myUid = client.getUid();
    return {
      onMessage: (m) => {
        const reaction = parseReaction(m);
        if (reaction) {
          set((s) => ({
            chatMessages: applyReaction(s.chatMessages, reaction.seq, reaction.emoji, false),
          }));
          return;
        }
        const editSeq = parseEditTarget(m);
        if (editSeq) {
          set((s) => ({ chatMessages: applyEdit(s.chatMessages, editSeq, plainText(m.content)) }));
          return;
        }
        // Pre-reveal anon messages carry a server-blanked `from` — not part of
        // the post-reveal friend thread (BUG-3/#110).
        if (!m.from) return;
        if (m.from === myUid) {
          // Our own message, replayed from the SDK cache (sent this session) or
          // fetched back from the server (sent before this page load). Dropping
          // it here meant no message we ever sent survived closing the chat:
          // openChat empties `chatMessages` and this replay is the only thing
          // that refills it. Idempotent by seq id, and it never overwrites an
          // optimistic bubble that already carries its delivery ticks.
          const own = inboundMsg(m, true);
          set((s) =>
            s.chatMessages.some((x) => x.id === own.id)
              ? {}
              : {
                  chatMessages: applyOwnReceipts(
                    upsertMsg(s.chatMessages, { ...own, status: "sent" }),
                    peerRecvSeq,
                    peerReadSeq,
                  ),
                },
          );
          return;
        }
        const msg = inboundMsg(m, false);
        set((s) => ({ chatMessages: upsertMsg(s.chatMessages, msg) }));
        // Delivered + read receipts (chat is open) and chats-list preview.
        client.noteRecv(topic, m.seq);
        client.noteRead(topic, m.seq);
        touchFriend(topic, previewOf(msg), m.ts);
      },
      onTyping: (from) => {
        if (from && from === myUid) return;
        setPeerActivity("typing");
      },
      onInfo: (info) => {
        // recv/read carry the highest seq the peer received/read. Track the
        // high-water marks (so a later reconciling send re-applies them — the
        // fast-read race) and fold them onto every own bubble (contract A, BUG-8).
        const upto = info.seq ?? Number.POSITIVE_INFINITY;
        if (info.what === "recv") {
          peerRecvSeq = Math.max(peerRecvSeq, upto);
        } else if (info.what === "read") {
          peerReadSeq = Math.max(peerReadSeq, upto);
          peerRecvSeq = Math.max(peerRecvSeq, peerReadSeq);
        } else {
          return;
        }
        set((s) => ({
          chatMessages: applyOwnReceipts(s.chatMessages, peerRecvSeq, peerReadSeq),
        }));
      },
      onPres: (p) => {
        const online = Boolean(p.online);
        const lastSeenMs = client.getContactLastSeen(topic);
        const lastSeen = online ? null : humanLastSeen(lastSeenMs);
        set((s) => ({
          chatPeerOnline: online,
          chatPeerLastSeen: lastSeen,
          activeChat:
            s.activeChat && s.activeChat.topic === topic
              ? { ...s.activeChat, online, lastActiveAt: online ? Date.now() : s.activeChat.lastActiveAt }
              : s.activeChat,
          friends: s.friends.map((f) =>
            f.topic === topic ? { ...f, online, lastSeen: lastSeen ?? undefined } : f,
          ),
        }));
      },
      onDelete: (seqs) => {
        set((s) => ({
          chatMessages: seqs.reduce((list, seq) => applyDelete(list, seq, true), s.chatMessages),
        }));
      },
    };
  };

  // Lightweight handlers for a friend topic whose chat is CLOSED (BUG-17): keep
  // messages arriving in the background — bump unread + last-message preview,
  // mark delivered, and fire the local sound (BUG-19) — without touching the
  // (empty) open-chat message list. Reactions/edits aren't "new messages".
  const bgHandlers = (topic: string): TopicHandlers => {
    const client = getTinodeClient();
    const myUid = client.getUid();
    return {
      onMessage: (m) => {
        if (parseReaction(m) || parseEditTarget(m)) return;
        if (!m.from || m.from === myUid) return;
        const msg = inboundMsg(m, false);
        // Preview always reflects the latest message (even a replayed one).
        touchFriend(topic, previewOf(msg), m.ts);
        // Only count/sound GENUINELY new messages. On (re)subscribe the SDK
        // replays cached history through this handler; without this guard every
        // boot re-counted already-read messages and the badge inflated (BUG-45).
        if (m.seq && m.seq <= client.myReadSeq(topic)) return;
        bumpUnread(topic);
        client.noteRecv(topic, m.seq); // delivered (read only happens on open)
        notifyOnce("message"); // sound + vibrate (BUG-19)
      },
      // Keep the friends-list online / «был в сети» live even while this chat is
      // closed — the swap-to-background rewrite must not regress presence.
      onPres: (p) => {
        const online = Boolean(p.online);
        const lastSeen = online ? null : humanLastSeen(client.getContactLastSeen(topic));
        set((s) => ({
          friends: s.friends.map((f) =>
            f.topic === topic ? { ...f, online, lastSeen: lastSeen ?? undefined } : f,
          ),
        }));
      },
      // Peer hard-deleted while this chat was closed: drop it from the SDK cache
      // so a later reopen's cached replay doesn't resurrect it (#113 / BUG-4).
      onDelete: (seqs) => {
        for (const seq of seqs) client.purgeCachedMessage(topic, seq);
      },
    };
  };

  // Ensure a background subscription exists for `topic` (BUG-17). Idempotent;
  // never attaches to the currently-open friend chat OR the active anon/roulette
  // match (both own their own handlers on that topic — a second subscribe would
  // clobber onData).
  const ensureBg = (topic?: string) => {
    if (!topic || bgSubs.has(topic) || topic === activeTopic) return;
    if (get().activeMatch?.topic === topic) return;
    // Reserve the slot synchronously so a burst of me-emits can't double-subscribe.
    bgSubs.set(topic, () => {});
    void getTinodeClient()
      .subscribeTopic(topic, bgHandlers(topic))
      .then((unsub) => bgSubs.set(topic, unsub))
      .catch(() => bgSubs.delete(topic)); // failed — allow a later retry
  };

  // Keep background subs in step with the contact list. Only p2p (`usr`) friend
  // topics: `grp` topics belong to the anon/roulette flow (its own slice manages
  // them), so background-subscribing one would fight the active anon chat.
  const syncBgSubs = (friends: Friend[]) => {
    for (const f of friends) if (f.topic?.startsWith("usr")) ensureBg(f.topic);
  };

  return {
    contactsReady: false,
    activeChat: null,
    chatTarget: null,
    chatMessages: [],
    chatPeerTyping: false,
    peerActivity: null,
    chatPeerOnline: false,
    chatPeerLastSeen: null,
    chatViewed: {},

    setChatTarget: (friend) => set({ chatTarget: friend }),
    setPeerActivity,

    startContacts: async () => {
      if (get().contactsReady) return;
      meUnsub?.();
      // Fresh session — topics were dropped on the last disconnect, so any old
      // background-sub handles are dead; start clean (BUG-17).
      bgSubs.clear();
      activeTopic = null;
      // Load real #IDs first so the first me-emit resolves p2p uids (BUG-43).
      await refreshCompanionIds();
      meUnsub = await getTinodeClient().subscribeMe((contacts) => {
        // Preserve per-message previews (lastMessage) we track locally on
        // send/receive — the me-topic re-emit rebuilds from server contacts,
        // which carry unread/touched but not the last-message text.
        const prev = new Map(get().friends.map((f) => [f.topic, f]));
        const contactTopics = new Set(contacts.map((c) => c.topic));
        const friends = [...contacts]
          .sort((a, b) => (b.touched ?? 0) - (a.touched ?? 0))
          .map((c) => {
            const base = contactToFriend(c);
            // Resolve the raw Tinode uid → real #ID/name from companion (BUG-43).
            const cid = companionIds.get(c.topic);
            const f = cid ? { ...base, hashId: cid.hashId, displayName: cid.displayName } : base;
            const before = prev.get(c.topic);
            if (!before) return readTopics.has(c.topic) ? { ...f, unread: 0 } : f;
            // A revealed friend lives on the shared GROUP topic — contactToFriend
            // can only derive a garbage "#grpXXX" hashId/name from a group name,
            // so keep the real identity we captured on the `revealed` event.
            // The companion #ID (cid) always wins when present.
            const keepId = !cid && before.hashId && !before.hashId.startsWith("#grp");
            return {
              ...f,
              hashId: cid ? cid.hashId : keepId ? before.hashId : f.hashId,
              displayName: cid ? cid.displayName : keepId ? before.displayName : f.displayName,
              avatarTone: keepId ? before.avatarTone : f.avatarTone,
              lastMessage: before.lastMessage ?? f.lastMessage,
              // The me-contact's server `unread` lags after noteRead — trust our
              // local read-state so a read chat's badge doesn't come back (BUG-45).
              unread: readTopics.has(c.topic) ? 0 : f.unread,
            };
          });
        // Keep optimistically-added revealed friends (group topics) that the
        // me-topic contact list doesn't surface yet — otherwise the revealer's
        // friend row vanishes the instant contacts re-emit after a reveal.
        const preserved = get().friends.filter(
          (f) => f.topic && f.topic.startsWith("grp") && !contactTopics.has(f.topic),
        );
        const all = [...friends, ...preserved];
        get().setFriends(all);
        // Background-subscribe every friend topic so messages arrive with the
        // chat closed (BUG-17). Idempotent; skips the currently-open chat.
        syncBgSubs(all);
      });
      set({ contactsReady: true });
    },

    openChat: async (friend) => {
      if (!friend.topic) return;
      const topic = friend.topic;
      activeTopic = topic;
      readTopics.add(topic); // Mark read locally so the badge stays cleared (BUG-45).
      peerRecvSeq = 0;
      peerReadSeq = 0;
      const client = getTinodeClient();
      const online0 = client.getContactOnline(topic);
      set({
        activeChat: { ...friend, unread: 0 },
        chatMessages: [],
        chatPeerTyping: false,
        peerActivity: null,
        chatPeerOnline: online0,
        chatPeerLastSeen: online0 ? null : humanLastSeen(client.getContactLastSeen(topic)),
        chatPeerLeft: false,
      });
      // Clear this friend's unread badge in the chats list on open.
      set((s) => ({
        friends: s.friends.map((f) => (f.topic === topic ? { ...f, unread: 0 } : f)),
      }));
      // Attach the full chat handlers. The topic is usually already background-
      // subscribed (BUG-17) — subscribeTopic then just re-points onData and
      // replays cache. We keep it subscribed on close (never leave), so retain
      // a leave handle in bgSubs for final teardown only if none exists yet.
      const unsub = await client.subscribeTopic(topic, chatHandlers(topic));
      if (!bgSubs.has(topic)) bgSubs.set(topic, unsub);
      // Flush a read receipt for everything accrued while the chat was closed
      // (background unread) so the SENDER's ticks flip to read on open, not just
      // for messages that happen to arrive after this point (BUG-8 / unread
      // reconciliation). `noteRead` with no seq marks up to the topic's latest.
      client.noteRead(topic);
      // Replay call records that landed while this chat was closed. Appended at
      // the tail, after the cached history replay above: a buffered record is
      // newer than the history it follows in every practical case.
      const buffered = pendingCallLines.get(peerKey(friend.hashId));
      if (buffered?.length) {
        pendingCallLines.delete(peerKey(friend.hashId));
        set((s) => ({ chatMessages: [...s.chatMessages, ...buffered] }));
      }
    },

    closeChat: () => {
      const topic = activeTopic;
      activeTopic = null;
      peerRecvSeq = 0;
      peerReadSeq = 0;
      if (activityTimer) {
        clearTimeout(activityTimer);
        activityTimer = null;
      }
      set({
        activeChat: null,
        chatMessages: [],
        chatPeerTyping: false,
        peerActivity: null,
        chatPeerOnline: false,
        chatPeerLastSeen: null,
        chatPeerLeft: false,
      });
      // Don't leave the topic — swap back to the lightweight background handlers
      // so this friend's messages keep arriving while the chat is closed (BUG-17).
      if (topic) {
        void getTinodeClient()
          .subscribeTopic(topic, bgHandlers(topic))
          .then((unsub) => bgSubs.set(topic, unsub))
          .catch(() => {});
      }
    },

    sendChatMessage: async (text, reply) => {
      const friend = get().activeChat;
      const body = text.trim();
      if (!friend?.topic || !body) return;
      const tmpId = nextTmpId();
      const optimistic: TinodeMessageLite = {
        id: tmpId,
        mine: true,
        text: body,
        replyTo: reply,
        ts: Date.now(),
        status: "sending",
      };
      set((s) => ({ chatMessages: [...s.chatMessages, optimistic] }));
      touchFriend(friend.topic, body, optimistic.ts);
      try {
        const content = reply ? buildReplyContent(body, reply) : body;
        const seq = await getTinodeClient().sendMessage(friend.topic, content);
        // Reconcile, then fold in any receipts that already arrived for this seq
        // before the publish ack resolved (fast-read race, BUG-8).
        set((s) => ({
          chatMessages: applyOwnReceipts(
            reconcileTmp(s.chatMessages, tmpId, seq),
            peerRecvSeq,
            peerReadSeq,
          ),
        }));
        // ROOT can't watch a p2p topic, so companion never sees this message —
        // tell it, so an offline peer still gets a push (#31). After the publish
        // ack on purpose: a send that failed must not notify anyone.
        getCompanionClient().notifyMessageSent(friend.hashId, friend.topic, body);
      } catch {
        // Leave it in the "sending" state so the user sees it didn't confirm.
      }
    },

    sendFriendMedia: async (up, kind, extra, opts) => {
      const friend = get().activeChat;
      if (!friend?.topic) return;
      const viewOnce = Boolean(opts?.viewOnce) && kind === "image";
      const tmpId = nextTmpId();
      const optimistic: TinodeMessageLite = {
        id: tmpId,
        mine: true,
        text: "",
        media: [mediaPartFrom(up, kind, extra)],
        viewOnce: viewOnce || undefined,
        ts: Date.now(),
        status: "sending",
      };
      set((s) => ({ chatMessages: [...s.chatMessages, optimistic] }));
      touchFriend(friend.topic, previewOf(optimistic), optimistic.ts);
      try {
        const draft = viewOnce ? buildViewOnceDraft(up, extra) : buildMediaDraft(kind, up, extra);
        const seq = await getTinodeClient().sendMessage(friend.topic, draft);
        set((s) => ({
          chatMessages: applyOwnReceipts(
            reconcileTmp(s.chatMessages, tmpId, seq),
            peerRecvSeq,
            peerReadSeq,
          ),
        }));
        // Best-effort media-asset tracking (companion GC/audit). Fire-and-forget;
        // never blocks the send. Only image/video/audio are tracked (not files).
        // View-once photos are ephemeral so the companion can GC them after viewing.
        if (kind !== "file") {
          void getCompanionClient().trackMedia({
            topic: friend.topic,
            kind,
            url: up.url,
            ephemeral: viewOnce || undefined,
          });
        }
        // Same offline push as a text message (#31) — an attachment is still a
        // message. No caption is sent: the body would either leak a view-once
        // photo's content into a lock screen or say nothing useful, so companion
        // renders its own generic wording.
        getCompanionClient().notifyMessageSent(friend.hashId, friend.topic, "");
      } catch {
        // Leave it in the "sending" state so the user sees it didn't confirm.
      }
    },

    notifyTyping: () => {
      const friend = get().activeChat;
      if (friend?.topic) getTinodeClient().sendTyping(friend.topic);
    },

    notifyMediaSending: () => {
      const friend = get().activeChat;
      if (!friend?.topic || getCompanionClient().isMock()) return;
      // Ephemeral "отправляет медиа" ping (BUG-18). p2p friend topics aren't
      // tracked as matches, so address it by the peer's hashId — companion
      // stamps `from` and forwards it to their socket.
      getCompanionClient().sendRaw({
        type: "activity",
        to: friend.hashId,
        topic: friend.topic,
        kind: "media",
      });
    },

    sendChatReaction: async (seq, emoji) => {
      const friend = get().activeChat;
      if (!friend?.topic || !seq) return;
      set((s) => ({ chatMessages: applyReaction(s.chatMessages, seq, emoji, true) }));
      try {
        await getTinodeClient().sendReaction(friend.topic, seq, emoji);
      } catch {
        // Optimistic pill stays; the peer just won't see it.
      }
    },

    editChatMessage: async (seq, text) => {
      const friend = get().activeChat;
      const body = text.trim();
      if (!friend?.topic || !seq || !body) return;
      set((s) => ({ chatMessages: applyEdit(s.chatMessages, seq, body) }));
      try {
        await getTinodeClient().editMessage(friend.topic, seq, body);
      } catch {
        // Local edit stays; not confirmed to the peer.
      }
    },

    deleteChatMessage: async (seq, hard) => {
      const friend = get().activeChat;
      if (!friend?.topic || !seq) return;
      set((s) => ({ chatMessages: applyDelete(s.chatMessages, seq, hard) }));
      // Hard delete ("у всех"): Tinode won't live-broadcast {pres what:del} to
      // the peer's anon-mode session, so relay it over the companion WS (best
      // effort, before the awaited Tinode call so a delMessages rejection can't
      // swallow it). The peer's onFrame handler (startCompanionEvents) tombstones
      // + purges its SDK cache. See BUG-4 / tinode.ts#purgeCachedMessage.
      if (hard) {
        getCompanionClient().sendRaw({ type: "msg:del", topic: friend.topic, seqs: [seq] });
      }
      try {
        await getTinodeClient().deleteMessage(friend.topic, seq, hard);
      } catch {
        // Local removal stays even if the server call failed.
      }
    },

    markChatViewed: (seq) =>
      set((s) => (s.chatViewed[seq] ? s : { chatViewed: { ...s.chatViewed, [seq]: true } })),

    logCall: (peer, text) => {
      const key = peerKey(peer);
      const line = systemMsg(text);
      // Anon roulette chat first: while a match is live it is the only place the
      // peer exists, and `messages` survives the screen being unmounted.
      const match = get().activeMatch;
      if (match && (match.peerAlias === peer || (match.peerHashId && peerKey(match.peerHashId) === key))) {
        set((s) => ({ messages: [...s.messages, line] }));
        return;
      }
      if (get().activeChat && peerKey(get().activeChat!.hashId) === key) {
        set((s) => ({ chatMessages: [...s.chatMessages, line] }));
        return;
      }
      // Friend chat is closed (a missed call is answered from the app shell) —
      // hold the line until openChat replays it.
      const buffered = pendingCallLines.get(key) ?? [];
      buffered.push(line);
      pendingCallLines.set(key, buffered);
    },
  };
};

export const createAnonChatSlice: Slice<AnonChatSlice> = (set, get) => {
  // Topic subscription handle + typing timer live in the closure (not in state).
  let anonUnsub: (() => void) | null = null;
  let typingTimer: ReturnType<typeof setTimeout> | null = null;
  // Seqs of our own outgoing anon messages. Anon topics blank the `From` field
  // (server ANON-PATCH), so the usual `m.from === myUid` self-filter can't tell
  // our own echoed message from the peer's — without this, own messages render
  // twice. We skip inbound frames whose seq we sent ourselves.
  const ownAnonSeqs = new Set<number>();
  // Topics we've already emitted a `peer:leaving` for, so the two real leave
  // points that can both fire (endMatch → closeAnon) don't double-signal
  // (BUG-15). Cleared when a new anon chat opens.
  const leftSignaled = new Set<string>();
  // Peer recv/read high-water marks for our own anon bubbles' ticks (BUG-38 —
  // the anon slice previously never tracked receipts, so own bubbles stuck at
  // "sent"; this mirrors the friend-chat path). Reset on openAnonChat.
  let anonPeerRecvSeq = 0;
  let anonPeerReadSeq = 0;

  // Peer-activity ("typing"/"media") indicator with a ~4s auto-clear (BUG-18).
  // Keeps the legacy `peerTyping` flag in sync for callers still reading it.
  const setAnonPeerActivity = (activity: "typing" | "media" | null) => {
    if (typingTimer) clearTimeout(typingTimer);
    set({ anonPeerActivity: activity, peerTyping: activity === "typing" });
    if (activity) {
      typingTimer = setTimeout(
        () => set({ anonPeerActivity: null, peerTyping: false }),
        4000,
      );
    }
  };

  // Tell the peer we're leaving this anon/revealed chat so their side can end
  // and show the "собеседник покинул чат" system line (BUG-15). Companion
  // relays it as `peer:left`. No-op in mock mode or if already signaled.
  const signalLeave = (topic?: string) => {
    if (!topic || getCompanionClient().isMock() || leftSignaled.has(topic)) return;
    leftSignaled.add(topic);
    getCompanionClient().sendRaw({ type: "peer:leaving", topic });
  };

  return {
    activeMatch: null,
    messages: [],
    peerTyping: false,
    anonPeerActivity: null,
    anonRevealState: "none",
    anonRevealPending: false,
    anonRevealAsksLeft: null,
    anonViewed: {},

    setAnonPeerActivity,
    notifyAnonMediaSending: () => {
      const match = get().activeMatch;
      if (!match?.topic || getCompanionClient().isMock()) return;
      // Ephemeral "отправляет медиа" ping (BUG-18). Anon peer's hashId is hidden
      // pre-reveal, so address by topic — companion resolves the match→peer.
      getCompanionClient().sendRaw({ type: "activity", topic: match.topic, kind: "media" });
    },

    setActiveMatch: (activeMatch) =>
      set({
        activeMatch,
        messages: [],
        peerTyping: false,
        anonRevealState: "none",
        anonRevealPending: false,
        anonRevealAsksLeft: null,
      }),
    appendMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
    setPeerTyping: (peerTyping) => set({ peerTyping }),

    openAnonChat: async (match) => {
      anonUnsub?.();
      anonUnsub = null;
      ownAnonSeqs.clear();
      leftSignaled.clear();
      anonPeerRecvSeq = 0;
      anonPeerReadSeq = 0;
      set({
        activeMatch: match,
        messages: [],
        peerTyping: false,
        anonRevealState: "none",
        anonRevealPending: false,
        anonRevealAsksLeft: null,
        anonViewed: {},
        anonPeerLeft: false,
      });
      // Without the companion backend there is no real anon topic — seed a demo
      // greeting so the flow is still walkable end-to-end.
      if (getCompanionClient().isMock()) {
        set({
          messages: [{ id: "a1", mine: false, text: "Привет! Чем занимаешься?", ts: Date.now() }],
        });
        return;
      }
      // Real match → subscribe the anon Tinode topic, reusing the 1:1 plumbing.
      const client = getTinodeClient();
      const myUid = client.getUid();
      const topic = match.topic;
      anonUnsub = await client.subscribeTopic(topic, {
        onMessage: (m) => {
          // Reactions fold onto their target bubble (dedup by emoji tolerates the
          // blanked-From echo of our own optimistic reaction).
          const reaction = parseReaction(m);
          if (reaction) {
            set((s) => ({
              messages: applyReaction(s.messages, reaction.seq, reaction.emoji, false),
            }));
            return;
          }
          // Edits replace the target body in place (idempotent on our own echo).
          const editSeq = parseEditTarget(m);
          if (editSeq) {
            set((s) => ({ messages: applyEdit(s.messages, editSeq, plainText(m.content)) }));
            return;
          }
          if (m.from && m.from === myUid) return; // own bubbles are optimistic
          // Anon topics blank `From`, so also drop the echo of our own message
          // by the seq we recorded when sending (prevents the double-render).
          if (m.seq && ownAnonSeqs.has(m.seq)) return;
          const msg = inboundMsg(m, false);
          set((s) => ({ messages: upsertMsg(s.messages, msg) }));
          // Delivered + read receipts so the SENDER's ticks advance (BUG-38).
          // Anon topics carry no P bit but recv/read notes ride the S access.
          client.noteRecv(topic, m.seq);
          client.noteRead(topic, m.seq);
        },
        onTyping: (from) => {
          if (from && from === myUid) return;
          setAnonPeerActivity("typing");
        },
        onInfo: (info) => {
          // Track the peer's recv/read high-water marks and fold them onto our
          // own bubbles so ticks go ✓ → ✓✓ → read, same as the friend chat
          // (BUG-38). High-water + re-apply-on-send guards the fast-read race.
          const upto = info.seq ?? Number.POSITIVE_INFINITY;
          if (info.what === "recv") {
            anonPeerRecvSeq = Math.max(anonPeerRecvSeq, upto);
          } else if (info.what === "read") {
            anonPeerReadSeq = Math.max(anonPeerReadSeq, upto);
            anonPeerRecvSeq = Math.max(anonPeerRecvSeq, anonPeerReadSeq);
          } else {
            return;
          }
          set((s) => ({
            messages: applyOwnReceipts(s.messages, anonPeerRecvSeq, anonPeerReadSeq),
          }));
        },
      });
    },

    sendAnonMessage: async (text, reply) => {
      const match = get().activeMatch;
      const body = text.trim();
      if (!match || !body) return;
      const mock = getCompanionClient().isMock();
      const tmpId = nextTmpId();
      const optimistic: TinodeMessageLite = {
        id: tmpId,
        mine: true,
        text: body,
        replyTo: reply,
        ts: Date.now(),
        status: mock ? "sent" : "sending",
      };
      set((s) => ({ messages: [...s.messages, optimistic] }));
      if (mock) return; // local echo only (no live topic)
      try {
        const content = reply ? buildReplyContent(body, reply) : body;
        const seq = await getTinodeClient().sendMessage(match.topic, content);
        if (seq) ownAnonSeqs.add(seq); // so our own echo (blanked From) is ignored
        // Reconcile, then fold in any receipts that landed before the ack (BUG-38).
        set((s) => ({
          messages: applyOwnReceipts(
            reconcileTmp(s.messages, tmpId, seq),
            anonPeerRecvSeq,
            anonPeerReadSeq,
          ),
        }));
      } catch {
        // Leave it "sending" so the user sees it didn't confirm.
      }
    },

    sendAnonMedia: async (up, kind, extra, opts) => {
      const match = get().activeMatch;
      if (!match) return;
      const mock = getCompanionClient().isMock();
      const viewOnce = Boolean(opts?.viewOnce) && kind === "image";
      const tmpId = nextTmpId();
      const optimistic: TinodeMessageLite = {
        id: tmpId,
        mine: true,
        text: "",
        media: [mediaPartFrom(up, kind, extra)],
        viewOnce: viewOnce || undefined,
        ts: Date.now(),
        status: mock ? "sent" : "sending",
      };
      set((s) => ({ messages: [...s.messages, optimistic] }));
      if (mock) return; // local echo only (no live topic)
      try {
        const draft = viewOnce ? buildViewOnceDraft(up, extra) : buildMediaDraft(kind, up, extra);
        const seq = await getTinodeClient().sendMessage(match.topic, draft);
        if (seq) ownAnonSeqs.add(seq); // so our own echo (blanked From) is ignored
        set((s) => ({
          messages: applyOwnReceipts(
            reconcileTmp(s.messages, tmpId, seq),
            anonPeerRecvSeq,
            anonPeerReadSeq,
          ),
        }));
        // Best-effort media-asset tracking. View-once photos are ephemeral so the
        // companion can GC them after viewing. Fire-and-forget; files not tracked.
        if (kind !== "file") {
          void getCompanionClient().trackMedia({
            topic: match.topic,
            kind,
            url: up.url,
            ephemeral: viewOnce || undefined,
          });
        }
      } catch {
        // Leave it "sending" so the user sees it didn't confirm.
      }
    },

    notifyAnonTyping: () => {
      const match = get().activeMatch;
      if (match && !getCompanionClient().isMock()) getTinodeClient().sendTyping(match.topic);
    },

    sendAnonReaction: async (seq, emoji) => {
      const match = get().activeMatch;
      if (!match || !seq) return;
      set((s) => ({ messages: applyReaction(s.messages, seq, emoji, true) }));
      if (getCompanionClient().isMock()) return;
      try {
        await getTinodeClient().sendReaction(match.topic, seq, emoji);
      } catch {
        // Optimistic pill stays; the peer just won't see it.
      }
    },

    editAnonMessage: async (seq, text) => {
      const match = get().activeMatch;
      const body = text.trim();
      if (!match || !seq || !body) return;
      set((s) => ({ messages: applyEdit(s.messages, seq, body) }));
      if (getCompanionClient().isMock()) return;
      try {
        await getTinodeClient().editMessage(match.topic, seq, body);
      } catch {
        // Local edit stays; not confirmed to the peer.
      }
    },

    deleteAnonMessage: async (seq, hard) => {
      const match = get().activeMatch;
      if (!match || !seq) return;
      set((s) => ({ messages: applyDelete(s.messages, seq, hard) }));
      if (getCompanionClient().isMock()) return;
      try {
        await getTinodeClient().deleteMessage(match.topic, seq, hard);
      } catch {
        // Local removal stays even if the server call failed.
      }
    },

    markAnonViewed: (seq) =>
      set((s) => (s.anonViewed[seq] ? s : { anonViewed: { ...s.anonViewed, [seq]: true } })),

    requestReveal: async () => {
      const match = get().activeMatch;
      if (!match) return;
      // Asking again clears a previous decline: that notice describes the last
      // answer, and there is now a newer question outstanding.
      set(
        get().anonRevealState === "declined"
          ? { anonRevealPending: true, anonRevealState: "none" }
          : { anonRevealPending: true },
      );
      try {
        await getCompanionClient().reveal(match.topic);
      } catch (err) {
        // Nothing was recorded server-side, so drop the optimistic "waiting"
        // state. Left set, the button stays on «Ожидание…» for the rest of the
        // match with no request actually pending — and nothing else clears it,
        // since only a match transition does.
        set({ anonRevealPending: false });
        // 409 on this route is `reveal_asks_exhausted`: both asks in this match
        // have been used and declined, so further requests are refused for the
        // rest of the chat. That is a SETTLED answer — record it and swallow,
        // rather than rethrowing into the screen's «Попробуйте ещё раз», which
        // would invite a retry that can never succeed.
        if (err instanceof CompanionHttpError && err.status === 409) {
          set({ anonRevealAsksLeft: 0 });
          return;
        }
        // Rethrown so the screen can surface a genuinely retryable failure.
        throw err;
      }
    },

    respondReveal: async (accept) => {
      const match = get().activeMatch;
      if (!match) return;
      const prev = get().anonRevealState;
      // Clear the prompt; on accept the `revealed` event flips the chat.
      set({ anonRevealState: "none" });
      try {
        await getCompanionClient().revealRespond(match.topic, accept);
      } catch (err) {
        // The answer never landed, so put the peer's request back instead of
        // swallowing it: the card is the only place that request is shown, and
        // dismissing it here would lose it for good while the peer keeps waiting.
        set({ anonRevealState: prev });
        throw err;
      }
    },

    rateMatch: async (rating) => {
      const match = get().activeMatch;
      if (!match) return;
      await getCompanionClient().rate(match.topic, rating);
    },

    endMatch: async () => {
      const match = get().activeMatch;
      if (!match) return;
      // Tell the peer we're leaving before ending the match server-side, so
      // their chat ends with a "собеседник покинул" line (BUG-15).
      signalLeave(match.topic);
      await getCompanionClient().end(match.topic);
      if (anonUnsub) {
        anonUnsub();
        anonUnsub = null;
      }
      set({ queue: { status: "idle" } });
    },

    closeAnon: () => {
      // Real leave point (see AnoonAnonChat) — tell the peer before we detach so
      // their side ends with the "собеседник покинул" line (BUG-15). Idempotent
      // with endMatch's own signal via `leftSignaled`.
      const topic = get().activeMatch?.topic;
      signalLeave(topic);
      // Tell the SERVER we walked out too, which used to happen only through
      // endMatch. That gap is why a revealed pairing stayed the caller's
      // "current match" forever: leaving a revealed chat goes through here, and
      // here wrote nothing — so GET /roulette/status kept answering with it and
      // the client needed a guard to ignore its own backend. POST /roulette/end
      // now records the leave whatever the chat's status (companion #24), while
      // still refusing to end a revealed pairing's row. Fire-and-forget: this is
      // a synchronous store action and a failed leave must not block the UI from
      // closing — the next enqueue records it anyway (EndActiveMatchesForUser).
      if (topic && !getCompanionClient().isMock()) {
        void getCompanionClient()
          .end(topic)
          .catch(() => {
            /* best-effort; see above */
          });
      }
      if (anonUnsub) {
        anonUnsub();
        anonUnsub = null;
      }
      if (typingTimer) {
        clearTimeout(typingTimer);
        typingTimer = null;
      }
      set({
        activeMatch: null,
        messages: [],
        peerTyping: false,
        anonRevealState: "none",
        anonRevealPending: false,
        anonRevealAsksLeft: null,
        anonPeerLeft: false,
        queue: { status: "idle" },
      });
    },

    setPeerRequestedReveal: () => set({ anonRevealState: "peer_requested" }),

    resyncAnonReveal: async () => {
      const match = get().activeMatch;
      if (!match || getCompanionClient().isMock()) return;
      const status = await fetchRouletteStatus();
      const reveal = status?.reveal;
      if (!reveal) return;
      // The chat may have moved on while the request was in flight.
      const now = get();
      if (now.activeMatch?.topic !== match.topic) return;
      // Independent of `reveal` — see the field's doc comment for why the two
      // deliberately disagree right after a re-ask.
      if (typeof status?.revealAsksLeft === "number") {
        set({ anonRevealAsksLeft: status.revealAsksLeft });
      }
      // Never walk back a completed reveal — and never apply `revealed` FROM the
      // poll. That payload carries no #ID and no display name (correctly: those
      // are exactly what the anon phase withholds), so honouring it would flip
      // the chat to «Профили открыты» with nothing to render and no friend row —
      // the same fabrication this wave has been removing, just sourced from a
      // poll instead of a catch block. The `revealed` frame stays the only
      // source of identity.
      if (now.anonRevealState === "revealed" || reveal === "revealed") return;
      switch (reveal) {
        case "none":
          set({ anonRevealState: "none", anonRevealPending: false });
          break;
        case "we_requested":
          set({ anonRevealState: "none", anonRevealPending: true });
          break;
        case "peer_requested":
          set({ anonRevealState: "peer_requested", anonRevealPending: false });
          break;
        case "declined":
          set({ anonRevealState: "declined", anonRevealPending: false });
          break;
      }
    },

    applyRevealDeclined: (topic) => {
      const s = get();
      // Ignore a decline for anything but the chat we are actually in — a late
      // frame from a previous match must not disturb this one.
      if (s.activeMatch?.topic !== topic) return;
      // Never let a decline undo a completed reveal. If `revealed` and a stale
      // `reveal_declined` cross on the wire, the reveal is the one that happened.
      if (s.anonRevealState === "revealed") return;
      set({ anonRevealState: "declined", anonRevealPending: false });
    },

    applyRevealed: (peerHashId, peerDisplayName) => {
      const match = get().activeMatch;
      set({
        anonRevealState: "revealed",
        anonRevealPending: false,
        activeMatch: match ? { ...match, peerHashId, peerDisplayName } : match,
      });
      // Promote the revealed peer into the friends list.
      if (match) {
        get().upsertFriend({
          id: match.topic,
          // peerHashId already carries its own leading "#" (companion sends
          // "#00012") — strip before re-prefixing, matching AnoonAnonChat's guard,
          // else the friend row renders "##00012".
          hashId: "#" + peerHashId.replace(/^#/, ""),
          displayName: peerDisplayName,
          avatarTone: toneFor(peerHashId),
          online: true,
          topic: match.topic,
          lastActiveAt: Date.now(),
        });
      }
    },
  };
};

export const createRouletteSlice: Slice<RouletteSlice> = (set, get) => {
  // The companion event-stream unsubscribe handle lives in the closure.
  let eventsUnsub: (() => void) | null = null;

  /**
   * When our own most recent enqueue was ACKNOWLEDGED (epoch ms; 0 = never).
   *
   * The searching screen mounts and starts polling the moment the user taps
   * «Начать чат» — before the enqueue POST it triggered has come back. That
   * first poll legitimately answers "not queued, no match", because we are
   * genuinely not in the queue yet, and the self-heal below read it as "the
   * companion forgot me" and enqueued a second time. Two enqueues for one
   * search paired the same two people twice, on two topics, and the two sides
   * ended up in different chats (seen live: companion logged
   * `matched #00011 <-> #00012` twice inside one second).
   *
   * So the self-heal only trusts a status snapshot that was REQUESTED after our
   * own enqueue was acknowledged — the only snapshots that can distinguish
   * "forgotten" from "not asked yet".
   */
  let enqueueAckedAt = 0;

  /**
   * The single place both match-delivery paths converge on: the `matched` WS
   * event and the REST resync poll (see resyncRouletteMatch). Idempotent — a
   * second arrival for a topic we already hold is dropped, so the poll racing
   * the event can never double-navigate or re-open the chat.
   */
  const applyMatched = (ev: MatchedEvent) => {
    const state = get();
    if (state.activeMatch?.topic === ev.topic) return;
    if (state.queue.status === "matched" && state.queue.match.topic === ev.topic) return;
    const match: RouletteMatch = {
      matchId: ev.topic,
      topic: ev.topic,
      peerGender: "female",
      peerAgeRange: ev.peerAgeRange,
      // Anon phase: the peer has an alias and no #ID. peerHashId stays undefined
      // until applyRevealed fills it in, which is what keeps add-friend / block
      // by #ID / call-a-friend from being reachable before a mutual reveal.
      peerAlias: ev.peerAlias,
      peerOnline: true,
      startedAt: Date.now(),
    };
    set({ queue: { status: "matched", match } });
    void get().openAnonChat(match);
  };

  return {
    queue: { status: "idle" },
    setQueue: (queue) => set({ queue }),

    joinQueue: async (prefs) => {
      set({ queue: { status: "searching", since: Date.now() } });
      // Cleared first: an ack from a PREVIOUS search would let the self-heal act
      // on a poll that overtook this search's own (slow) enqueue.
      enqueueAckedAt = 0;
      try {
        await getCompanionClient().enqueue(prefs);
        enqueueAckedAt = Date.now();
        // The `matched` event (real or mock) drives the transition to "matched".
      } catch (err) {
        // Refused (suspended account, rate limit): we are not in the queue, so
        // do not leave the UI believing we are searching — no `matched` event is
        // ever coming. Rethrown so the screen can bail out of the search.
        set({ queue: { status: "idle" } });
        throw err;
      }
    },

    leaveQueue: async () => {
      await getCompanionClient().cancel();
      set({ queue: { status: "idle" } });
    },

    resyncRouletteMatch: async () => {
      // Only meaningful while we believe we're waiting; anything else is
      // already past the point a missed `matched` event could hurt.
      if (get().queue.status !== "searching") return;
      // Stamped BEFORE the request: a snapshot is only evidence about a state
      // that already existed when it was asked for. See enqueueAckedAt.
      const askedAt = Date.now();
      const status = await fetchRouletteStatus();
      // A snapshot older than our own enqueue describes a search we had not
      // started yet — it can only mislead, in BOTH directions: its "not queued"
      // reads as "the queue forgot me" (→ a second enqueue, → the same two
      // people paired twice) and its `match` is whatever pairing we were in
      // BEFORE this search, which enqueue itself is about to end (→ the anon
      // chat reopens on a dead topic while the peer is in the new one). Wait for
      // a snapshot that can actually answer the question we are asking.
      if (enqueueAckedAt === 0 || askedAt < enqueueAckedAt) return;
      // Not matched AND not in the queue, while this client believes it is
      // searching: re-enqueue. The companion's queue is in memory (see
      // internal/matchmaker — persisting it is part of the multi-instance work),
      // so a restart empties it silently and every searcher waits forever for a
      // `matched` that nobody will ever produce. The poll already runs; asking
      // it to notice "the server does not think I am in line" costs one extra
      // branch and turns a permanent hang into a ≤2s gap.
      //
      // Guarded on `status` being non-null: a failed poll returns null, and
      // "could not read" is not "you are not queued" — re-enqueueing on that
      // would hammer a struggling backend.
      if (status && !status.match && !status.queued) {
        const prefs = getCompanionClient().getLastPrefs();
        if (!prefs) return;
        try {
          await getCompanionClient().enqueue(prefs);
          enqueueAckedAt = Date.now();
        } catch {
          // Refused (banned, rate-limited): there is no queue to wait in and no
          // event coming, so leave the search rather than spin — same reasoning
          // as joinQueue's own catch.
          set({ queue: { status: "idle" } });
          get().showError("Поиск прерван. Попробуйте начать заново");
        }
        return;
      }
      if (!status?.match) return;
      // DO NOT REMOVE — branch on `reveal`, never on `match != null`.
      //
      // `match != null` does not mean "a new anonymous pairing". A revealed
      // pairing's row is never ended (the pair keep using that topic as
      // friends, and Match.Anon() keys off status), so it stays a candidate for
      // "current match" — the server now drops it once the caller records a
      // leave (companion migration 0014: closeAnon and re-enqueueing both write
      // one), but the row is still what the endpoint answers with in the window
      // before that, and any client whose leave never reached the backend sees
      // it for longer.
      //
      // Without this line, starting a fresh search could resync that revealed
      // pairing and reopen it as an anon chat: re-anonymising someone already
      // revealed and hijacking the new search. applyMatched's own guards do not
      // catch it — activeMatch is null after leaving, and the queue reads
      // "searching", not "matched".
      //
      // Skipping costs nothing: while the only thing on offer is the revealed
      // row there is no new match to heal to, and once a real match exists the
      // endpoint returns that one instead and healing resumes.
      if (status.reveal === "revealed") return;
      // The WS event may have landed while the request was in flight —
      // applyMatched is idempotent, but re-check so we don't clobber a state
      // that moved on (e.g. the user cancelled).
      if (get().queue.status !== "searching") return;
      applyMatched(status.match);
    },

    startCompanionEvents: () => {
      if (eventsUnsub) return;
      const companion = getCompanionClient();
      eventsUnsub = companion.onEvent((e) => {
        switch (e.type) {
          case "matched":
            // Shared with the REST resync poll (resyncRouletteMatch) so both
            // paths produce exactly one transition — see applyMatched.
            applyMatched(e);
            break;
          case "reveal_request":
            get().setPeerRequestedReveal();
            break;
          case "reveal_declined":
            get().applyRevealDeclined(e.topic);
            break;
          case "revealed":
            get().applyRevealed(e.peerHashId, e.peerDisplayName);
            break;
          case "friend_request": {
            // `fromHashId` already carries a leading "#" (server FormatHashID) —
            // prefixing another one produced "##00011" everywhere (BUG-42).
            const h = e.fromHashId.startsWith("#") ? e.fromHashId : "#" + e.fromHashId;
            get().addRequest({
              id: h.replace(/^#/, ""),
              hashId: h,
              displayName: e.displayName,
              avatarTone: toneFor(e.fromHashId),
              direction: "incoming",
              createdAt: Date.now(),
            });
            break;
          }
          case "friend_accepted": {
            // The #ID request we sent was accepted. Add the friend WITH its p2p
            // topic (so the chat works) + surface a notification/sound — without
            // this the requester's Contacts stayed empty (BUG-42).
            const h = e.hashId.startsWith("#") ? e.hashId : "#" + e.hashId;
            const raw = h.replace(/^#/, "");
            // upsertFriend sets the real #ID; the me-merge preserves it via
            // `before`, and a reload repopulates from companion (BUG-43).
            get().upsertFriend({
              id: raw,
              hashId: h,
              displayName: e.displayName || h,
              avatarTone: toneFor(raw),
              topic: e.topic,
              online: e.online,
              lastActiveAt: Date.now(),
            });
            get().addNotification({
              id: `fa-${raw}-${Date.now()}`,
              kind: "friend_accepted",
              title: `${h} принял вашу заявку`,
              hashId: h,
              read: false,
              createdAt: Date.now(),
            });
            notifyOnce("message");
            break;
          }
        }
      });
      // Peer hard-delete relay (BUG-4): Tinode can't live-deliver {pres what:del}
      // to a friend session that attached under the anon pair-topic's P-less mode,
      // so the deleter's client relays a `msg:del` frame over the companion WS.
      // Tombstone it in the open chat + purge the SDK cache so a reopen's
      // cached-replay doesn't resurrect it.
      const frameUnsub = companion.onFrame((f) => {
        const fr = f as { type?: string; topic?: string; seqs?: number[]; kind?: string };
        if (!fr?.topic) return;

        // Peer-activity relay (BUG-18): the peer is typing / uploading media.
        // Route to whichever active chat is on that topic; the setter auto-clears.
        if (fr.type === "activity") {
          const activity = fr.kind === "media" ? "media" : "typing";
          if (get().activeChat?.topic === fr.topic) get().setPeerActivity(activity);
          if (get().activeMatch?.topic === fr.topic) get().setAnonPeerActivity(activity);
          return;
        }

        // Peer-left relay (BUG-15): the other member deliberately left this
        // anon/revealed chat. Inject the "собеседник покинул чат" system line
        // (contract B) into whichever active list is on that topic and mark the
        // chat ended. Idempotent — the *PeerLeft flag guards a repeat frame.
        if (fr.type === "peer:left") {
          const line = "Собеседник покинул чат";
          if (get().activeMatch?.topic === fr.topic && !get().anonPeerLeft) {
            set((s) => ({ messages: [...s.messages, systemMsg(line)], anonPeerLeft: true, peerTyping: false }));
          }
          if (get().activeChat?.topic === fr.topic && !get().chatPeerLeft) {
            set((s) => ({
              chatMessages: [...s.chatMessages, systemMsg(line)],
              chatPeerLeft: true,
              chatPeerTyping: false,
            }));
          }
          return;
        }

        if (fr.type !== "msg:del" || !Array.isArray(fr.seqs)) return;
        const client = getTinodeClient();
        for (const seq of fr.seqs) {
          if (typeof seq !== "number") continue;
          client.purgeCachedMessage(fr.topic, seq);
        }
        if (get().activeChat?.topic === fr.topic) {
          set((s) => ({
            chatMessages: fr.seqs!.reduce(
              (list, seq) => (typeof seq === "number" ? applyDelete(list, seq, true) : list),
              s.chatMessages,
            ),
          }));
        }
      });
      const onEventUnsub = eventsUnsub;
      eventsUnsub = () => {
        onEventUnsub?.();
        frameUnsub();
      };
      companion.connectEvents();
    },

    stopCompanionEvents: () => {
      eventsUnsub?.();
      eventsUnsub = null;
    },

    reconnectCompanionEvents: () => {
      // The listener registration (eventsUnsub) stays put — only the socket
      // needs redoing so it re-authenticates with the now-set session token.
      const companion = getCompanionClient();
      companion.disconnectEvents();
      companion.connectEvents();
    },
  };
};

export const createNotificationsSlice: Slice<NotificationsSlice> = (set) => ({
  notifications: [],
  unreadCount: 0,
  setNotifications: (items) =>
    set({ notifications: items, unreadCount: items.filter((n) => !n.read).length }),
  addNotification: (item) =>
    set((s) => {
      const notifications = [item, ...s.notifications];
      return { notifications, unreadCount: notifications.filter((n) => !n.read).length };
    }),
  markRead: (id) =>
    set((s) => {
      const notifications = s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
      return { notifications, unreadCount: notifications.filter((n) => !n.read).length };
    }),
  markAllRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),
});

export const createWalletSlice: Slice<WalletSlice> = (set) => ({
  tier: "free",
  coins: 0,
  setTier: (tier) => set({ tier }),
  setCoins: (coins) => set({ coins }),
  addCoins: (delta) => set((s) => ({ coins: s.coins + delta })),
});
