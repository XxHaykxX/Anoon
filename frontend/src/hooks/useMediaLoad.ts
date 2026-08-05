"use client";

import * as React from "react";

/** Backoff between retries of a failed/stalled media load, in ms. Length = retry budget. */
const MEDIA_RETRY_DELAYS = [400, 1200, 2500];
/**
 * A load that neither completes nor errors within this window counts as a
 * failure. An `<img>` whose request never *starts* fires neither event, so
 * without this a bubble would wait forever (BUG: receiver-side photo never
 * appears — see {@link useMediaLoad}).
 *
 * Tuned for chat-thumbnail payloads. Callers rendering full-size media (the
 * fullscreen viewer) should pass a longer window — see `stallMs`.
 */
export const MEDIA_STALL_MS = 6000;
/**
 * How many extra stall windows a *visibly progressing* element is granted
 * before the watchdog gives up on it. Guards against killing a slow-but-live
 * download on a bad connection, which retrying would only restart.
 */
const MEDIA_PROGRESS_GRACE = 2;

/** Media element the hook can drive — `<img>` and `<video>` report load differently. */
type LoadableMedia = HTMLImageElement | HTMLVideoElement;

/** Has the element decoded enough to prove the transfer is alive (not merely pending)? */
function isProgressing(el: LoadableMedia | null): boolean {
  if (!el) return false;
  return "naturalWidth" in el ? el.naturalWidth > 0 : el.readyState >= 1;
}

/**
 * Load bookkeeping shared by every media surface in the app — the chat
 * photo/video bubbles (ChatMediaBubble) and the fullscreen viewer's slides
 * (AnoonMediaViewer). Tracks whether the media finished loading, retries a
 * bounded number of times with backoff, and only then gives up so the caller
 * can render its own failure state (`BrokenNote` / «Не удалось загрузить»)
 * instead of spinning forever.
 *
 * Two failure modes are covered:
 *  - the request *fails* (Tinode answers 401/400 when the session token wasn't
 *    in the query string yet) → `onError` fires and we retry, and the caller
 *    re-resolves the URL so a token that arrived meanwhile is picked up;
 *  - the request never *starts or finishes* → neither event fires, so the
 *    stall watchdog forces the same retry path.
 *
 * `attempt` is meant to be spread onto the media tag as its `key`: re-rendering
 * with an identical `src` would not make the browser reissue anything, whereas
 * remounting the element does.
 *
 * Usage:
 * ```tsx
 * const { loaded, broken, attempt, mediaRef, onLoad, onError } = useMediaLoad(true);
 * <img key={attempt} ref={mediaRef} src={src} onLoad={onLoad} onError={onError} />
 * ```
 *
 * @param watchStall only arm the watchdog when the caller actually renders a
 *   tag wired to `onLoad` — a document/voice bubble never reports a load, and
 *   would otherwise be declared broken one stall window in.
 * @param stallMs how long to wait for a load before treating it as stalled.
 *   Defaults to {@link MEDIA_STALL_MS}; raise it for full-size media.
 */
export function useMediaLoad(watchStall: boolean, stallMs: number = MEDIA_STALL_MS) {
  const [loaded, setLoaded] = React.useState(false);
  const [broken, setBroken] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const budget = React.useRef(0);
  const timer = React.useRef<number | null>(null);
  const el = React.useRef<LoadableMedia | null>(null);

  const clear = React.useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const retry = React.useCallback(() => {
    clear();
    if (budget.current >= MEDIA_RETRY_DELAYS.length) {
      setBroken(true);
      return;
    }
    const delay = MEDIA_RETRY_DELAYS[budget.current];
    budget.current += 1;
    timer.current = window.setTimeout(() => setAttempt((n) => n + 1), delay);
  }, [clear]);

  const onLoad = React.useCallback(() => {
    clear();
    setLoaded(true);
  }, [clear]);

  /**
   * Attach to the `<img>`/`<video>`. Keeps the element around for the
   * watchdog's progress check, and covers the React race where a retry served
   * straight from the browser cache completes *before* the `load` listener is
   * attached — which would otherwise leave `loaded` false and let the watchdog
   * condemn a perfectly good image.
   */
  const mediaRef = React.useCallback(
    (node: LoadableMedia | null) => {
      el.current = node;
      if (node && "complete" in node && node.complete && node.naturalWidth > 0) onLoad();
    },
    [onLoad],
  );

  React.useEffect(() => {
    if (!watchStall || loaded || broken) return;
    let grace = 0;
    const arm = () => {
      timer.current = window.setTimeout(() => {
        // Still visibly downloading — extend rather than restart the transfer.
        if (isProgressing(el.current) && grace < MEDIA_PROGRESS_GRACE) {
          grace += 1;
          arm();
          return;
        }
        retry();
      }, stallMs);
    };
    arm();
    return clear;
  }, [watchStall, stallMs, attempt, loaded, broken, retry, clear]);

  return { loaded, broken, attempt, mediaRef, onLoad, onError: retry };
}
