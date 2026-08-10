/**
 * Client for our own "companion" service (Go) — see BUILD-PLAN.md "Фронт ↔ Companion".
 * Owns login/OAuth, roulette matchmaking, friends, reports, money and the realtime
 * anoon event stream. The actual chat transport is Tinode (`./tinode.ts`).
 *
 * REST + a WebSocket event stream, both **browser-only** (never touch `window` /
 * open sockets at module scope or during SSR — see connectEvents' guard). Built
 * against the exact contract the backend agent implements:
 *
 *   REST : POST /auth/register {login, password, gender, age?} → {tinodeUid, hashId, hashIdNum, gender}
 *          POST /roulette/enqueue {ownAgeRange, peerAgeRanges[]}
 *          POST /roulette/cancel
 *          POST /roulette/end    {topic}
 *          POST /roulette/rate   {topic, rating}
 *          POST /roulette/reveal {topic}
 *          POST /roulette/reveal/respond {topic, accept}
 *          GET  /friends
 *          POST /friends/request {hashId}
 *          POST /friends/respond {hashId, accept}
 *          GET  /friends/search?q=
 *          GET  /me                (profile / #ID)
 *   WS   : matched {topic, peerAlias, peerAgeRange}
 *          reveal_request {topic, fromAlias}
 *          revealed {topic, peerHashId, peerDisplayName}
 *          friend_request {fromHashId, displayName}
 *
 * Anon-phase frames carry a per-match pseudonym («~K7X2QM»), never the peer's
 * real #ID — that arrives only in `revealed`, once both sides have consented.
 *
 * The companion `:6062` is not built yet. Until it is, every call transparently
 * falls back to an in-memory **mock driver** that emits the same contract-shaped
 * events on timers, so the whole roulette flow is demoable with no backend. Once
 * the service is live, the same code hits the real endpoints (the first successful
 * REST call clears mock mode).
 *
 * Env: NEXT_PUBLIC_COMPANION_URL (default http://127.0.0.1:6062 — NOT
 *      `localhost`: it resolves to `::1` first, and Docker's IPv6 port relay on
 *      this stack accepts the TCP connection and then never answers, so every
 *      call hangs instead of failing).
 *      NEXT_PUBLIC_SAME_ORIGIN ("1" = single-origin / phone-test mode).
 *
 * Same-origin mode (NEXT_PUBLIC_SAME_ORIGIN=1): the whole stack sits behind ONE
 * reverse proxy (see server-stack/Caddyfile) so the browser only ever talks to
 * its own origin. The REST base becomes the relative path `/api`, and the event
 * WebSocket is derived from `window.location` as `wss://<host>/api/ws` (ws:// on
 * plain http). This is what makes the app work behind a Cloudflare Tunnel whose
 * URL changes every restart — nothing is hard-coded to a host. Flag off (default)
 * keeps the classic absolute `http://localhost:6062` behavior for local dev.
 */
import { USE_TINODE } from "@/lib/tinode";
import type {
  CompanionEvent,
  Friend,
  FriendSearchResult,
  GoogleAuthResult,
  MatchedEvent,
  User,
} from "@/types/companion";

/** Single-origin mode: talk to the reverse proxy on relative same-origin paths. */
const SAME_ORIGIN = process.env.NEXT_PUBLIC_SAME_ORIGIN === "1";

/**
 * Base REST origin of the companion service. In same-origin mode this is the
 * relative prefix `/api` (the proxy strips it before hitting companion); `fetch`
 * resolves it against the current page origin, so the tunnel URL is irrelevant.
 */
export const COMPANION_URL = SAME_ORIGIN
  ? "/api"
  : process.env.NEXT_PUBLIC_COMPANION_URL ?? "http://127.0.0.1:6062";

/** Derive the ws(s):// origin for the event socket from the http(s):// base. */
function wsOrigin(httpBase: string): string {
  return httpBase.replace(/^http/, "ws");
}

/**
 * Absolute ws(s):// base for the event socket. In same-origin mode it is built
 * from `window.location` (wss when the page is https), so it automatically
 * follows the tunnel host; otherwise it derives from the absolute REST base.
 * Browser-only — call sites are already guarded against SSR.
 */
function eventsWsBase(restBase: string): string {
  if (SAME_ORIGIN) {
    const secure = window.location.protocol === "https:";
    return `${secure ? "wss" : "ws"}://${window.location.host}/api`;
  }
  return wsOrigin(restBase);
}

/** Listener for the realtime companion event stream. */
export type CompanionEventHandler = (event: CompanionEvent) => void;

/** Filters sent when joining the roulette queue. */
export interface RoulettePrefs {
  /** The local user's own age bucket (required, e.g. "22–25"). */
  ownAgeRange: string;
  /** Acceptable peer age buckets (empty = any). */
  peerAgeRanges: string[];
}

/**
 * Body of `GET /roulette/status` — the REST mirror of the `matched` event.
 *
 * The event socket is best-effort: a full send buffer, a reconnect, or a frame
 * arriving before the store attached its listener all drop `matched` on the
 * floor, leaving the client spinning on «Ищем собеседника…» while a perfectly
 * good match row exists. This endpoint is the resync path.
 */
export interface RouletteStatus {
  queued: boolean;
  match: MatchedEvent | null;
}

/** Body of `POST /auth/register` — companion creates the Tinode account itself. */
export interface RegisterInput {
  /** Basic-scheme username (derived from the email, see `tinodeLoginFromEmail`). */
  login: string;
  password: string;
  gender: "male" | "female";
  /** Optional self-reported age (13–120). */
  age?: number;
}

/** Response of a successful registration: the account's Tinode uid + new #ID. */
export interface RegisterResult {
  tinodeUid: string;
  /** Formatted public id, e.g. "#00042". */
  hashId: string;
  hashIdNum: number;
  gender: "male" | "female";
}

