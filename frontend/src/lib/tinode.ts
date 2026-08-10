/**
 * Thin wrapper around `tinode-sdk` — the transport for actual chat, media, typing
 * and presence (see BUILD-PLAN.md "Фронт ↔ Tinode"). Everything else (login/OAuth,
 * roulette, friends, money) goes through the companion client (`./companion.ts`).
 *
 * Phase B1/B2: connect + basic account-create/login are wired for real against the
 * self-hosted server; topic subscribe/send/typing are still scaffold stubs (Phase C).
 *
 * Env: NEXT_PUBLIC_TINODE_WS (default ws://localhost:6061/v0/channels),
 *      NEXT_PUBLIC_TINODE_API_KEY, NEXT_PUBLIC_USE_TINODE ("1" = hit real server),
 *      NEXT_PUBLIC_SAME_ORIGIN ("1" = single-origin / phone-test mode).
 *
 * Same-origin mode (NEXT_PUBLIC_SAME_ORIGIN=1): ignore the absolute
 * NEXT_PUBLIC_TINODE_WS host and connect to the current page origin instead —
 * `wss://<window.location.host>/v0/channels` (ws:// on plain http). A reverse
 * proxy (server-stack/Caddyfile) forwards `/v0/*` to the real Tinode server, so
 * the app keeps working behind a Cloudflare Tunnel whose URL changes each run.
 * The tinode-sdk hardcodes its endpoint path to `/v0/channels`, so only the host
 * has to be swapped. Flag off (default) keeps the classic absolute-URL behavior.
 */
// Type-only import — erased at build time, so it never pulls the UMD into the
// server bundle. The runtime class is loaded lazily, browser-only (see below):
// the tinode-sdk UMD touches `window.location` and crashes during SSR.
import type { Tinode, TinodeCtrl, Topic } from "tinode-sdk";

/** Base Tinode WebSocket endpoint. */
// 127.0.0.1, not `localhost`: the latter resolves to `::1` first, and Docker's
// IPv6 port relay on this stack can accept the connection and then never
// answer — a socket that hangs instead of failing (see companion.ts's
// COMPANION_URL for the same trap on the REST side).
export const TINODE_WS_URL =
  process.env.NEXT_PUBLIC_TINODE_WS ?? "ws://127.0.0.1:6061/v0/channels";

/** API key the server accepts (default self-hosted/demo key). */
export const TINODE_API_KEY =
  process.env.NEXT_PUBLIC_TINODE_API_KEY ?? "AQEAAAABAAD_rAp4DJh05a1HAwFT3A6K";

/** Feature flag: when true, auth hits the real Tinode server instead of mocks. */
export const USE_TINODE = process.env.NEXT_PUBLIC_USE_TINODE === "1";

/** Single-origin mode: connect Tinode to the current page origin, not the abs host. */
const SAME_ORIGIN = process.env.NEXT_PUBLIC_SAME_ORIGIN === "1";

/**
 * Resolve the effective Tinode WS endpoint. In same-origin mode the absolute
 * `wsUrl` (its host) is discarded and rebuilt from `window.location`, keeping the
 * fixed `/v0/channels` path the SDK expects, so the connection follows whatever
 * host the page (and its reverse proxy / tunnel) is served from. Browser-only:
 * every caller runs behind {@link loadTinodeCtor}, which forbids SSR use.
 */
function effectiveWsUrl(wsUrl: string): string {
  if (SAME_ORIGIN && typeof window !== "undefined") {
    const secure = window.location.protocol === "https:";
    return `${secure ? "wss" : "ws"}://${window.location.host}/v0/channels`;
  }
  return wsUrl;
}

/** App name reported to the server; keep it stable for analytics. */
const APP_NAME = "anoon-web/0.1";

/**
 * Longest login the live server accepts. Observed, not documented: 26 chars
 * register fine, 27 gets `422 policy violation` — which companion surfaces as a
 * 502. See {@link tinodeLoginFromEmail}.
 */
const MAX_LOGIN = 26;

/**
 * Derive a Tinode `basic`-scheme username from an email. Deterministic, so the
 * same email always maps to the same login (register ↔ login must agree).
 *
 * Two server limits are folded in here, both measured against the running
 * backend rather than read off a doc — and both used to make registration
 * impossible rather than merely awkward:
 *
 *   • A HYPHEN is rejected (`422 policy violation`) even though it is a legal
 *     uname character, so `ivan-petrov@mail.ru` — an entirely ordinary address
 *     — could not create an account at all. It folds to `.` like `@` does.
 *   • Anything longer than {@link MAX_LOGIN} is rejected the same way.
 *
 * Truncation keeps a hash tail instead of just cutting: two long addresses that
 * share their first 26 characters are not the same person, and collapsing them
 * onto one login would hand the second one a "login taken" dead end.
 */
