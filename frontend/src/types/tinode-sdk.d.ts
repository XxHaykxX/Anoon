/**
 * Minimal ambient types for `tinode-sdk` (v0.25.x ships no .d.ts, UMD only).
 *
 * This declares just the surface our wrapper (`src/lib/tinode.ts`) touches, typed
 * loosely on purpose. Full API: http://tinode.github.io/js-api/ — extend here as
 * we wire more of it up. This is intentionally partial, not the complete SDK.
 */
declare module "tinode-sdk" {
  /** Options passed to `new Tinode(...)`. */
  export interface TinodeConfig {
    appName?: string;
    host?: string;
    apiKey?: string;
    transport?: "ws" | "lp";
    secure?: boolean;
    persist?: boolean;
  }

  /** A login's issued auth token, as returned by `getAuthToken()`. */
  export interface AuthTokenInfo {
    token: string;
    expires: string;
  }

  /** Server `{ctrl}` reply. `params.user` is the account uid on auth calls. */
  export interface TinodeCtrl {
    code?: number;
    text?: string;
    params?: {
      user?: string;
      token?: string;
      authlvl?: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  /** A Tinode topic (chat channel). Loosely typed for the scaffold. */
  export interface Topic {
    name: string;
    subscribe(getParams?: unknown, setParams?: unknown): Promise<unknown>;
    leave(unsub?: boolean): Promise<unknown>;
    publish(content: unknown): Promise<unknown>;
    createMessage(content: unknown, echoOff?: boolean): unknown;
    publishMessage(msg: unknown): Promise<unknown>;
    noteKeyPress(): void;
    onData?: (data: unknown) => void;
    onPres?: (pres: unknown) => void;
    onInfo?: (info: unknown) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  export class Tinode {
    constructor(config: TinodeConfig, onComplete?: () => void);
    /** Legacy positional constructor is also supported by the SDK. */
    connect(host?: string): Promise<unknown>;
    disconnect(): void;
    isConnected(): boolean;
    /** Login with a previously issued token (our companion issues these). */
    loginToken(token: string, cred?: unknown): Promise<TinodeCtrl>;
    loginBasic(uname: string, password: string, cred?: unknown): Promise<TinodeCtrl>;
    /**
     * Generic scheme login. Used for `rest`, where the secret is the Google ID
     * token and Tinode's REST auth handler asks companion whether it is good —
     * there is no `loginRest` convenience method in the SDK.
     */
    login(scheme: string, secret: string, cred?: unknown): Promise<TinodeCtrl>;
    /** Create a `basic`-scheme account; logs in on success. `params` = {public,tags,…}. */
    createAccountBasic(
      uname: string,
      password: string,
      params?: unknown,
    ): Promise<TinodeCtrl>;
    /** Toggle SDK console logging. */
    enableLogging(enabled?: boolean, trim?: boolean): void;
    /** The current session's auth token (set on successful login), or `null`. */
    getAuthToken(): AuthTokenInfo | null;
    getTopic(name: string): Topic;
    getMeTopic(): Topic;
    setHumanLanguage?(lang: string): void;
    onConnect?: () => void;
    onDisconnect?: (err?: unknown) => void;
    onMessage?: (msg: unknown) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;

    static setNetworkProviders(ws: unknown, xhr: unknown): void;
    static setDatabaseProvider(idb: unknown): void;
    static TOPIC_ME: string;
  }

  export const Drafty: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parse(content: string): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  export const AccessMode: unknown;
}
