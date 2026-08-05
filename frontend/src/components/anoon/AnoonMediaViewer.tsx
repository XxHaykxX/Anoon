"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CloseIcon } from "@/components/icons";
import { useMediaLoad } from "@/hooks/useMediaLoad";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { authedFileUrl } from "@/lib/tinode";
import {
  useMediaViewerStore,
  type MediaViewerItem,
} from "@/store/mediaViewerStore";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_SCALE = 2.5;
const DOUBLE_TAP_MS = 280;
const TAP_MOVE_TOL = 10;
const DOUBLE_TAP_DIST = 44;

type Pt = { x: number; y: number };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * Slides carry full-size originals, not chat thumbnails, so they get a longer
 * grace period than {@link MEDIA_STALL_MS} before the watchdog calls a load
 * stalled. (The hook additionally extends this on its own for any element that
 * is visibly still decoding, so a slow-but-live download is never cut off.)
 */
const VIEWER_STALL_MS = 15_000;

/**
 * The viewer is handed an already-resolved URL, captured by the chat screen
 * when the lightbox opened (`openConversationMedia` in AnoonPrivateChat /
 * AnoonAnonChat runs `authedFileUrl` at that moment). If the session token
 * baked into that URL has since gone stale — the socket reconnected and Tinode
 * issued a new one while the viewer stayed open — retrying the identical URL
 * would just 401 again forever. Rebuilding it from the path makes every retry
 * carry the *current* token.
 *
 * Absolute (`http…`) and `data:` URLs are returned untouched, matching
 * `authedFileUrl`'s own contract; the first attempt is never rewritten, since
 * the captured URL is fresh by construction.
 */
function refreshedSrc(src: string, attempt: number): string {
  if (attempt === 0 || !src.startsWith("/")) return src;
  return authedFileUrl(src.split("?")[0]);
}

/**
 * One slide of the lightbox. Owns its own load/retry lifecycle via the shared
 * {@link useMediaLoad} (the same hook backing the chat bubbles), so a slide
 * that fails or stalls retries with backoff and then shows «Не удалось
 * загрузить» instead of spinning forever.
 */