export function tinodeLoginFromEmail(email: string): string {
  const normalised = email.trim().toLowerCase();
  const login = normalised
    .replace(/[^a-z0-9_.]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  if (login.length <= MAX_LOGIN) return login;

  // djb2 over the full address — enough to separate neighbours, and stable
  // across reloads and devices, which `Math.random()` or a timestamp would not
  // be. 5 base-36 chars, so the head keeps 20 and stays recognisable.
  let hash = 5381;
  for (let i = 0; i < normalised.length; i++) hash = (hash * 33) ^ normalised.charCodeAt(i);
  const tail = (hash >>> 0).toString(36).slice(0, 5).padStart(5, "0");
  return `${login.slice(0, MAX_LOGIN - 6)}.${tail}`;
}

/** Split a `ws(s)://host:port/path` endpoint into the pieces the SDK wants. */
function parseEndpoint(wsUrl: string): { host: string; secure: boolean } {
  const secure = /^wss:/i.test(wsUrl);
  const host = wsUrl.replace(/^wss?:\/\//i, "").replace(/\/.*$/, "");
  return { host, secure };
}

/**
 * Lazily load the `tinode-sdk` runtime — **browser only**. Its UMD build reads
 * `window.location` at eval time, which throws during Next.js SSR, so we never
 * import it at module scope; it's pulled in on first use in the browser.
 */
let TinodeCtor: typeof import("tinode-sdk").Tinode | null = null;
async function loadTinodeCtor(): Promise<typeof import("tinode-sdk").Tinode> {
  if (typeof window === "undefined") {
    throw new Error("tinode-sdk is browser-only and was called during SSR");
  }
  if (!TinodeCtor) {
    TinodeCtor = (await import("tinode-sdk")).Tinode;
  }
  return TinodeCtor;
}

/** A decoded incoming chat message. Loosely typed until we pin the Drafty shape. */
export interface TinodeMessage {
  topic: string;
  /** Sender uid — BLANK on anon topics thanks to the server anonymity patch. */
  from?: string;
  /** Server sequence id, for read receipts / ordering. */
  seq: number;
  ts: number;
  /** Message content (plain string or Drafty document). */
  content: unknown;
  /**
   * Raw message head, if any. Two app-level conventions ride here (see
   * {@link parseEditTarget} / {@link parseReaction}): `{replace: ':<seq>'}`
   * for edits (mirrors the SDK's own `Topic#isReplacementMsg` convention) and
   * `{reaction: {seq, emoji}}` for reactions (app-invented — Tinode has no
   * native reaction concept). A message carrying `head.reaction` is NOT a
   * regular chat bubble; callers must check {@link parseReaction} first and
   * fold it onto the target message instead of rendering it inline.
   */
  head?: Record<string, unknown>;
}

/** Callbacks a caller can attach when subscribing to a topic. */
export interface TopicHandlers {
  onMessage?: (msg: TinodeMessage) => void;
  /** Peer typing / recording notifications (kp, recording…). */
  onTyping?: (from: string) => void;
  /** Read-receipt / delivery info for the topic (kp is filtered out to {@link onTyping}). */
  onInfo?: (info: { what: "recv" | "read" | "kp"; from?: string; seq?: number }) => void;
  onPresence?: (pres: unknown) => void;
  /** Decoded presence change (online/offline) — a friendlier view of {@link onPresence}. */
  onPres?: (pres: { online?: boolean; what?: string }) => void;
  /**
   * The peer hard-deleted these message seqs on this topic while we were
   * subscribed. Fired from the server's live `{pres what: "del"}` broadcast
   * (see `Topic#_routePres`/`_processDelMessages` in `tinode.dev.js`) — our own
   * {@link TinodeClient.deleteMessage} calls don't loop back here, only the
   * *other* party's hard delete does. Callers should drop/fold these seqs
   * out of their local message list.
   */
  onDelete?: (seqs: number[]) => void;
}

/** A p2p contact derived from the `me` topic (one row of the chats/friends list). */
export interface MeContact {
  /** p2p topic name = the peer's uid ("usrXXXX"). */
  topic: string;
  /** Peer display name from their public `fn`, if shared. */
  fn?: string;
  online: boolean;
  /** Unread count (seq − read). */
  unread: number;
  /** Unix ms of last activity, for sorting. */
  touched?: number;
}

/** Best-effort plain text out of a Tinode message body (string or Drafty doc). */
export function plainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && "txt" in content) {
    return String((content as { txt?: unknown }).txt ?? "");
  }
  return "";
}

/** Coerce a Tinode timestamp (Date | string | number) to unix ms. */
function toMs(ts: unknown): number {
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") return new Date(ts).getTime();
  return Date.now();
}

/**
 * Wrapper holding a single Tinode connection for the signed-in session. One
 * instance per app (see the zustand session slice, which will own it).
 */
export class TinodeClient {
  private tinode: Tinode | null = null;
  private readonly topics = new Map<string, Topic>();
  /**
   * In-flight `topic.leave()` promises, keyed by topic name. The SDK reuses one
   * Topic object per name, so when a view leaves a topic and another view
   * immediately re-opens the SAME topic (anon-chat → friend-chat on the shared
   * group topic after a reveal), the re-open can read a still-`subscribed` flag,
   * skip re-subscribe, and then have the in-flight leave detach it out from
   * under the new view — leaving publishes silently dropped. `subscribeTopic`
   * awaits any pending leave here first so it observes the settled state.
   */
  private readonly pendingLeaves = new Map<string, Promise<void>>();
  /** Account uid ("usrXXXX") once authenticated. */
  private uid: string | null = null;
  /**
   * True once a login has succeeded at least once this connection's lifetime.
   * Gates {@link handleReconnect} — the SDK's own socket fires `onConnect`
   * (hello succeeded) on the very first connect too, before the app has had a
   * chance to log in, and there's nothing to reauth/resubscribe yet then.
   */
  private hasSession = false;
  /** True while a reauth+resubscribe pass is in flight, to avoid overlap. */
  private reconnecting = false;
  /** Pending app-level reauth retry (see {@link scheduleReconnectRetry}), if any. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Next retry delay, doubled each failure and capped in {@link scheduleReconnectRetry}. */
  private reconnectBackoffMs = 1000;

  /** True once the WebSocket handshake completed. */
  isConnected(): boolean {
    return this.tinode?.isConnected() ?? false;
  }

  /** Authenticated account uid, or null before login. */
  getUid(): string | null {
    return this.uid;
  }

  /** Whether a contact (p2p topic) is currently online, per the SDK's cached presence. */
  getContactOnline(topic: string): boolean {
    return Boolean(this.tinode?.getTopic(topic)?.online);
  }

  /** Unix ms of a contact's last-seen time, or `null` if unknown/never tracked. */
  getContactLastSeen(topic: string): number | null {
    const when = this.tinode?.getTopic(topic)?.seen?.when;
    return when ? toMs(when) : null;
  }

  /**
   * A contact's avatar ref (`public.photo.ref`) as stored by the SDK, or `null`
   * if the contact has no photo set. Wrap the result in {@link authedFileUrl}
   * before handing it to an `<img>`.
   */
  avatarRefFor(topic: string): string | null {
    const ref = this.tinode?.getTopic(topic)?.public?.photo?.ref;
    return typeof ref === "string" ? ref : null;
  }

