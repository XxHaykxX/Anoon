/**
 * The little that is genuinely platform-specific in the code shared between the
 * web app and the Expo client (`../store/*`, `./companion.ts`, `./tinode.ts`,
 * `./notify.ts`). Everything else in those files is plain TypeScript and runs
 * unchanged on React Native.
 *
 * There are exactly three things that do not travel:
 *   • where the backend lives — the web derives it from `window.location` in
 *     same-origin mode, the native app reads it from its own config;
 *   • the session token / small persisted mirrors — `localStorage` on the web,
 *     the OS keystore on the phone;
 *   • whether a browser DOM exists at all (WebAudio, `navigator.vibrate`).
 *
 * The web implementation below is the default and behaves exactly as the
 * hardcoded `window`/`localStorage`/`process.env` accesses it replaced. The
 * Expo app installs its own via {@link setPlatform} from its entry file, before
 * any of the shared modules are imported — several of them read this at module
 * scope (`USE_TINODE`, `COMPANION_URL`), so ordering is load-bearing there.
 */

/** Synchronous key-value storage. Sync on purpose: the store reads it inline. */
export interface PlatformStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface PlatformAdapter {
  /** REST base of the companion service (`/api` in web same-origin mode). */
  readonly companionUrl: string;
  /** ws(s):// base for companion's event socket; the caller appends `/ws`. */
  companionWsBase(restBase: string): string;
  /** Configured Tinode endpoint, before any same-origin rewrite. */
  readonly tinodeWsUrl: string;
  /** The endpoint actually dialled — the web swaps the host in same-origin mode. */
  effectiveTinodeWsUrl(configured: string): string;
  /** API key the Tinode server accepts. */
  readonly tinodeApiKey: string;
  /** Feature flag: talk to the real backend instead of the in-memory mock driver. */
  readonly useTinode: boolean;
  readonly storage: PlatformStorage;
  /**
   * False only during SSR. Gates sockets, the chat SDK and anything else that
   * needs a live runtime — NOT a "is this a browser" check: it is true on the
   * phone, where `window` is not.
   */
  readonly isClient: boolean;
  /** True only in a real browser: DOM, WebAudio, `navigator.vibrate`. */
  readonly hasDom: boolean;
}

/** Single-origin mode: talk to the reverse proxy on relative same-origin paths. */
const SAME_ORIGIN = process.env.NEXT_PUBLIC_SAME_ORIGIN === "1";

/**
 * `localStorage` is absent during SSR and can throw outright (Safari private
 * mode, storage disabled). Every miss degrades to "nothing persisted", which is
 * what the call sites already expect.
 */
const webStorage: PlatformStorage = {
  get(key) {
    try {
      return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage full / disabled — it just won't persist */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/** The browser implementation — the behaviour the shared code always had. */
export const webPlatform: PlatformAdapter = {
  // In same-origin mode this is the relative prefix `/api` (the proxy strips it
  // before hitting companion); `fetch` resolves it against the page origin, so
  // a tunnel URL that changes every restart is irrelevant.
  companionUrl: SAME_ORIGIN
    ? "/api"
    : process.env.NEXT_PUBLIC_COMPANION_URL ?? "http://127.0.0.1:6062",

  companionWsBase(restBase) {
    if (SAME_ORIGIN) {
      const secure = window.location.protocol === "https:";
      return `${secure ? "wss" : "ws"}://${window.location.host}/api`;
    }
    return restBase.replace(/^http/, "ws");
  },

  // 127.0.0.1, not `localhost`: the latter resolves to `::1` first, and Docker's
  // IPv6 port relay on this stack can accept the connection and then never
  // answer — a socket that hangs instead of failing.
  tinodeWsUrl: process.env.NEXT_PUBLIC_TINODE_WS ?? "ws://127.0.0.1:6061/v0/channels",

  effectiveTinodeWsUrl(configured) {
    if (SAME_ORIGIN && typeof window !== "undefined") {
      const secure = window.location.protocol === "https:";
      return `${secure ? "wss" : "ws"}://${window.location.host}/v0/channels`;
    }
    return configured;
  },

  tinodeApiKey:
    process.env.NEXT_PUBLIC_TINODE_API_KEY ?? "AQEAAAABAAD_rAp4DJh05a1HAwFT3A6K",

  useTinode: process.env.NEXT_PUBLIC_USE_TINODE === "1",

  storage: webStorage,

  get isClient() {
    return typeof window !== "undefined";
  },

  get hasDom() {
    return typeof window !== "undefined" && typeof document !== "undefined";
  },
};

let current: PlatformAdapter = webPlatform;

/** Install a non-web implementation. Must run before the shared modules load. */
export function setPlatform(adapter: PlatformAdapter): void {
  current = adapter;
}

/** The active platform adapter — web unless something replaced it. */
export function platform(): PlatformAdapter {
  return current;
}