function ViewerSlide({
  item,
  isCurrent,
  widthPct,
  transform,
  transition,
}: {
  item: MediaViewerItem;
  isCurrent: boolean;
  widthPct: string;
  transform?: string;
  transition: string;
}) {
  // Watch for a stall only on the slide actually on screen. Every slide's
  // `<img>` starts loading at once, so with a long gallery the browser's
  // per-origin connection cap leaves later ones queued — not stalled — and a
  // watchdog armed on all of them would condemn slides the user never looked
  // at (and restart their transfers). Arming on `isCurrent` re-arms with a
  // fresh window the moment a queued slide is swiped to, which is also exactly
  // when its spinner becomes visible. A real failure still fires `onError` and
  // retries on every slide regardless.
  const { loaded, broken, attempt, mediaRef, onLoad, onError } = useMediaLoad(
    isCurrent,
    VIEWER_STALL_MS,
  );
  const src = refreshedSrc(item.src, attempt);

  return (
    <div
      className="flex h-full items-center justify-center px-2"
      style={{ width: widthPct }}
    >
      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden"
        style={{ transform, transformOrigin: "center center", transition }}
      >
        {/* Loading spinner until the current slide's media decodes. */}
        {isCurrent && !broken && !loaded && (
          <span className="pointer-events-none absolute z-10 size-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        )}
        {broken ? (
          <span className="rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/70">
            Не удалось загрузить
          </span>
        ) : item.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-resolved authed ref, no next/image loader
          <img
            key={attempt}
            ref={mediaRef}
            src={src}
            alt={item.caption || "Изображение"}
            draggable={false}
            data-testid={isCurrent ? "media-viewer-item" : undefined}
            onLoad={onLoad}
            onError={onError}
            className="max-h-full max-w-full select-none object-contain"
          />
        ) : (
          <video
            key={attempt}
            ref={mediaRef}
            src={src}
            controls
            playsInline
            autoPlay={isCurrent}
            data-testid={isCurrent ? "media-viewer-item" : undefined}
            onLoadedData={onLoad}
            onError={onError}
            // Keep native scrubbing/controls: don't let the lightbox
            // gesture surface hijack pointer events on the video.
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            className="max-h-full max-w-full bg-black object-contain"
          />
        )}
      </div>
    </div>
  );
}

/**
 * Fullscreen media viewer (lightbox). Store-driven: reads the REAL media of the
 * conversation from {@link useMediaViewerStore} (populated by the chat screens
 * via `openViewer(items, index)`), rather than the old demo gradient
 * placeholders (BUG-10). Mounted once in {@link AnoonApp} as a global overlay
 * gated on `open`, so it mounts fresh per session — internal zoom/paging state
 * initialises cleanly from the store index each time it opens.
 *
 * Gestures: pinch-to-zoom, double-tap zoom, pan, horizontal swipe to page,
 * swipe-down / tap-background / Esc to close. Hand-rolled Pointer Events — no
 * gesture library. Video slides opt out of the gesture surface (native
 * controls) and just page via the arrows / dots.
 */
export default function AnoonMediaViewer() {
  const items = useMediaViewerStore((s) => s.items);
  const storeIndex = useMediaViewerStore((s) => s.index);
  const setStoreIndex = useMediaViewerStore((s) => s.setIndex);
  const close = useMediaViewerStore((s) => s.close);

  const count = items.length;
  const reduced = usePrefersReducedMotion();

  // The viewer is mounted only while `open` (see AnoonApp), so this initialiser
  // runs once per session and picks up the tapped item's index.
  const [current, setCurrent] = React.useState(() =>
    clamp(storeIndex, 0, Math.max(0, count - 1)),
  );

  // Per-slide load state now lives in each {@link ViewerSlide}'s own
  // `useMediaLoad`, which also owns the retry/stall handling.

  // Zoom/pan of the current slide.
  const [scale, setScale] = React.useState(1);
  const [tx, setTx] = React.useState(0);
  const [ty, setTy] = React.useState(0);

  // Transient drag offsets for paging / close.
  const [dragX, setDragX] = React.useState(0);
  const [dragY, setDragY] = React.useState(0);
  const [animating, setAnimating] = React.useState(false); // true while a pointer gesture is live

  const surfaceRef = React.useRef<HTMLDivElement>(null);
  // Height of the gesture surface, mirrored into state at the moment a gesture
  // starts. The swipe-down backdrop fade needs it *during render*, and reading
  // `rect.current` there is a ref access in render (react-hooks/refs): refs are
  // not reactive, so a render triggered by anything other than the measuring
  // event would silently use a stale value. `rect` stays the source of truth
  // for the event handlers, which may read it freely.
  const [surfaceH, setSurfaceH] = React.useState(0);

  // Live gesture bookkeeping (kept in refs so pointermove doesn't thrash renders on the model).
  const pointers = React.useRef<Map<number, Pt>>(new Map());
  const rect = React.useRef<DOMRect | null>(null);
  const g = React.useRef({
    mode: "idle" as "idle" | "tap" | "swipe-x" | "close-y" | "pan" | "pinch",
    start: { x: 0, y: 0 } as Pt,
    startTx: 0,
    startTy: 0,
    startScale: 1,
    startDist: 0,
    startMid: { x: 0, y: 0 } as Pt,
    moved: false,
    startTime: 0,
  });
  const tap = React.useRef<{ time: number; x: number; y: number; timer: number | null }>({
    time: 0,
    x: 0,
    y: 0,
    timer: null,
  });

  const zoomed = scale > 1.01;

  const onClose = React.useCallback(() => close(), [close]);

  const resetZoom = React.useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  const goTo = React.useCallback(
    (next: number) => {
      const clamped = clamp(next, 0, count - 1);
      setCurrent(clamped);
      setStoreIndex(clamped);
      resetZoom();
    },
    [count, resetZoom, setStoreIndex],
  );

  const center = () => {
    const r = rect.current;
    if (!r) return { x: 0, y: 0 };
    return { x: r.width / 2, y: r.height / 2 };
  };

  // Keep pan inside the scaled image bounds.
  const clampTranslate = (nx: number, ny: number, s: number): Pt => {
    const r = rect.current;
    if (!r) return { x: nx, y: ny };
    const maxX = ((s - 1) * r.width) / 2;
    const maxY = ((s - 1) * r.height) / 2;
    return { x: clamp(nx, -maxX, maxX), y: clamp(ny, -maxY, maxY) };
  };

  const localPoint = (clientX: number, clientY: number): Pt => {
    const r = rect.current;
    if (!r) return { x: clientX, y: clientY };
    return { x: clientX - r.left, y: clientY - r.top };
  };

  const zoomAt = (pt: Pt, targetScale: number) => {
    const c = center();
    const clamped = clamp(targetScale, MIN_SCALE, MAX_SCALE);
    // translate so the tapped content point stays fixed under the finger.
    const nt = clampTranslate(
      (1 - clamped) * (pt.x - c.x),
      (1 - clamped) * (pt.y - c.y),
      clamped,
    );
    setScale(clamped);
    setTx(nt.x);
    setTy(nt.y);
  };

  const handleSingleTap = () => {
    if (!zoomed) onClose();
  };

  const handleDoubleTap = (pt: Pt) => {
    if (zoomed) resetZoom();
    else zoomAt(pt, ZOOM_SCALE);
  };

  const registerTap = (pt: Pt) => {
    const now = Date.now();
    const prev = tap.current;
    if (
      prev.timer !== null &&
      now - prev.time < DOUBLE_TAP_MS &&
      dist(prev, pt) < DOUBLE_TAP_DIST
    ) {
      window.clearTimeout(prev.timer);
      tap.current = { time: 0, x: 0, y: 0, timer: null };
      handleDoubleTap(pt);
      return;
    }
    if (prev.timer !== null) window.clearTimeout(prev.timer);
    const timer = window.setTimeout(() => {
      tap.current.timer = null;
      handleSingleTap();
    }, DOUBLE_TAP_MS);
    tap.current = { time: now, x: pt.x, y: pt.y, timer };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const surface = surfaceRef.current;
    if (surface) {
      rect.current = surface.getBoundingClientRect();
      setSurfaceH(rect.current.height);
    }
    surface?.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    setAnimating(true);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      g.current.mode = "pinch";
      g.current.startDist = dist(a, b) || 1;
      g.current.startScale = scale;
      g.current.startTx = tx;
      g.current.startTy = ty;
      g.current.startMid = localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }

    g.current.mode = zoomed ? "pan" : "tap";
    g.current.start = { x: e.clientX, y: e.clientY };
    g.current.startTx = tx;
    g.current.startTy = ty;
    g.current.moved = false;
    g.current.startTime = Date.now();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (g.current.mode === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = dist(a, b) || 1;
      const s = clamp(
        (g.current.startScale * d) / g.current.startDist,
        MIN_SCALE,
        MAX_SCALE,
      );
      const c = center();
      const mid = localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      // content point under the original midpoint, kept under the moving midpoint.
      const p0x = (g.current.startMid.x - c.x - g.current.startTx) / g.current.startScale;
      const p0y = (g.current.startMid.y - c.y - g.current.startTy) / g.current.startScale;
      const nt = clampTranslate(mid.x - c.x - s * p0x, mid.y - c.y - s * p0y, s);
      setScale(s);
      setTx(nt.x);
      setTy(nt.y);
      return;
    }

    const dx = e.clientX - g.current.start.x;
    const dy = e.clientY - g.current.start.y;

    if (g.current.mode === "pan") {
      const nt = clampTranslate(g.current.startTx + dx, g.current.startTy + dy, scale);
      setTx(nt.x);
      setTy(nt.y);
      return;
    }

    if (!g.current.moved && Math.hypot(dx, dy) > TAP_MOVE_TOL) {
      g.current.moved = true;
      // Lock axis: horizontal → paginate, downward → close.
      if (Math.abs(dx) > Math.abs(dy)) g.current.mode = "swipe-x";
      else if (dy > 0) g.current.mode = "close-y";
      else g.current.mode = "tap"; // ignore upward drags
    }

    if (g.current.mode === "swipe-x") {
      // Rubber-band resistance at the ends.
      let eff = dx;
      if ((current === 0 && dx > 0) || (current === count - 1 && dx < 0)) eff = dx * 0.35;
      setDragX(eff);
    } else if (g.current.mode === "close-y") {
      setDragY(Math.max(0, dy));
    }
  };

  const finishGesture = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);

    // Still have fingers down (e.g. one finger lifted from a pinch): wait for the rest.
    if (pointers.current.size >= 1) {
      // Re-baseline a lingering single finger into a pan so it doesn't jump.
      const remaining = [...pointers.current.values()][0];
      g.current.mode = zoomed ? "pan" : "tap";
      g.current.start = { x: remaining.x, y: remaining.y };
      g.current.startTx = tx;
      g.current.startTy = ty;
      g.current.moved = false;
      return;
    }

    setAnimating(false);
    const r = rect.current;
    const mode = g.current.mode;

    if (mode === "swipe-x" && r) {
      const threshold = r.width * 0.22;
      if (dragX <= -threshold && current < count - 1) goTo(current + 1);
      else if (dragX >= threshold && current > 0) goTo(current - 1);
    } else if (mode === "close-y" && r) {
      if (dragY > r.height * 0.18) {
        onClose();
        setDragX(0);
        setDragY(0);
        return;
      }
    } else if (mode === "tap" && !g.current.moved) {
      const dur = Date.now() - g.current.startTime;
      if (dur < 400) registerTap({ x: e.clientX, y: e.clientY });
    }

    setDragX(0);
    setDragY(0);
    g.current.mode = "idle";
  };

  React.useEffect(() => {
    return () => {
      if (tap.current.timer !== null) window.clearTimeout(tap.current.timer);
    };
  }, []);

  // Keyboard: Esc closes, arrows page (nice on desktop preview).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && !zoomed) goTo(current + 1);
      else if (e.key === "ArrowLeft" && !zoomed) goTo(current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, zoomed, goTo, onClose]);

  // Nothing to show (store emptied) — render nothing rather than an empty black.
  if (count === 0) return null;

  const activeItem: MediaViewerItem | undefined = items[current];
  const transition = animating || reduced ? "none" : "transform 260ms ease-out";
  const bgAlpha = surfaceH > 0 ? clamp(1 - dragY / (surfaceH * 1.4), 0.4, 1) : 1;

  const trackTransform = `translateX(calc(${(-current * 100) / count}% + ${dragX}px))`;

  return (
    <div
      data-testid="media-viewer"
      className="absolute inset-0 z-50 select-none overflow-hidden bg-black text-white animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none"
      style={{ backgroundColor: `rgba(0,0,0,${bgAlpha})`, touchAction: "none" }}
    >
      {/* Content wrapper follows the swipe-down drag. */}
      <div
        className="absolute inset-0 flex flex-col"
        style={{
          transform: `translateY(${dragY}px) scale(${dragY > 0 ? clamp(1 - dragY / 2400, 0.9, 1) : 1})`,
          transition: animating || reduced ? "none" : "transform 260ms ease-out",
        }}
      >
        {/* Top bar */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-black/60 to-transparent px-4 pb-6 pt-4">
          <span className="w-10" aria-hidden />
          <div className="flex min-w-0 flex-col items-center leading-tight">
            {count > 1 && (
              <span className="text-sm font-semibold tracking-wide">
                {current + 1} / {count}
              </span>
            )}
            {activeItem?.viewOnce ? (
              <span className="mt-0.5 rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-medium text-primary">
                Просмотр один раз
              </span>
            ) : (
              activeItem?.caption && (
                <span className="mt-0.5 max-w-[220px] truncate text-xs text-white/60">
                  {activeItem.caption}
                </span>
              )
            )}
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            data-testid="media-viewer-close"
            onClick={onClose}
            className="pointer-events-auto grid size-10 place-items-center rounded-full bg-white/10 text-white transition-transform active:scale-95"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>

        {/* Gesture surface + horizontal track */}
        <div
          ref={surfaceRef}
          className="relative flex-1 overflow-hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishGesture}
          onPointerCancel={finishGesture}
          style={{ touchAction: "none", cursor: zoomed ? "grab" : "default" }}
        >
          <div
            className="flex h-full"
            style={{
              width: `${count * 100}%`,
              transform: trackTransform,
              transition,
            }}
          >
            {items.map((item, i) => {
              const isCurrent = i === current;
              return (
                <ViewerSlide
                  key={i}
                  item={item}
                  isCurrent={isCurrent}
                  widthPct={`${100 / count}%`}
                  transform={
                    isCurrent && item.type === "image"
                      ? `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`
                      : undefined
                  }
                  transition={isCurrent ? transition : "none"}
                />
              );
            })}
          </div>
        </div>

        {/* Bottom dot indicators. */}
        {count > 1 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex items-center justify-center gap-2">
            {items.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === current ? "w-5 bg-primary" : "w-1.5 bg-white/40",
                )}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