  /** Lazily build the Tinode instance bound to {@link wsUrl} (browser only). */
  private async ensure(wsUrl: string): Promise<Tinode> {
    if (!this.tinode) {
      const Ctor = await loadTinodeCtor();
      // In same-origin mode this swaps the abs host for window.location's host.
      const { host, secure } = parseEndpoint(effectiveWsUrl(wsUrl));
      this.tinode = new Ctor({
        appName: APP_NAME,
        host,
        apiKey: TINODE_API_KEY,
        transport: "ws",
        secure,
        persist: false,
      });
      this.tinode.enableLogging(process.env.NODE_ENV !== "production");
      // The SDK's own `Connection` already retries the raw socket forever
      // with its own (uncapped) exponential backoff and hardcoded
      // `autoreconnect: true` (see `tinode.dev.js`'s Tinode constructor) — it
      // even re-sends `hello` for us once the socket reopens. What it does
      // NOT do is re-login or re-subscribe anything, since the server has no
      // memory of this being "the same" client across a fresh connection.
      // `onConnect` fires after every successful hello, first-connect and
      // reconnect alike; {@link handleReconnect} is a no-op on the former
      // (gated on {@link hasSession}) and does the re-login/resubscribe work
      // on the latter.
      this.tinode.onConnect = () => {
        void this.handleReconnect();
      };
      // A fresh disconnect means any previously-scheduled app-level retry is
      // moot — the next successful reconnect will kick off its own pass via
      // onConnect. Left running, a stale timer could race a newer one.
      this.tinode.onDisconnect = () => {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };
    }
    return this.tinode;
  }

  /**
   * Open the WebSocket connection to Tinode. Idempotent — resolves immediately
   * if already connected. Reconnect after a drop is handled transparently —
   * see {@link handleReconnect}.
   * @param wsUrl override endpoint (defaults to {@link TINODE_WS_URL}).
   */
  async connect(wsUrl: string = TINODE_WS_URL): Promise<void> {
    const tinode = await this.ensure(wsUrl);
    if (tinode.isConnected()) return;
    await tinode.connect();
  }

  /**
   * Re-authenticate and re-attach every open subscription after the socket
   * reconnects post-drop. Runs off {@link Tinode.onConnect}, which the SDK
   * fires once `hello` succeeds on any connection — including its own
   * internal auto-reconnects after a network blip or server restart.
   *
   * Re-login reuses the last-issued session token ({@link getAuthToken}),
   * the same one handed to the companion — Tinode keeps it on the instance
   * across a drop, it's only the *authenticated* flag that resets. If reauth
   * itself fails (token expired, transient error), retries with our own
   * capped exponential backoff via {@link scheduleReconnectRetry} — separate
   * from the SDK's own (already-running) socket-level backoff, since the
   * socket is already back up at this point; only the app-level session
   * needs re-establishing.
   */
  private async handleReconnect(): Promise<void> {
    if (!this.hasSession || !this.tinode || this.reconnecting) return;
    const tinode = this.tinode;
    const token = tinode.getAuthToken()?.token;
    if (!token) return; // Nothing to reauth with — caller will have to re-login by hand.
    this.reconnecting = true;
    try {
      try {
        await tinode.loginToken(token);
      } catch {
        this.scheduleReconnectRetry();
        return;
      }
      // Re-attach `me` (if a view is following the contact list) and every
      // topic still open in {@link topics}. Each Topic instance survives the
      // drop — only its `subscribed` flag was reset (`Topic#_resetSub`) — so
      // the handlers wired by {@link subscribeMe}/{@link subscribeTopic} are
      // still in place; subscribing again is enough to resume delivery.
      const me = tinode.getMeTopic();
      if (me.onSubsUpdated) {
        try {
          await me.subscribe(me.startMetaQuery().withSub().withDesc().build());
        } catch {
          // Best-effort — the friends list will just be stale until it retries.
        }
      }
      for (const topic of this.topics.values()) {
        try {
          await topic.subscribe(topic.startMetaQuery().withLaterData(24).withDesc().build());
        } catch {
          // Best-effort per topic — one stuck view shouldn't block the rest.
        }
      }
      this.reconnectBackoffMs = 1000; // Reset now that a full pass succeeded.
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * Retry {@link handleReconnect} after a capped exponential backoff (1s, 2s,
   * 4s, … capped at 30s) when reauth itself failed. The socket is already
   * connected by the time we get here (this only runs from within
   * `onConnect`), so this is deliberately independent of the SDK's own
   * socket-reconnect backoff in `Connection#boffReconnect`.
   */
  private scheduleReconnectRetry(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.reconnectBackoffMs;
    this.reconnectBackoffMs = Math.min(this.reconnectBackoffMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.tinode?.isConnected()) void this.handleReconnect();
    }, delay);
  }

  /**
   * Create a `basic`-scheme account (login on success) directly on Tinode.
   * @param fn optional display name → stored as the account's public `fn`.
   * @returns the new account uid ("usrXXXX").
   */
  async createAccountBasic(
    login: string,
    password: string,
    fn?: string,
  ): Promise<string> {
    const tinode = await this.ensure(TINODE_WS_URL);
    if (!tinode.isConnected()) await tinode.connect();
    const params = fn ? { public: { fn } } : undefined;
    const ctrl = await tinode.createAccountBasic(login, password, params);
    return this.captureUid(ctrl);
  }

  /**
   * Log into an existing `basic`-scheme account directly on Tinode.
   * @returns the account uid ("usrXXXX").
   */
  async loginBasic(login: string, password: string): Promise<string> {
    const tinode = await this.ensure(TINODE_WS_URL);
    if (!tinode.isConnected()) await tinode.connect();
    const ctrl = await tinode.loginBasic(login, password);
    return this.captureUid(ctrl);
  }

