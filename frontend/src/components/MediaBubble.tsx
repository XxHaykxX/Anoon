"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { PlayIcon, DownloadIcon, DoubleCheckIcon } from "@/components/icons";

/** Media kind rendered by {@link MediaBubble}. */
export type MediaBubbleKind = "photo" | "video";

/** Lifecycle of the tile: starts blurred, shows a progress ring while "loading", then "loaded". */
type MediaBubbleStatus = "blurred" | "loading" | "loaded";

export interface MediaBubbleProps {
  /** Whether this tile represents a photo or a video. @default "photo" */
  kind?: MediaBubbleKind;
  /** Render as an outgoing (own) message — shows a time + double-check chip. */
  own?: boolean;
  /** Video duration label shown in the bottom-right chip, e.g. "0:32". */
  durationLabel?: string;
  /** Marks the media as view-once (ephemeral) — renders a "1" badge. */
  viewOnce?: boolean;
  /** Called when a fully-loaded tile is tapped again (i.e. "open" the media). */
  onOpen?: () => void;
  /** Size chip text shown while not loaded, e.g. "96Mb". @default "2.4 MB" */
  sizeLabel?: string;
  /** Time chip shown bottom-right — for incoming tiles too (own tiles add a double-check). */
  timeLabel?: string;
  /** Start already loaded (received photo), skipping the tap-to-download control. */
  initialLoaded?: boolean;
  /** Override the tile aspect ratio (Tailwind class, e.g. "aspect-[4/3]"). */
  aspectClassName?: string;
  className?: string;
}

const TOTAL_LOAD_MS = 1200;
const STEP_MS = 30;
const RING_RADIUS = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handleChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}

/**
 * Chat photo/video bubble that starts blurred and loads on tap, showing a
 * circular progress ring while "downloading".
 *
 * Usage:
 * ```tsx
 * <MediaBubble kind="video" durationLabel="0:32" own onOpen={() => setViewerOpen(true)} />
 * <MediaBubble kind="photo" viewOnce />
 * ```
 */
export default function MediaBubble({
  kind = "photo",
  own = false,
  durationLabel,
  viewOnce = false,
  onOpen,
  sizeLabel = "2.4 MB",
  timeLabel,
  initialLoaded = false,
  aspectClassName,
  className,
}: MediaBubbleProps) {
  const [status, setStatus] = React.useState<MediaBubbleStatus>(
    initialLoaded ? "loaded" : "blurred",
  );
  const [progress, setProgress] = React.useState(0);
  const reducedMotion = usePrefersReducedMotion();

  React.useEffect(() => {
    if (status !== "loading") return;

    if (reducedMotion) {
      setProgress(100);
      setStatus("loaded");
      return;
    }

    const steps = Math.max(1, Math.round(TOTAL_LOAD_MS / STEP_MS));
    const increment = 100 / steps;

    setProgress(0);
    const id = setInterval(() => {
      setProgress((prev) => {
        const next = prev + increment;
        if (next >= 100) {
          clearInterval(id);
          setStatus("loaded");
          return 100;
        }
        return next;
      });
    }, STEP_MS);

    return () => clearInterval(id);
  }, [status, reducedMotion]);

  const handleTap = () => {
    if (status === "blurred") {
      if (reducedMotion) {
        setProgress(100);
        setStatus("loaded");
        return;
      }
      setStatus("loading");
    } else if (status === "loaded") {
      onOpen?.();
    }
    // While "loading" the tile ignores further taps until the ring completes.
  };

  const isBlurred = status !== "loaded";
  const ringOffset = RING_CIRCUMFERENCE * (1 - progress / 100);

  const label =
    status === "blurred"
      ? `Tap to load ${kind}`
      : status === "loading"
      ? `Loading ${kind}, ${Math.round(progress)}%`
      : `Open ${kind}`;

  return (
    <button
      type="button"
      onClick={handleTap}
      aria-label={label}
      className={cn(
        "relative w-[240px] overflow-hidden rounded-2xl text-left",
        aspectClassName ?? (kind === "video" ? "aspect-video" : "aspect-[3/4]"),
        own ? "self-end" : "self-start",
        className,
      )}
    >
      {/* Muted gradient "image" background */}
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-br from-neutral-600 via-neutral-700 to-neutral-900",
          isBlurred && "blur-md scale-105",
          !reducedMotion && "transition-[filter,transform] duration-500 ease-out",
        )}
      />

      {/* Faint frosted glass layer, fades out once loaded */}
      <div
        className={cn(
          "absolute inset-0 bg-white/5 backdrop-blur-sm",
          status === "loaded" && "pointer-events-none opacity-0",
          !reducedMotion && "transition-opacity duration-500 ease-out",
        )}
      />

      {/* Size chip */}
      {status !== "loaded" && (
        <span className="absolute left-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {sizeLabel}
        </span>
      )}

      {/* View-once badge */}
      {viewOnce && (
        <span
          aria-label="View once"
          className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-black/50 text-[10px] font-semibold text-white ring-1 ring-white/70 backdrop-blur-sm"
        >
          1
        </span>
      )}

      {/* Centered control: blurred (tap-to-load) or loading (progress ring) */}
      {status !== "loaded" && (
        <div className="absolute inset-0 grid place-items-center">
          {status === "blurred" ? (
            <span className="grid size-14 place-items-center rounded-full border border-white/30 bg-black/40 text-white backdrop-blur-sm">
              {kind === "video" ? (
                <PlayIcon className="size-6 translate-x-0.5" />
              ) : (
                <DownloadIcon className="size-6" />
              )}
            </span>
          ) : (
            <span className="relative grid size-14 place-items-center">
              <svg viewBox="0 0 48 48" className="size-14 -rotate-90">
                <circle
                  cx={24}
                  cy={24}
                  r={RING_RADIUS}
                  fill="rgba(0,0,0,0.4)"
                  stroke="rgba(255,255,255,0.25)"
                  strokeWidth={3}
                />
                <circle
                  cx={24}
                  cy={24}
                  r={RING_RADIUS}
                  fill="none"
                  className="text-primary"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={ringOffset}
                />
              </svg>
              <span className="absolute text-[11px] font-semibold text-white">
                {Math.round(progress)}%
              </span>
            </span>
          )}
        </div>
      )}

      {/* Video play affordance persists once loaded, since tapping opens the player */}
      {status === "loaded" && kind === "video" && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="grid size-12 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm">
            <PlayIcon className="size-5 translate-x-0.5" />
          </span>
        </div>
      )}

      {/* Bottom-right cluster: video duration chip and/or own time + double-check */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1">
        {kind === "video" && durationLabel && (
          <span className="flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            <PlayIcon className="size-2.5" />
            {durationLabel}
          </span>
        )}
        {own ? (
          <span className="flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {timeLabel ?? "12:41 pm"}
            <DoubleCheckIcon className="size-3.5" />
          </span>
        ) : timeLabel ? (
          <span className="rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {timeLabel}
          </span>
        ) : null}
      </div>
    </button>
  );
}