/**
 * Wire categories accepted by `POST /reports`. Distinct from the UI's Russian
 * reason labels and from the richer `ReportReason` view type — this is exactly
 * the enum the companion endpoint validates against.
 */
export type ReportCategory = "spam" | "abuse" | "sexual" | "illegal" | "other";

/**
 * Body of `POST /reports` — a moderation report filed against a peer.
 *
 * The target is named one of two ways, and reporting from an anonymous roulette
 * chat can only use the second: the client holds no #ID for an un-revealed peer,
 * by design. Companion resolves `topic` → match → the other member, which also
 * proves the reporter was in that conversation.
 */
export interface ReportInput {
  /** Real #ID of the reported peer (leading "#" optional). Omit in the anon phase. */
  reportedHashId?: string;
  category: ReportCategory;
  /** Anon/chat topic the report is filed from. Required when there is no #ID. */
  topic?: string;
  /** Free-text detail from the report form. */
  details?: string;
}

/** Response of a successful `POST /reports`. */
export interface ReportResult {
  /** Server-assigned report id. */
  id: string;
}

/** A peer on the signed-in user's block list (contract: `GET /friends/blocks`). */
/**
 * One purchasable item from companion's `products` table. The catalogue lives
 * in the database (migration 0016), so a price change is a row update — the
 * client ships no prices of its own beyond a fallback for when billing is off.
 */
export interface BillingProduct {
  /** Stable product code, e.g. "coins_150" / "premium_1m". */
  code: string;
  kind: "coins" | "sub";
  /** Paid tier this grants; `kind: "sub"` only. */
  tier?: "premium" | "super_premium";
  /** Subscription length in days; `kind: "sub"` only. */
  periodDays?: number;
  /** Coins granted; `kind: "coins"` only. */
  coins?: number;
  priceAmd: number;
}

/** One purchase attempt as companion reports it. */
export interface BillingOrder {
  id: string;
  productCode: string;
  provider: string;
  amountAmd: number;
  status: "new" | "pending" | "paid" | "failed" | "expired" | "refunded";
  createdAt: string;
  expiresAt: string;
  /** The provider's hosted payment page. Present only on the creation response. */
  payUrl?: string;
}

export interface BlockedFriend {
  hashId: string;
  displayName?: string;
  /** ISO timestamp of when the block was created, if the backend sends one. */
  blockedAt?: string;
}

/**
 * The UI's age-bucket labels use a typographic en dash ("18–21"); the
 * companion's wire format is a plain ASCII hyphen ("18-21") — see
 * `matchmaker.ValidAgeRanges` on the Go side. Normalize before sending so the
 * pretty label doesn't 400 as an unknown bucket.
 */
function toWireAgeRange(range: string): string {
  return range.replace(/–/g, "-");
}

/**
 * The backend answered, and said no. Distinct from a `fetch` rejection, which
 * means the backend was never reached at all — the difference decides whether a
 * failed call may quietly fall back to the mock driver (no backend running:
 * yes) or has to surface to the user (the request was genuinely rejected: no).
 * Collapsing the two is how a rejected report came to render a success sheet.
 */
export class CompanionHttpError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`companion ${path}: ${status}`);
    this.name = "CompanionHttpError";
  }
}

/** A short, opaque anonymous handle for a mock peer (digits only, no identity). */
function mockHandle(): string {
  return String(10000 + Math.floor(Math.random() * 89999));
}

/**
 * A mock per-match alias, in companion's «~K7X2QM» shape (same sigil and
 * ambiguity-free alphabet), so the demo renders what the real backend sends.
 */
const MOCK_ALIAS_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function mockAlias(): string {
  let out = "~";
  for (let i = 0; i < 6; i++) {
    out += MOCK_ALIAS_ALPHABET[Math.floor(Math.random() * MOCK_ALIAS_ALPHABET.length)];
  }
  return out;
}

/** Tiny in-memory directory backing offline friend-search demos. */
const MOCK_DIRECTORY: FriendSearchResult[] = [
  { hashId: "00042", displayName: "Лиса", avatarTone: 2, relation: "none" },
  { hashId: "00108", displayName: "Ворон", avatarTone: 0, relation: "none" },
  { hashId: "00256", displayName: "Сойка", avatarTone: 3, relation: "none" },
  { hashId: "00317", displayName: "Мила", avatarTone: 4, relation: "friends" },
  { hashId: "00777", displayName: "Оникс", avatarTone: 5, relation: "request_sent" },
];

/**
 * Bounds for {@link CompanionClient}'s outbound frame queue (see `sendRaw`).
 * Everything that rides this channel is realtime signaling — `call:offer`,
 * `call:ice`, `msg:del` — so a frame delivered half a minute late is worse
 * than one that's dropped: TTL'd rather than kept forever.
 */
const OUTBOX_TTL_MS = 10_000;
const OUTBOX_MAX = 64;

/**
 * Hard ceiling on a single companion REST call.
 *
 * `fetch` has no default timeout: a host that completes the TCP handshake and
 * then never answers leaves the promise pending forever, and every `await`
 * above it with it. That is the cross-origin login hang — `register()` /
 * `me()` never settled, `signInWithBasic` never reached its `catch`, and the
 * button sat on «Входим…» with no error anywhere, for any value of "wait
 * longer". A backend that cannot answer in 15s is down as far as the UI is
 * concerned; timing out turns the hang into a normal failure, which every
 * caller here already knows how to report.
 */
const REQUEST_TIMEOUT_MS = 15_000;