  /**
   * Log in with the `rest` scheme, whose secret is a Google ID token. Tinode's
   * REST auth handler hands the secret to companion, which verifies it with
   * Google and — on a first sign-in — creates the account from the pending
   * registration row companion saved a moment earlier. So this one call is
   * both "sign in" and "finish signing up"; which of the two happened is
   * decided server-side, not here.
   *
   * @returns the Tinode account uid ("usrXXXX").
   */
  async loginRest(idToken: string): Promise<string> {
    const tinode = await this.ensure(TINODE_WS_URL);
    if (!tinode.isConnected()) await tinode.connect();
    const ctrl = await tinode.login("rest", idToken);
    return this.captureUid(ctrl);
  }

  /**
   * Authenticate with a token issued by the companion service after login.
   * @returns the Tinode account uid ("usrXXXX").
   */
  async loginToken(token: string): Promise<string> {
    const tinode = await this.ensure(TINODE_WS_URL);
    if (!tinode.isConnected()) await tinode.connect();
    const ctrl = await tinode.loginToken(token);
    return this.captureUid(ctrl);
  }

  /** Pull the uid out of an auth `{ctrl}` reply and remember it. */
  private captureUid(ctrl: TinodeCtrl): string {
    const uid = ctrl.params?.user;
    if (!uid) throw new Error("Tinode auth returned no user id");
    this.uid = uid;
    this.hasSession = true; // From here on, a reconnect should reauth + resubscribe.
    return uid;
  }

  /**
   * The current session's Tinode auth token (set by the SDK on a successful
   * login), for handing to the companion as its own session bearer — it
   * validates the token the same way (`ResolveToken`) for both REST and WS.
   * @returns the token string, or `null` before any login / once it expired.
   */
  getAuthToken(): string | null {
    return this.tinode?.getAuthToken()?.token ?? null;
  }

  /**
   * Subscribe to the `me` topic and stream the p2p contact list to `onContacts`
   * (fires on the initial fetch and on every later change). Returns unsubscribe.
   */
  async subscribeMe(onContacts: (contacts: MeContact[]) => void): Promise<() => void> {
    const tinode = await this.ensure(TINODE_WS_URL);
    // Guarantee the socket is live before subscribing — the caller may run right
    // after login (F7 flow) or on a later mount when the connection has dropped;
    // subscribing on a closed socket throws "Websocket is not connected".
    if (!tinode.isConnected()) await this.connect(TINODE_WS_URL);
    const me = tinode.getMeTopic();
    const emit = () => {
      const out: MeContact[] = [];
      // Each contact is a Topic instance: its name is the p2p peer uid, and it
      // carries `public`/`online`/`unread`/`touched`. Keep only p2p topics.
      me.contacts((c: Record<string, unknown>) => {
        const topic = String(c.name ?? "");
        if (!topic.startsWith("usr")) return;
        const pub = c.public as { fn?: string } | undefined;
        const unread =
          typeof c.unread === "number"
            ? c.unread
            : Math.max(0, Number(c.seq ?? 0) - Number(c.read ?? 0));
        out.push({
          topic,
          fn: pub?.fn,
          online: Boolean(c.online),
          unread,
          touched: c.touched ? toMs(c.touched) : undefined,
        });
      });
      onContacts(out);
    };
    me.onSubsUpdated = emit;
    if (!me.subscribed) {
      const q = me.startMetaQuery().withSub().withDesc().build();
      await me.subscribe(q);
    }
    emit();
    return () => {
      me.onSubsUpdated = undefined;
      void me.leave(false);
    };
  }

  /**
   * Subscribe to a p2p (or anon) topic and route its events to `handlers`.
   * Fetches recent history (arrives via `onMessage` per message). Returns unsubscribe.
   */
  async subscribeTopic(name: string, handlers: TopicHandlers): Promise<() => void> {
    const tinode = await this.ensure(TINODE_WS_URL);
    // Wait out any in-flight leave for this exact topic so `topic.subscribed`
    // below reflects the settled state — otherwise a racing detach can drop
    // this view's subscription (see {@link pendingLeaves}).
    const leaving = this.pendingLeaves.get(name);
    if (leaving) await leaving;
    const topic = tinode.getTopic(name);
    topic.onData = (data: unknown) => {
      const d = (data ?? {}) as Record<string, unknown>;
      handlers.onMessage?.({
        topic: name,
        from: d.from ? String(d.from) : undefined,
        seq: Number(d.seq ?? 0),
        ts: toMs(d.ts),
        content: d.content,
        head: d.head as Record<string, unknown> | undefined,
      });
    };
    topic.onInfo = (raw: unknown) => {
      const info = (raw ?? {}) as { what?: string; from?: string; seq?: number };
      if (info.what === "kp") handlers.onTyping?.(String(info.from ?? ""));
      else handlers.onInfo?.(info as { what: "recv" | "read" | "kp"; from?: string; seq?: number });
    };
    topic.onPres = (pres: unknown) => {
      handlers.onPresence?.(pres);
      const p = (pres ?? {}) as {
        what?: string;
        delseq?: Array<{ low?: number; hi?: number }>;
      };
      // A peer hard-delete surfaces as a live `{pres what: "del"}` on this
      // topic (see `Topic#_routePres`), carrying the same `{low, hi}` range
      // shape as our own delMessages/deleteMessage (hi exclusive; absent hi
      // means a single-message range). Route it to onDelete instead of
      // treating it as an online/offline transition.
      if (p.what === "del") {
        try {
          const seqs: number[] = [];
          for (const range of p.delseq ?? []) {
            const low = Number(range?.low ?? 0);
            if (!low) continue;
            const hi = range?.hi ? Number(range.hi) : low + 1;
            for (let s = low; s < hi; s++) seqs.push(s);
          }
          if (seqs.length) handlers.onDelete?.(seqs);
        } catch {
          // Malformed delseq payload — nothing sane to relay.
        }
        return;
      }
      handlers.onPres?.({ online: p.what === "on", what: p.what });
    };
    if (!topic.subscribed) {
      const q = topic.startMetaQuery().withLaterData(24).withDesc().build();
      await topic.subscribe(q);
    }
    // Re-emit already-cached messages to the freshly-attached onData handler.
    // The SDK returns one Topic object per name, reused across views — switching
    // between the anon-chat and the friend-chat (the same group topic after a
    // reveal) re-attaches onData, but neither subscribe() nor withLaterData
    // re-delivers messages the SDK already holds, which left a reopened thread
    // empty. onMessage upserts by id, so replaying over a fresh subscribe's own
    // delivery is idempotent.
    try {
      (topic as { messages?: (cb: (m: unknown) => void) => void }).messages?.(
        (m) => topic.onData?.(m),
      );
    } catch {
      // Older SDK without a cached-message iterator — nothing to replay.
    }
    this.topics.set(name, topic);
    return () => {
      void this.leaveTopic(name, false);
    };
  }

  /**
   * Send a message to a topic. `content` is a string or a Drafty document.
   * @returns the server-assigned sequence id (0 if unavailable).
   */
  async sendMessage(topic: string, content: unknown): Promise<number> {
    const t = this.topics.get(topic) ?? this.tinode!.getTopic(topic);
    await this.ensureAttached(t);
    try {
      return this.publishSeq(await this.publishCached(t, content, true));
    } catch (err) {
      // A racing leave() can detach the topic between our attach check and the
      // publish. Re-attach once and retry before giving up.
      if (!(t as { subscribed?: boolean }).subscribed) {
        await this.ensureAttached(t);
        return this.publishSeq(await this.publishCached(t, content, true));
      }
      throw err;
    }
  }

  /**
   * Publish on `t` the way the SDK's own `Topic#publishDraft` does — reserving
   * the message's cache slot up front — instead of handing `publishMessage` a
   * bare packet straight from `createMessage`. Two things go wrong without it,
   * and both only surface when a chat is reopened, since a reopen renders from
   * this local cache alone (the topic stays subscribed, so nothing is refetched).
   *
   * 1. `publishMessage` runs `swapMessageId(pub, seq)` on ack, which looks the
   *    message up with `_messages.find(pub)` while `pub.seq` is still undefined.
   *    The cache's comparator is `a.seq - b.seq`, so every comparison is NaN;
   *    `CBuffer#findNearest` treats NaN as neither `<` nor `>` and reports a
   *    bogus EXACT hit at the binary-search midpoint. The SDK then deletes that
   *    unrelated, real message before inserting ours — one silently destroyed
   *    message per send, taken from the middle of the thread. Giving the packet
   *    a local seq id and its own cache entry first makes the lookup an exact
   *    hit on us, so the swap replaces the right message.
   * 2. A locally-published message is otherwise cached with no `from` at all
   *    (only `publishDraft` stamps it), which the replay on the next open can't
   *    tell apart from a pre-reveal anon message — whose `from` the server
   *    blanks on purpose — so the store dropped every message we ever sent.
   *
   * The wire frame is unaffected: `Tinode#publishMessage` clones the packet and
   * clears `from`/`seq` before sending. `_noForwarding` stops `_routeData` from
   * re-inserting what the swap has already placed; it does not suppress the
   * `onData` echo, which still fires with the real seq once the ack lands.
   *
   * Falls back to a plain `publishMessage` if the SDK internals this leans on
   * ever disappear — same behavior as before, defects included.
   */
  private async publishCached(
    t: Topic,
    content: unknown,
    noEcho: boolean,
    head?: Record<string, unknown>,
  ): Promise<unknown> {
    const pub = t.createMessage(content, noEcho) as Record<string, unknown>;
    if (head) {
      pub.head = { ...(pub.head as Record<string, unknown> | undefined), ...head };
    }
    const sdk = t as unknown as {
      _getQueuedSeqId?: () => number;
      _messages?: { put: (m: unknown) => void };
      cancelSend?: (seq: number) => boolean;
    };
    const localSeq =
      typeof sdk._getQueuedSeqId === "function" && sdk._messages
        ? sdk._getQueuedSeqId()
        : 0;
    if (localSeq) {
      pub.seq = localSeq;
      pub.from = this.uid ?? undefined;
      pub._noForwarding = true;
      sdk._messages!.put(pub);
    }
    // Drop the reserved entry when the message never made it to the server, so a
    // later replay can't resurrect it under its (out-of-range) local seq id.
    const rollback = () => {
      if (localSeq) {
        try {
          sdk.cancelSend?.(localSeq);
        } catch {
          // Older SDK without cancelSend — the placeholder stays until reload.
        }
      }
    };
    let ctrl: unknown;
    try {
      ctrl = await t.publishMessage(pub as Parameters<Topic["publishMessage"]>[0]);
    } catch (err) {
      rollback();
      throw err;
    }
    // `Topic#publishMessage` swallows a server-side rejection and resolves with
    // nothing, so a missing seq is the only signal that the publish failed.
    if (!this.publishSeq(ctrl)) rollback();
    return ctrl;
  }

  /** Attach `t` if it isn't already, tolerating a racing subscribe. */
  private async ensureAttached(t: Topic): Promise<void> {
    if ((t as { subscribed?: boolean }).subscribed) return;
    try {
      await t.subscribe(t.startMetaQuery().withLaterData(24).withDesc().build());
    } catch {
      // Another caller may have attached it first, or it is mid-attach — the
      // publish that follows will surface any real failure.
    }
  }

  private publishSeq(ctrl: unknown): number {
    const seq = (ctrl as TinodeCtrl)?.params?.seq;
    return typeof seq === "number" ? seq : 0;
  }

  /**
   * Delete messages `[seq, seq]` on a topic. `hard` also removes them for the
   * other party (soft delete only hides them for the caller). Wraps the SDK's
   * `Topic#delMessages`, which takes a list of `{low, hi}` ranges — `hi` is
   * exclusive, so a single message is `{low: seq, hi: seq + 1}`.
   */
  async deleteMessage(topic: string, seq: number, hard: boolean): Promise<void> {
    const t = this.topics.get(topic) ?? this.tinode!.getTopic(topic);
    await t.delMessages([{ low: seq, hi: seq + 1 }], hard);
  }