function mockDirectory(q: string): FriendSearchResult[] {
  const needle = q.trim().toLowerCase().replace(/^#/, "");
  if (!needle) return [];
  return MOCK_DIRECTORY.filter(
    (p) => p.displayName.toLowerCase().includes(needle) || p.hashId.includes(needle),
  );
}

/**
 * Thin fetch + WebSocket client. One instance per session; the zustand session
 * slice owns it and holds the bearer token.
 */
export class CompanionClient {
  private readonly baseUrl: string;
  private sessionToken: string | null = null;
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<CompanionEventHandler>();

  /** Pending WS auto-reconnect timer (exponential backoff), or null if none scheduled. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Backoff step for the next scheduled reconnect: delay is `min(1000 * 2^n, 30000)`ms. */
  private reconnectAttempt = 0;

  /**
   * True → every call is simulated locally instead of going to companion.
   *
   * Set at construction from the app's mode flag, not only after a failure.
   * Mock is a MODE: a build made with `NEXT_PUBLIC_USE_TINODE` off has no
   * business touching a backend at all. It used to start `false` even there, so
   * the standalone demo hit `http://localhost:6062` on the first report/friend
   * action and only fell into mock after the request failed — which on a
   * developer machine with companion running meant real network calls (and a
   * CORS error in the console) from a build that is supposed to be offline.
   *
   * In real mode it still flips to true when the backend proves unreachable —
   * but never on a backend that answered and refused (see CompanionHttpError).
   */
  private mock = !USE_TINODE;
  /** Pending mock timers, so cancel()/end() can clear them. */
  private readonly mockTimers = new Set<ReturnType<typeof setTimeout>>();
  /** The peer's mock #ID, revealed only when the mock reveal completes. */
  private mockPeer: string | null = null;
  /** The peer's mock per-match alias — the only handle the anon phase sees. */
  private mockPeerAlias: string | null = null;
  /** Guard so the demo seeds at most one incoming friend request per session. */
  private mockSeededFriendReq = false;
  /** Filters from the most recent {@link enqueue}, so the searching UI can echo them. */
  private lastPrefs: RoulettePrefs | null = null;

  constructor(baseUrl: string = COMPANION_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /** Whether we're currently running against the local mock (no live backend). */
  isMock(): boolean {
    return this.mock;
  }

  /** Set/clear the bearer token used for authenticated REST + WS calls. */
  setSessionToken(token: string | null): void {
    this.sessionToken = token;
  }

  /** Internal JSON fetch helper with auth header. Throws on network/HTTP error. */
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    // Mock MODE never touches the network. Every caller already handles "the
    // backend is unreachable" by simulating locally, so refusing here routes a
    // mock build down exactly that path — instead of firing a real request at
    // whatever happens to be listening on the developer's machine. That is not
    // hypothetical: with companion up on :6062, the standalone demo's report
    // button reached it and only fell back after the browser blocked the reply
    // on CORS, leaving a red error in the console of a build that is supposed
    // to be offline.
    if (!USE_TINODE) throw new Error(`companion: mock mode, no request for ${path}`);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        // Caller-supplied signal wins; otherwise nothing bounds the wait.
        signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          ...(this.sessionToken ? { Authorization: `Bearer ${this.sessionToken}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
    } catch (err) {
      // Rethrow the timeout with a message the UI can show verbatim — the raw
      // DOMException reads "signal timed out", which tells a user nothing.
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new Error(`Сервер не ответил за ${REQUEST_TIMEOUT_MS / 1000} с (${path})`);
      }
      throw err;
    }
    if (!res.ok) throw new CompanionHttpError(path, res.status);
    // A successful call means the backend is live — leave mock mode.
    this.mock = false;
    return (await res.json()) as T;
  }

  private post(path: string, body?: unknown): Promise<unknown> {
    return this.request(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /* ------------------------------ auth ------------------------------ */

  /**
   * Register a new account: companion creates the Tinode account itself (via
   * its ROOT connection) and allocates the #ID, returning the real `tinodeUid`
   * to log into next. Unauthenticated call — no session token needed/sent.
   * Rethrows on failure (flips to mock so the rest of the client reflects it)
   * so the caller can fall back to creating the Tinode account directly.
   */
  async register(input: RegisterInput): Promise<RegisterResult> {
    try {
      return await this.request<RegisterResult>("/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      });
    } catch (err) {
      this.mock = true;
      throw err;
    }
  }

  /**
   * Broker a Google sign-in (`POST /auth/oauth/google`). Companion verifies the
   * ID token with Google and answers `existing` for a returning user.
   *
   * `gender` is only consulted on a first sign-in, and companion refuses the
   * call without it — so the caller is expected to try once WITHOUT it and, on
   * a 400, ask the person and retry. That order is deliberate: a returning user
   * must never be asked again for something that is already set and cannot be
   * changed.
   *
   * Unauthenticated — no session token is sent or returned; the Tinode `rest`
   * login that follows is what mints one.
   */
  async oauthGoogle(
    idToken: string,
    gender?: "male" | "female",
    age?: number,
  ): Promise<GoogleAuthResult> {
    return this.request<GoogleAuthResult>("/auth/oauth/google", {
      method: "POST",
      body: JSON.stringify({ idToken, gender, age }),
    });
  }

  /**
   * Request a password-reset email. Contract (proposed, unconfirmed with BE):
   * `POST /auth/forgot {email}` → `{queued}`. Unauthenticated. SMTP delivery
   * is stubbed backend-side for now, so a `queued: true` reply doesn't
   * guarantee an email actually went out — just that the request landed.
   * Rethrows on failure so the form can show a real error state.
   */
  async requestPasswordReset(email: string): Promise<{ queued: boolean }> {
    return (await this.post("/auth/forgot", { email })) as { queued: boolean };
  }

  /**
   * Complete a password reset using the token from the emailed link.
   * Contract (proposed, unconfirmed with BE): `POST /auth/reset {token, newPassword}`.
   * Unauthenticated (the token itself is the credential). Rethrows on failure.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.post("/auth/reset", { token, newPassword });
  }

  /**
   * Request a verification email for the signed-in account. Contract
   * (proposed, unconfirmed with BE): `POST /auth/verify-email/send` → `{queued}`,
   * authed with the Bearer session token. Same SMTP-stub caveat as
   * {@link requestPasswordReset}. Rethrows on failure.
   */
  async requestEmailVerify(): Promise<{ queued: boolean }> {
    // Мок-режим: письма слать некому и незачем — «отправлено».
    if (this.mock) return { queued: true };
    return (await this.post("/auth/verify-email/send")) as { queued: boolean };
  }

  /**
   * Confirm email verification using the token from the emailed link.
   * Contract (proposed, unconfirmed with BE): `POST /auth/verify-email/confirm {token}`.
   * Rethrows on failure.
   */
  async confirmEmailVerify(token: string): Promise<void> {
    // Мок-режим: код проверять нечем и не о чем — считаем подтверждённым.
    // Без этой ветки экран «Подтвердите почту» становится тупиком в сборке без
    // бэкенда: кнопка отключена, пока поле пусто, а любой введённый код падает.
    if (this.mock) return;
    await this.post("/auth/verify-email/confirm", { token });
  }

  /* --------------------------- roulette --------------------------- */

  /** The roulette filters last passed to {@link enqueue} (for the searching UI). */
  getLastPrefs(): RoulettePrefs | null {
    return this.lastPrefs;
  }

  /**
   * Join the matchmaking queue. A `matched` event follows on the WS.
   *
   * **Rethrows when the backend refuses to enqueue**, same rule as
   * {@link reveal} and {@link report}. A refusal is not hypothetical: a
   * suspended account and a rate-limited one are both answered, not dropped.
   * Falling back to the mock there invented a match with a person who does not
   * exist — a banned user would be handed a stranger to talk to, which is
   * precisely what the ban withholds. An unreachable backend still mocks; that
   * is the no-backend showcase.
   */
  async enqueue(prefs: RoulettePrefs): Promise<void> {
    // Remember the chosen filters so AnoonSearching can display the real values.
    this.lastPrefs = prefs;
    try {
      await this.post("/roulette/enqueue", {
        ownAgeRange: toWireAgeRange(prefs.ownAgeRange),
        peerAgeRanges: prefs.peerAgeRanges.map(toWireAgeRange),
      });
    } catch (err) {
      if (err instanceof CompanionHttpError) throw err;
      // Backend down → demo the flow with a simulated match.
      this.mock = true;
      this.mockMatch(prefs);
    }
  }

  /** Leave the queue before a match. */
  async cancel(): Promise<void> {
    this.clearMockTimers();
    this.mockPeer = null;
    this.mockPeerAlias = null;
    try {
      await this.post("/roulette/cancel");
    } catch {
      /* mock queue already cleared above */
    }
  }

  /**
   * The caller's authoritative roulette state. Resync path for a `matched`
   * frame dropped by the best-effort event socket. Returns null in mock mode
   * or when the call fails, so a poller can just skip the tick.
   */
  async rouletteStatus(): Promise<RouletteStatus | null> {
    if (this.mock) return null;
    try {
      return await this.request<RouletteStatus>("/roulette/status");
    } catch {
      return null;
    }
  }

  /** End the active anon match on `topic`. */
  /**
   * Leave a chat: ends an active pairing and records the caller's departure
   * either way (companion #24 — a revealed match keeps its status but stops
   * being reported as the caller's current match).
   *
   * **Rethrows when the backend refuses.** A swallowed refusal leaves the
   * pairing open server-side while the UI has already closed it, so the next
   * `GET /roulette/status` still names that chat. Callers who genuinely cannot
   * act on the failure catch it themselves — see the store's `closeAnon`, which
   * is fire-and-forget on purpose because re-entering the queue records the
   * leave anyway.
   */
  async end(topic: string): Promise<void> {
    this.clearMockTimers();
    this.mockPeer = null;
    this.mockPeerAlias = null;
    try {
      await this.post("/roulette/end", { topic });
    } catch (err) {
      if (err instanceof CompanionHttpError) throw err;
      this.mock = true;
    }
  }

  /**
   * Block the peer of an anonymous roulette chat. Contract:
   * `POST /roulette/block {topic}`.
   *
   * Keyed by topic rather than #ID because the anon phase deliberately withholds
   * the peer's #ID — companion resolves topic → match → the other member, and
   * membership in that match is the authorization. The block lands in the same
   * `friendships` rows as {@link blockFriend}, so it shows up in the Settings
   * blacklist and feeds the matchmaker's exclude set exactly as before.
   *
   * **Rethrows when the backend rejects the block**, same rule as {@link report}
   * and {@link blockFriend}: a block that silently failed leaves the user
   * believing they are protected while the matcher can still pair them with the
   * person they blocked. An unreachable backend still falls back to the mock,
   * which is the no-backend showcase.
   */
  async blockAnonPeer(topic: string): Promise<void> {
    try {
      await this.post("/roulette/block", { topic });
    } catch (err) {
      if (err instanceof CompanionHttpError) throw err;
      this.mock = true;
    }
  }

  /** Rate the peer of a finished match (1–5). */
  async rate(topic: string, rating: number): Promise<void> {
    try {
      await this.post("/roulette/rate", { topic, rating });
    } catch {
      /* mock: no-op */
    }
  }

  /**
   * Ask to reveal profiles in the current anon chat.
   *
   * **Rethrows when the backend rejects the request**, same rule as
   * {@link report} and {@link blockAnonPeer}. Falling back to the mock on a
   * rejection fabricated a `revealed` event carrying a freshly invented #ID: the
   * chat announced «Профили открыты — вы теперь друзья», a person who does not
   * exist joined the friends list, and the real match stayed anonymous and live.
   * That is the mirror image of the leak the anon phase exists to prevent —
   * here the user is told the peer has seen them when the peer has not, and
   * behaves accordingly. An unreachable backend still falls back, which is the
   * no-backend showcase.
   */
  async reveal(topic: string): Promise<void> {
    try {
      await this.post("/roulette/reveal", { topic });
    } catch (err) {
      if (err instanceof CompanionHttpError) throw err;
      // Mock: simulate the peer accepting shortly after.
      this.mock = true;
      this.mockRevealed(topic);
    }
  }

  /**
   * Accept / decline a peer's reveal request. Rethrows a rejection for the same
   * reason as {@link reveal}: on accept, a fabricated `revealed` tells the user
   * their profiles have been exchanged when the server recorded no consent at
   * all. A decline that fails matters too — the peer is left waiting on an
   * answer that was never delivered — so it surfaces rather than passing for
   * done.
   */
  async revealRespond(topic: string, accept: boolean): Promise<void> {
    try {
      await this.post("/roulette/reveal/respond", { topic, accept });
    } catch (err) {
      if (err instanceof CompanionHttpError) throw err;
      if (accept) {
        this.mock = true;
        this.mockRevealed(topic);
      }
    }
  }

  /* ---------------------------- friends --------------------------- */

  /** List confirmed friends (chat happens over each friend's Tinode topic). */
  async friendsList(): Promise<Friend[]> {
    try {
      // Companion replies `{friends: [...]}`, not a bare array — unwrap it the
      // same way {@link friendsSearch} does (BUG-43).
      const res = await this.request<{ friends?: Friend[] } | Friend[]>("/friends");
      return Array.isArray(res) ? res : res?.friends ?? [];
    } catch (err) {
      // **Rethrows when the backend refuses.** An empty array is a claim — "you
      // have no friends" — and a refused read is not evidence for it. Returning
      // one wiped the list the user was looking at (a 401 on an expired session
      // showed an empty Contacts tab rather than "session expired"), and every
      // caller has no way to tell that apart from the real thing.
      if (err instanceof CompanionHttpError) throw err;
      this.mock = true;
      return [];
    }
  }

  /**
   * Send a friend request to a #ID.
   *
   * **Rethrows when the backend refuses**, same rule as {@link report} and
   * {@link blockFriend}: swallowing it turned every refusal — blocked by that
   * person, they no longer exist, rate limit — into the same silent "Заявка
   * отправлена" as a success, and the request the user believes is pending was
   * never created. An unreachable backend still no-ops into the mock.
   */
  async friendRequest(hashId: string): Promise<void> {
    try {
      await this.post("/friends/request", { hashId });
    } catch (err) {
      if (err instanceof CompanionHttpError) throw err;
      this.mock = true;
    }
  }

  /**
   * Accept / decline an incoming friend request. On accept the backend returns
   * the p2p chat `topic` (the requester's uid) so the caller can add the friend
   * with a working chat immediately — without it the chat opens topic-less and
   * messages go nowhere (BUG-42).
   */
  async friendRespond(
    hashId: string,
    accept: boolean,
  ): Promise<{ topic?: string; hashId?: string }> {
    try {
      const res = (await this.post("/friends/respond", { hashId, accept })) as {
        topic?: string;
        hashId?: string;
      };
      return res ?? {};
    } catch (err) {
      // **Rethrows when the backend refuses.** This one was the worst of the
      // swallowing set: an empty object reads as "accepted, just without a
      // topic", so the caller removed the request from the list and drew the
      // person as a friend — a friendship that exists on nobody's server. The
      // request is also gone from the UI, so there is nothing left to retry.
      if (err instanceof CompanionHttpError) throw err;
      this.mock = true;
      return {};
    }
  }

  /** Search users by #ID / nick (`q`). */
  async friendsSearch(q: string): Promise<FriendSearchResult[]> {
    try {
      const query = encodeURIComponent(q);
      // Companion replies `{results: [...]}`, not a bare array — unwrap it (a
      // raw array reached `rows.map` and threw, so search always showed empty).
      const res = await this.request<{ results?: FriendSearchResult[] } | FriendSearchResult[]>(
        `/friends/search?q=${query}`,
      );
      return Array.isArray(res) ? res : res?.results ?? [];
    } catch (err) {
      // A refusal must not answer with invented people. `/friends/search` is
      // rate-limited, so a 429 is reachable by simply typing quickly — and the
      // mock directory would then fill the results with strangers who do not
      // exist, offering to befriend them. Backend down is still the offline
      // showcase.
      if (err instanceof CompanionHttpError) throw err;
      this.mock = true;
      return mockDirectory(q);
    }
  }

  /* --------------------------- blocklist --------------------------- */

  /**
   * List peers the signed-in user has blocked. Contract: `GET /friends/blocks`
   * → `{blocks: [...]}` — unwrap it the same way {@link friendsSearch} unwraps
   * `{results}` (a bare array would also work if the backend ever sends one).
   * Empty list on failure, matching {@link friendsList}.
   */
  async listBlocks(): Promise<BlockedFriend[]> {
    try {
      const res = await this.request<{ blocks?: BlockedFriend[] } | BlockedFriend[]>(
        "/friends/blocks",
      );
      return Array.isArray(res) ? res : res?.blocks ?? [];
    } catch (err) {
      // **Rethrows when the backend refuses** — same reasoning as
      // {@link friendsList}, and it lands somewhere more sensitive: an empty
      // blacklist tells the user nobody is blocked, which is the one screen
      // where a wrong "nothing here" invites them to act on it.
      if (err instanceof CompanionHttpError) throw err;
      this.mock = true;
      return [];
    }
  }

  /**
   * Block a peer by #ID. Contract: `POST /friends/block {hashId}`, authed
   * with the Bearer session token. Rethrows on failure — unlike the softer
   * friend-request methods, a failed block should surface to the caller
   * rather than silently appear to succeed.
   */
  async blockFriend(hashId: string): Promise<void> {
    await this.post("/friends/block", { hashId });
  }

  /**
   * Unblock a previously-blocked peer. Contract: `DELETE /friends/block/{hashId}`.
   * Rethrows on failure, same reasoning as {@link blockFriend}.
   */
  async unblockFriend(hashId: string): Promise<void> {
    await this.request<unknown>(`/friends/block/${encodeURIComponent(hashId)}`, {
      method: "DELETE",
    });
  }

  /* ----------------------------- reports -------------------------- */

  /**
   * File a moderation report against a peer. Contract: `POST /reports`
   * `{ reportedHashId?, category, topic?, details? }` → `{ id }`, authed with
   * the existing Bearer session token.
   *
   * **Rethrows when the backend rejects the report.** It used to swallow every
   * failure and resolve with a synthetic id, so the sheet said «жалоба
   * отправлена» whether or not one had been filed — which is worse than a lost
   * report, because the user is told to stop worrying and never re-files, and
   * moderation never learns the conversation existed.
   *
   * An unreachable backend is a different thing and still falls back: that is
   * the no-backend showcase, where every other call mocks too and a red error
   * would be noise. A {@link CompanionHttpError} means companion answered and
   * said no — that always surfaces.
   */
  async report(input: ReportInput): Promise<ReportResult> {
    try {
      return (await this.post("/reports", input)) as ReportResult;
    } catch (err) {
      if (err instanceof CompanionHttpError) throw err;
      this.mock = true;
      return { id: `mock:report:${Date.now()}` };
    }
  }

  /* ------------------------------ me ------------------------------ */

  /** Fetch the signed-in user's profile / #ID. Null when the backend is down. */
  async me(): Promise<User | null> {
    try {
      return await this.request<User>("/me");
    } catch {
      return null;
    }
  }

  /* ---------------------------- billing ---------------------------- */

  /**
   * The purchasable catalogue (`GET /billing/products`).
   *
   * Null means "there is nothing to sell here": either no payment provider is
   * configured (companion does not mount /billing/* at all, so this 404s) or
   * the backend is unreachable. Both are the same thing to the wallet screen —
   * it falls back to showing the draft prices without offering to charge for
   * them. Deliberately not thrown: an absent catalogue is a normal state, not
   * an error the user did anything to cause.
   */
  async billingProducts(): Promise<BillingProduct[] | null> {
    try {
      const res = await this.request<{ products?: BillingProduct[] }>("/billing/products");
      return res.products ?? [];
    } catch {
      return null;
    }
  }

  /**
   * Open an order for a product code (`POST /billing/orders`) and get back the
   * provider's payment URL.
   *
   * Note what is NOT sent: an amount. The client names a product; companion
   * prices it from its own table. Rethrows — the user pressed a buy button, so
   * a failure has to be visible.
   */
  async createOrder(productCode: string): Promise<BillingOrder> {
    return await this.request<BillingOrder>("/billing/orders", {
      method: "POST",
      body: JSON.stringify({ productCode }),
    });
  }

  /**
   * Read one order's status (`GET /billing/orders/:id`).
   *
   * This is the ONLY thing that may be believed about a payment. Coming back
   * from the provider's page proves nothing — that redirect is a URL anyone can
   * type — so the screen polls this and waits for companion to say `paid`,
   * which it only does after the provider's signed callback settled the order.
   * Null on a failed poll: the next tick retries.
   */
  async orderStatus(id: string): Promise<BillingOrder | null> {
    try {
      return await this.request<BillingOrder>(`/billing/orders/${encodeURIComponent(id)}`);
    } catch {
      return null;
    }
  }

  /**
   * Best-effort delete of the signed-in user's companion-side row (contract:
   * `DELETE /me`). The endpoint isn't implemented on the backend yet, so any
   * failure (404, network, etc.) is swallowed — callers should proceed with
   * the Tinode-side account deletion regardless.
   */
  async deleteMe(): Promise<void> {
    try {
      await this.request<unknown>("/me", { method: "DELETE" });
    } catch {
      /* not implemented yet / already gone — proceed anyway */
    }
  }

  /* ----------------------------- media ----------------------------- */

  /**
   * Record a sent media attachment with the companion (contract: `POST /media`
   * `{topic, kind, url, ephemeral?, ttlSeconds?}` → 201, authed with the Bearer
   * session token). Purely a tracking side-channel (storage accounting /
   * ephemeral cleanup) — never throws, so a tracking failure can't derail
   * sending the actual message. No-ops immediately in mock mode (no live
   * backend to record against); logs and swallows on any other failure.
   */
  async trackMedia(input: {
    topic: string;
    kind: "image" | "video" | "audio";
    url: string;
    ephemeral?: boolean;
    ttlSeconds?: number;
  }): Promise<void> {
    if (this.mock) return;
    try {
      await this.post("/media", input);
    } catch (err) {
      console.warn("companion trackMedia failed", err);
    }
  }

  /* ------------------------- realtime events ---------------------- */

  /**
   * Open the realtime WebSocket to `/ws` for anoon events. Browser-only and
   * idempotent. A failed/closed socket silently leaves us in mock mode.
   *
   * Reconnect: an unexpected close (network blip, companion restart — as
   * opposed to a deliberate {@link disconnectEvents}/{@link disconnect} call)
   * schedules a reconnect with exponential backoff (1s, 2s, 4s… capped at
   * 30s), re-attaching with the current `sessionToken`. `onEvent`/`onFrame`
   * listeners live on the client instance, not the socket, so they keep
   * receiving frames across the reconnect with no extra wiring.
   */
  connectEvents(): void {
    if (typeof window === "undefined") return; // never during SSR
    if (this.socket) return;
    // POL-1: don't open (and 403-retry) the socket before login — there's no
    // token to authenticate with yet. `setSessionToken` + `reconnectCompanionEvents`
    // is what actually opens it once a real token exists.
    if (!this.sessionToken) return;
    this.clearReconnectTimer();
    let sock: WebSocket;
    try {
      const url = `${eventsWsBase(this.baseUrl)}/ws${
        this.sessionToken ? `?token=${encodeURIComponent(this.sessionToken)}` : ""
      }`;
      sock = new WebSocket(url);
    } catch {
      // Deliberately does NOT flip to mock — see sock.onerror below.
      this.scheduleReconnect();
      return;
    }
    sock.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data as string);
        // Fan out to raw-frame listeners first (e.g. callSignaling.ts's
        // `call:*` frames, which aren't part of the CompanionEvent union).
        this.emitFrame(frame);
        this.emit(frame as CompanionEvent);
      } catch {
        /* ignore malformed frame */
      }
    };
    sock.onopen = () => {
      this.mock = false;
      this.reconnectAttempt = 0;
      // Anything sendRaw() queued while we were down goes out now.
      this.flushOutbox();
    };
    sock.onerror = () => {
      // Deliberately does NOT flip to mock, even though a dead socket looks
      // like a dead backend. A WebSocket error carries no status: a refused
      // handshake (companion answering 403 because this origin is not on its
      // allowlist) is indistinguishable here from "nothing is listening" — and
      // the first case means the backend is very much alive. REST is the
      // honest signal, and `request()` already flips the flag both ways.
      //
      // This cost a full QA wave: with the local stack served through Caddy on
      // :8088 (an origin missing from companion's dev CORS default), every
      // socket 403'd, this line put a fully-working client into mock, and mock
      // makes `rouletteStatus()` return null without a request — killing the
      // very REST poll that exists to recover a dropped `matched` event. Both
      // users sat on «Ищем собеседника…» forever while their match sat in the
      // database, and 4.5s later the mock seeded them a friend request from a
      // person who does not exist. A socket that cannot connect only means no
      // realtime: reconnect (onclose does) and let REST speak for the backend.
    };
    sock.onclose = () => {
      // Ignore closes from a socket we've already superseded (a deliberate
      // disconnectEvents()/disconnect() nulls `this.socket` synchronously
      // before the browser fires this event) — only the *current* socket's
      // unexpected close should trigger a reconnect.
      if (this.socket !== sock) return;
      this.socket = null;
      this.scheduleReconnect();
    };
    this.socket = sock;
    // If no live backend answers, seed one incoming friend request so the
    // requests screen is demoable offline (fires once, untracked by mockTimers
    // so roulette cancel/end never clears it).
    setTimeout(() => {
      if (this.mock && !this.mockSeededFriendReq) {
        this.mockSeededFriendReq = true;
        const h = mockHandle();
        this.emit({ type: "friend_request", fromHashId: h, displayName: `Собеседник ${h}` });
      }
    }, 4500);
  }

  /**
   * Force-close the event socket so a subsequent {@link connectEvents} reopens
   * it — used right after `setSessionToken` so the WS re-authenticates with the
   * now-available token (it's normally idempotent and no-ops while one is open).
   * Listeners registered via {@link onEvent} are untouched — they're on this
   * client instance, not the socket, so events keep flowing across the swap.
   * This is a deliberate close, so it also cancels any pending auto-reconnect
   * backoff — the caller is expected to {@link connectEvents} again itself.
   */
  disconnectEvents(): void {
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.socket?.close();
    this.socket = null;
  }

  /** Schedule a reconnect attempt with exponential backoff (1s → 30s cap). */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return; // already scheduled
    if (!this.sessionToken) return; // logged out — nothing to reconnect for
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectEvents();
    }, delay);
  }

  /** Cancel a pending auto-reconnect, if any. */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Subscribe to all companion events. Returns an unsubscribe fn. */
  onEvent(handler: CompanionEventHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  /** Fan an event out to every listener. */
  private emit(event: CompanionEvent): void {
    this.listeners.forEach((l) => l(event));
  }

  /* ------------------------ raw frame plumbing --------------------- */
  /* Lower-level than {@link onEvent}: every parsed WS frame, regardless of  */
  /* shape, so modules like callSignaling.ts can ride the same socket for   */
  /* frame types outside the fixed CompanionEvent union (e.g. `call:*`).    */

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly frameListeners = new Set<(frame: any) => void>();

  /**
   * Frames handed to {@link sendRaw} while the socket wasn't OPEN, flushed on
   * the next `onopen`. Bounded + TTL'd by {@link OUTBOX_MAX}/{@link OUTBOX_TTL_MS}.
   */
  private readonly outbox: { payload: string; at: number }[] = [];

  /**
   * Send a raw JSON-serializable object over the event WebSocket.
   *
   * The socket is only OPEN between `onopen` and `onclose`; before that (still
   * CONNECTING right after login) and between an unexpected close and the next
   * backoff tick (1s…30s) it is not. This used to be a silent no-op in those
   * windows, which is the BUG-4/#121 failure mode: the caller believes it sent
   * a `call:offer`/`msg:del`, nothing reaches companion, and the peer just
   * never rings. So: queue instead of dropping, flush on open, and reopen the
   * socket immediately rather than waiting out the backoff — a call:offer that
   * sits for the remaining 30s of a backoff is a call that never rings.
   */
  sendRaw(obj: unknown): void {
    const payload = JSON.stringify(obj);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
      return;
    }
    this.outbox.push({ payload, at: Date.now() });
    this.pruneOutbox(Date.now());
    // Only when there's no socket at all — a CONNECTING one is already on its
    // way and connectEvents() would no-op against it anyway.
    if (!this.socket) this.connectEvents();
  }

  /**
   * Tell companion we just sent a message in a *p2p* friend chat (#31), so it
   * can push to the peer if they're offline.
   *
   * Only p2p chats need this. Anon and revealed roulette pairs live on a group
   * topic the ROOT bot watches, so companion already sees those messages itself
   * and pushes without being told — calling this for one of those would be the
   * double-notification bug, and companion drops such frames for that reason.
   *
   * Fire-and-forget: the peer is addressed by their `#ID` (p2p topics aren't
   * tracked as matches server-side, same as the `activity` ping), companion
   * verifies the friendship before pushing anything, and a peer who is online
   * gets the message natively over Tinode instead.
   */
  notifyMessageSent(to: string | null, topic: string, preview: string): void {
    if (!to || !topic || this.isMock()) return;
    this.sendRaw({ type: "msg:sent", to, topic, preview });
  }

  /** Drop queued frames past the TTL, then any excess over the cap (oldest first). */
  private pruneOutbox(now: number): void {
    while (this.outbox.length && now - this.outbox[0]!.at > OUTBOX_TTL_MS) this.outbox.shift();
    while (this.outbox.length > OUTBOX_MAX) this.outbox.shift();
  }

  /** Flush every still-fresh queued frame over the now-open socket. */
  private flushOutbox(): void {
    this.pruneOutbox(Date.now());
    const queued = this.outbox.splice(0, this.outbox.length);
    for (let i = 0; i < queued.length; i++) {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        // Socket died mid-flush — keep the remainder (in order) for next open.
        this.outbox.push(...queued.slice(i));
        return;
      }
      this.socket.send(queued[i]!.payload);
    }
  }

  /**
   * Subscribe to every inbound WS frame (parsed JSON, any shape). Used by
   * callSignaling.ts to observe `call:*` frames. Returns an unsubscribe fn.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onFrame(cb: (frame: any) => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  /** Fan a raw frame out to every {@link onFrame} listener. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private emitFrame(frame: any): void {
    this.frameListeners.forEach((l) => l(frame));
  }

  /* ------------------------------ push ------------------------------ */

  /** Fetch the VAPID public key used to create a browser push subscription. */
  async getVapidPublicKey(): Promise<string> {
    const { publicKey } = await this.request<{ publicKey: string }>("/push/vapid");
    return publicKey;
  }

  /** Register a browser push subscription with the companion backend. */
  async savePushSubscription(sub: PushSubscriptionJSON): Promise<void> {
    await this.post("/push/subscribe", sub);
  }

  /** Remove a previously-registered push subscription by its endpoint. */
  async removePushSubscription(endpoint: string): Promise<void> {
    await this.post("/push/unsubscribe", { endpoint });
  }

  /** Close the event socket + clear mock timers (logout / app close). */
  disconnect(): void {
    this.clearMockTimers();
    this.mockPeer = null;
    this.mockPeerAlias = null;
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.socket?.close();
    this.socket = null;
    this.listeners.clear();
    // Queued frames belong to the session we're leaving — never replay them
    // onto the next login's socket (see sendRaw).
    this.outbox.length = 0;
  }

  /* --------------------------- mock driver ------------------------ */
  /* Local simulation used only while the companion backend is unreachable,   */
  /* so the roulette flow is demoable end-to-end with no server running.      */

  private after(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.mockTimers.delete(t);
      fn();
    }, ms);
    this.mockTimers.add(t);
  }

  private clearMockTimers(): void {
    this.mockTimers.forEach(clearTimeout);
    this.mockTimers.clear();
  }

  /**
   * Simulate a match ~1.6s after enqueue, then a peer reveal request ~7s in.
   * The mock peer has two handles, the same way a real one does: an alias for
   * the anon phase and a #ID that only appears at reveal (see mockRevealed).
   */
  private mockMatch(prefs: RoulettePrefs): void {
    const peer = mockHandle();
    this.mockPeer = peer;
    const alias = mockAlias();
    this.mockPeerAlias = alias;
    const topic = `mock:anon:${peer}`;
    const peerAgeRange = prefs.peerAgeRanges[0];
    this.after(1600, () => {
      this.emit({ type: "matched", topic, peerAlias: alias, peerAgeRange });
      // Later the "peer" offers to reveal — demoes the incoming prompt path.
      this.after(7000, () => {
        if (this.mockPeer === peer) {
          this.emit({ type: "reveal_request", topic, fromAlias: alias });
        }
      });
    });
  }

  /** Simulate the peer accepting a reveal ~0.9s after we ask/accept. */
  private mockRevealed(topic: string): void {
    const peer = this.mockPeer ?? mockHandle();
    this.after(900, () => {
      this.emit({
        type: "revealed",
        topic,
        peerHashId: peer,
        peerDisplayName: `Собеседник ${peer}`,
      });
    });
  }
}

/** Lazily-created app-wide singleton. The session store owns its lifecycle. */
let singleton: CompanionClient | null = null;
export function getCompanionClient(): CompanionClient {
  if (!singleton) singleton = new CompanionClient();
  return singleton;
}

/* --------------------------- push (top-level) --------------------- */
/* Thin wrappers over the singleton so push.ts can import plain functions,   */
/* mirroring how callSignaling.ts uses getCompanionClient() directly.        */

/** Fetch the VAPID public key used to create a browser push subscription. */
export function getVapidPublicKey(): Promise<string> {
  return getCompanionClient().getVapidPublicKey();
}

/** Register a browser push subscription with the companion backend. */
export function savePushSubscription(sub: PushSubscriptionJSON): Promise<void> {
  return getCompanionClient().savePushSubscription(sub);
}

/** Remove a previously-registered push subscription by its endpoint. */
export function removePushSubscription(endpoint: string): Promise<void> {
  return getCompanionClient().removePushSubscription(endpoint);
}