  /**
   * Drop a message from the LOCAL SDK cache only (no server call). Needed when a
   * peer hard-deletes a message we already received: Tinode does not deliver a
   * live `{pres what:del}` to a session that attached under the anon pair-topic's
   * P-less access mode, and {@link subscribeTopic}'s cached-message replay would
   * otherwise resurrect the deleted message on the next reopen. The companion
   * WS relay (`msg:del`) hands us the seqs so we can purge them here.
   */
  purgeCachedMessage(topic: string, seq: number): void {
    const t = this.topics.get(topic) ?? this.tinode?.getTopic(topic);
    try {
      (t as { flushMessage?: (s: number) => void } | undefined)?.flushMessage?.(seq);
    } catch {
      // Older SDK without flushMessage — cache stays; a reopen may still show it.
    }
  }

  /**
   * "Edit" a message. Tinode has no native edit — the convention (mirrored
   * from the SDK's own `Topic#isReplacementMsg`/`_maybeUpdateMessageVersionsCache`,
   * see `tinode.dev.js`) is to publish a brand-new message whose head carries
   * `{replace: ':<seq>'}` pointing at the original. Readers fold it onto the
   * original bubble (see {@link parseEditTarget}) instead of showing a second one.
   * @returns the new message's server-assigned sequence id (0 if unavailable).
   */
  async editMessage(topic: string, seq: number, content: unknown): Promise<number> {
    const t = this.topics.get(topic) ?? this.tinode!.getTopic(topic);
    const ctrl = await this.publishCached(t, content, false, { replace: `:${seq}` });
    const newSeq = (ctrl as TinodeCtrl)?.params?.seq;
    return typeof newSeq === "number" ? newSeq : 0;
  }

  /**
   * Send an app-level reaction (Tinode has no first-class reaction type).
   * Publishes a message carrying `head.reaction = {seq: targetSeq, emoji}`;
   * the emoji is also the plain-text body so a client that doesn't know the
   * convention still shows *something* sane. Readers must check
   * {@link parseReaction} first — a non-null result means "fold this onto the
   * target message, do not render it as its own bubble".
   */
  async sendReaction(topic: string, targetSeq: number, emoji: string): Promise<void> {
    const t = this.topics.get(topic) ?? this.tinode!.getTopic(topic);
    await this.publishCached(t, emoji, false, { reaction: { seq: targetSeq, emoji } });
  }

  /** Emit a "typing" notification on a topic (throttle at the call site). */
  sendTyping(topic: string): void {
    this.topics.get(topic)?.noteKeyPress();
  }

  /**
   * Mark messages up to `seq` as read on a topic. When `seq` is omitted we
   * supply the topic's latest seq explicitly (like {@link noteRecv}) rather
   * than relying on the SDK's no-arg behavior, which did NOT reliably advance
   * the server read pointer for p2p topics → the peer's unread badge stayed
   * stuck and the sender's read-tick never flipped (BUG-45).
   */
  noteRead(topic: string, seq?: number): void {
    const t = this.topics.get(topic);
    if (!t) return;
    const s = seq ?? t.maxMsgSeq?.();
    if (s) t.noteRead(s);
    else t.noteRead();
  }

  /**
   * The signed-in user's own read high-water seq on a topic (0 if unknown).
   * Used to skip already-read messages replayed from cache on (re)subscribe so
   * the unread badge doesn't inflate on every boot (BUG-45).
   */
  myReadSeq(topic: string): number {
    const t = this.topics.get(topic) as { read?: number } | undefined;
    return typeof t?.read === "number" ? t.read : 0;
  }

  /**
   * Mark messages up to `seq` as received/delivered on a topic. Unlike
   * {@link noteRead}, the SDK's `noteRecv` has no automatic "latest seq"
   * fallback, so we supply one from the topic's own `maxMsgSeq()` when `seq`
   * is omitted.
   */
  noteRecv(topic: string, seq?: number): void {
    const t = this.topics.get(topic);
    if (!t) return;
    const s = seq ?? t.maxMsgSeq?.();
    if (s) t.noteRecv(s);
  }

  /** Leave a topic; pass `unsub` to also drop the subscription server-side. */
  async leaveTopic(name: string, unsub = false): Promise<void> {
    const topic = this.topics.get(name);
    if (!topic) return;
    this.topics.delete(name);
    const p = (async () => {
      try {
        await topic.leave(unsub);
      } catch {
        // Already gone / disconnected — nothing to clean up.
      }
    })();
    this.pendingLeaves.set(name, p);
    try {
      await p;
    } finally {
      // Only clear if no newer leave replaced ours in the meantime.
      if (this.pendingLeaves.get(name) === p) this.pendingLeaves.delete(name);
    }
  }

  /**
   * Upload a file to Tinode's large-file endpoint (`POST /v0/file/u`) via the
   * SDK's `LargeFileHelper`, wrapping its callback API in a Promise. The
   * server file ref comes back as `ctrl.params.url` (e.g. `/v0/file/s/xxx.jpg`),
   * served later at that same path (`/v0/file/s/...`).
   * @param file raw bytes to upload.
   * @param name display filename to carry in the returned metadata (the
   *   server doesn't echo it back, so we keep the caller's copy).
   * @param mime MIME type to carry in the returned metadata.
   * @param onProgress optional upload-progress callback, 0–100.
   * @returns the uploaded file's ref, mime, name and size.
   */
  async uploadFile(
    file: File | Blob,
    name: string,
    mime: string,
    onProgress?: (p: number) => void,
  ): Promise<UploadedMedia> {
    if (!this.tinode || !this.tinode.isConnected()) {
      throw new Error("Tinode is not connected — cannot upload a file");
    }
    const helper = this.tinode.getLargeFileHelper();
    const url = await new Promise<string>((resolve, reject) => {
      helper.upload(
        file,
        null,
        (frac: number) => onProgress?.(Math.round(frac * 100)),
        (ctrl: TinodeCtrl) => {
          const fileUrl = ctrl?.params?.url;
          if (fileUrl) resolve(String(fileUrl));
          else reject(new Error("Tinode upload returned no file url"));
        },
        (err: unknown) => {
          reject(err instanceof Error ? err : new Error("Tinode upload failed"));
        },
      );
    });
    return { url, mime, name, size: file.size };
  }

  /**
   * Upload a new avatar and set it as the account's public photo. Reuses
   * {@link uploadFile}'s large-file path, then merges `photo: {ref}` into the
   * `me` topic's existing `public` (preserving `fn` etc.) via `setMeta` — the
   * standard Tinode avatar convention (`public.photo.ref`, same shape
   * {@link avatarRefFor} reads back for any contact).
   * @returns the uploaded avatar's file ref (wrap in {@link authedFileUrl} to display).
   */
  async setAvatar(file: File): Promise<string> {
    if (!this.tinode || !this.tinode.isConnected()) {
      throw new Error("Tinode is not connected — cannot set avatar");
    }
    const up = await this.uploadFile(file, file.name, file.type || "application/octet-stream");
    const me = this.tinode.getMeTopic();
    const prevPublic = (me.public as Record<string, unknown> | undefined) ?? {};
    await me.setMeta({ desc: { public: { ...prevPublic, photo: { ref: up.url } } } });
    return up.url;
  }

  /**
   * Current basic-scheme login/username, once known (set by the SDK itself on
   * a successful {@link loginBasic}/{@link createAccountBasic}). Needed to
   * change the account's own password without renaming it, since Tinode's
   * `{acc}` update packet carries the login baked into the new secret
   * (`base64(username:password)`) — the server takes whatever username rides
   * along as the account's login going forward.
   */
  getCurrentLogin(): string | null {
    return this.tinode?.getCurrentLogin() ?? null;
  }

  /**
   * Change the signed-in account's password. First re-authenticates with
   * `oldPassword` (a same-connection `loginBasic` round trip) — the SDK's
   * account-update packet doesn't itself check that the caller knows the
   * current password before installing a new secret — then commits
   * `newPassword` via `updateAccountBasic`, keeping the login name unchanged.
   * @throws if not logged in with a basic-scheme account, or if `oldPassword`
   *   doesn't match (the re-auth step rejects).
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (!this.tinode || !this.tinode.isConnected()) {
      throw new Error("Tinode is not connected — cannot change password");
    }
    const uid = this.uid;
    const login = this.tinode.getCurrentLogin();
    if (!uid || !login) {
      throw new Error("Not logged in with a basic-scheme account");
    }
    await this.tinode.loginBasic(login, oldPassword);
    await this.tinode.updateAccountBasic(uid, login, newPassword);
  }

  /**
   * Permanently delete the signed-in account. Deleting the special `me`
   * topic (hard) is the Tinode protocol's account-deletion convention —
   * there's no separate delete-account RPC. Tears down the local connection
   * afterward; callers should also clear their own session state (the
   * store's `signOut()`).
   */
  async deleteMyAccount(): Promise<void> {
    if (!this.tinode || !this.tinode.isConnected()) {
      throw new Error("Tinode is not connected — cannot delete account");
    }
    const me = this.tinode.getMeTopic();
    await me.delTopic(true);
    this.disconnect();
  }

  /** Tear down the whole connection (logout / app close). */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectBackoffMs = 1000;
    this.hasSession = false;
    this.tinode?.disconnect();
    this.topics.clear();
    this.tinode = null;
    this.uid = null;
  }
}

/** Lazily-created app-wide singleton. The session store owns its lifecycle. */
let singleton: TinodeClient | null = null;
export function getTinodeClient(): TinodeClient {
  if (!singleton) singleton = new TinodeClient();
  return singleton;
}

/** Coarse media category, driving both the Drafty entity shape and the UI. */
export type MediaKind = "image" | "video" | "audio" | "file";

/** Result of a completed upload — enough to build a Drafty entity from it. */
export interface UploadedMedia {
  /** Server file ref returned by the upload endpoint (e.g. `/v0/file/s/xxx.jpg`). */
  url: string;
  mime: string;
  name: string;
  size: number;
}

/** A media attachment recovered from an incoming message's Drafty content. */
export interface MediaPart {
  kind: MediaKind;
  url: string;
  mime: string;
  name: string;
  size: number;
  width?: number;
  height?: number;
  /** Seconds, audio/video only. */
  duration?: number;
}

/**
 * Upload a file through the app-wide Tinode singleton (see {@link getTinodeClient}).
 * Thin module-level wrapper around {@link TinodeClient.uploadFile} for call
 * sites that don't hold a `TinodeClient` reference directly.
 */
export async function uploadFile(
  file: File | Blob,
  name: string,
  mime: string,
  onProgress?: (p: number) => void,
): Promise<UploadedMedia> {
  return getTinodeClient().uploadFile(file, name, mime, onProgress);
}

/**
 * Change the signed-in user's password through the app-wide Tinode singleton
 * (see {@link getTinodeClient}). See {@link TinodeClient.changePassword}.
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  return getTinodeClient().changePassword(oldPassword, newPassword);
}

/**
 * Permanently delete the signed-in user's Tinode account through the
 * app-wide singleton. See {@link TinodeClient.deleteMyAccount}.
 */
export async function deleteMyAccount(): Promise<void> {
  return getTinodeClient().deleteMyAccount();
}

/**
 * Build a Drafty document embedding one uploaded file, ready to hand to
 * {@link TinodeClient.sendMessage} (which accepts a string or a Drafty doc).
 *
 * Images render inline as an `IM` entity, with the `fmt` span covering the
 * single placeholder character in `txt`. Video/audio/file all go out as
 * generic `EX` attachments — Tinode's convention for those (mirroring the
 * SDK's own `Drafty.attachFile`) is a zero-length `fmt` marker at `at:-1`,
 * meaning "attached to the message" rather than inline at a text offset.
 * Audio (and video, if known) carry `duration` in the entity data when given.
 */
export function buildMediaDraft(
  kind: MediaKind,
  up: UploadedMedia,
  extra?: { width?: number; height?: number; duration?: number },
): unknown {
  if (kind === "image") {
    return {
      txt: " ",
      fmt: [{ at: 0, len: 1, key: 0 }],
      ent: [
        {
          tp: "IM",
          data: {
            mime: up.mime,
            name: up.name,
            ref: up.url,
            size: up.size,
            width: extra?.width,
            height: extra?.height,
          },
        },
      ],
    };
  }
  const data: Record<string, unknown> = {
    mime: up.mime,
    name: up.name,
    ref: up.url,
    size: up.size,
  };
  if ((kind === "audio" || kind === "video") && extra?.duration !== undefined) {
    data.duration = extra.duration;
  }
  return {
    txt: "",
    fmt: [{ at: -1, len: 0, key: 0 }],
    ent: [{ tp: "EX", data }],
  };
}

/**
 * Extract media attachments (image/video/audio/file) from an incoming
 * message's `content` (string or Drafty doc). Plain-string bodies carry no
 * entities and yield `[]`. Walks `content.ent` directly — the same array
 * `Drafty.entities`/`Drafty.attachments` iterate in the SDK — classifying
 * `IM` as image and `EX` by its `mime` prefix (video/audio/else-file).
 */
export function parseMediaParts(content: unknown): MediaPart[] {
  if (!content || typeof content !== "object") return [];
  const ent = (content as { ent?: unknown }).ent;
  if (!Array.isArray(ent)) return [];

  const out: MediaPart[] = [];
  for (const raw of ent) {
    const e = raw as { tp?: string; data?: Record<string, unknown> } | null;
    if (!e?.data) continue;
    const d = e.data;
    const mime = String(d.mime ?? "");
    const url = String(d.ref ?? d.url ?? "");
    if (!url) continue;

    let kind: MediaKind | null = null;
    if (e.tp === "IM") kind = "image";
    else if (e.tp === "EX") {
      kind = mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file";
    }
    if (!kind) continue;

    out.push({
      kind,
      url,
      mime,
      name: String(d.name ?? ""),
      size: Number(d.size ?? 0),
      width: typeof d.width === "number" ? d.width : undefined,
      height: typeof d.height === "number" ? d.height : undefined,
      duration: typeof d.duration === "number" ? d.duration : undefined,
    });
  }
  return out;
}

/**
 * Turn a Tinode file ref (`/v0/file/s/xxx.png`, as stored in a Drafty entity)
 * into a URL that an `<img>`/`<video>`/`<audio>`/`<a>` can actually load.
 *
 * Tinode's file-download handler rejects an unauthenticated GET with 403 — a
 * bare media tag sends no `Authorization` header, so the auth must ride in the
 * query string. Tinode reads the API key from `apikey` and the session token
 * from the `auth=token`/`secret=<token>` pair (same scheme the SDK uses on the
 * wire). Absolute (`http…`) or data URLs are returned untouched.
 */
export function authedFileUrl(ref: string): string {
  if (!ref || !ref.startsWith("/")) return ref;
  const params = new URLSearchParams({ apikey: TINODE_API_KEY });
  const token = getTinodeClient().getAuthToken();
  if (token) {
    params.set("auth", "token");
    params.set("secret", token);
  }
  return `${ref}?${params.toString()}`;
}

/**
 * Detect an "edit" message and return the seq it replaces, or `null` if
 * `msg` isn't one. Reads the `{replace: ':<seq>'}` head convention (see
 * {@link TinodeClient.editMessage} for how it's written) — same shape the
 * SDK itself checks in `Topic#isReplacementMsg`/`_maybeUpdateMessageVersionsCache`.
 */
export function parseEditTarget(msg: TinodeMessage): number | null {
  const replace = msg.head?.replace;
  if (typeof replace !== "string") return null;
  const seq = parseInt(replace.split(":")[1] ?? "", 10);
  return Number.isFinite(seq) && seq > 0 ? seq : null;
}

/**
 * Detect an app-level reaction message and return its target seq + emoji, or
 * `null` if `msg` isn't one. Reads the `{reaction: {seq, emoji}}` head
 * convention (see {@link TinodeClient.sendReaction}). A non-null result means
 * the caller should fold this onto the target bubble instead of rendering it
 * as its own message.
 */
export function parseReaction(msg: TinodeMessage): { seq: number; emoji: string } | null {
  const reaction = msg.head?.reaction as { seq?: unknown; emoji?: unknown } | undefined;
  if (!reaction || typeof reaction.emoji !== "string") return null;
  const seq = Number(reaction.seq ?? 0);
  if (!seq) return null;
  return { seq, emoji: reaction.emoji };
}

/**
 * Optional TURN relay, provisioned by the deploy side (server-stack's coturn —
 * see W3-3). Public STUN alone can't establish a media path between two peers
 * both behind symmetric NATs; a TURN relay is the fallback. All three env vars
 * must be set for the relay to be added — unset (the default) keeps the
 * original STUN-only behavior.
 */
const TURN_URL = process.env.NEXT_PUBLIC_TURN_URL;
const TURN_USER = process.env.NEXT_PUBLIC_TURN_USER;
const TURN_PASS = process.env.NEXT_PUBLIC_TURN_PASS;

/**
 * ICE server config for {@link createPeerConnection} — public STUN always,
 * plus a TURN relay when {@link TURN_URL}/{@link TURN_USER}/{@link TURN_PASS}
 * are all configured.
 */
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    ...(TURN_URL && TURN_USER && TURN_PASS
      ? [{ urls: [TURN_URL], username: TURN_USER, credential: TURN_PASS }]
      : []),
  ],
};

/**
 * Create a browser `RTCPeerConnection` pre-configured with {@link RTC_CONFIG}.
 * Pure Web API — no Tinode SDK involved here; call sites still need to
 * exchange the offer/answer/ICE candidates over a Tinode topic themselves
 * (e.g. as a `head.webrtc` message, mirroring the SDK's own video-call head
 * convention seen in `tinode.dev.js`'s `_routeData`).
 * @throws if called outside a browser (SSR has no `RTCPeerConnection`).
 */
export function createPeerConnection(): RTCPeerConnection {
  if (typeof window === "undefined" || typeof RTCPeerConnection === "undefined") {
    throw new Error("RTCPeerConnection is only available in the browser");
  }
  return new RTCPeerConnection(RTC_CONFIG);
}
