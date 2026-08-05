"use client";

import { useMemo, useState, type SVGProps } from "react";
import { cn } from "@/lib/utils";
import {
  CloseIcon,
  DownloadIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@/components/icons";

type MoreIconProps = SVGProps<SVGSVGElement>;

/** Vertical "more options" ellipsis glyph — not present in the shared icon set. */
const MoreIcon = (p: MoreIconProps) => (
  <svg
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

const PRESS_FX = "active:scale-95 transition-transform cursor-pointer";

export type ImageViewerProps = {
  /** 1-based index of the photo currently shown. */
  index?: number;
  /** Total number of photos in the set. */
  total?: number;
  /** Called when the viewer should close (X button or scrim click). */
  onClose?: () => void;
  className?: string;
};

/**
 * Fullscreen photo viewer overlay for the Anoon messenger.
 *
 * Usage:
 * ```tsx
 * <ImageViewer index={1} total={5} onClose={() => setViewerOpen(false)} />
 * ```
 */
export default function ImageViewer({
  index = 1,
  total = 1,
  onClose,
  className,
}: ImageViewerProps) {
  const safeTotal = Math.max(1, total);
  const clampIndex = useMemo(
    () => (n: number) => Math.min(Math.max(n, 1), safeTotal),
    [safeTotal],
  );

  const [current, setCurrent] = useState(() => clampIndex(index));
  const [zoomed, setZoomed] = useState(false);

  const goPrev = () => {
    setZoomed(false);
    setCurrent((c) => clampIndex(c - 1));
  };

  const goNext = () => {
    setZoomed(false);
    setCurrent((c) => clampIndex(c + 1));
  };

  const toggleZoom = () => setZoomed((z) => !z);

  const thumbnails = useMemo(
    () => Array.from({ length: safeTotal }, (_, i) => i + 1),
    [safeTotal],
  );

  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col bg-black/95 text-white",
        className,
      )}
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between gap-4 px-4 pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={cn(
            "grid size-10 place-items-center rounded-full bg-white/10 text-white",
            PRESS_FX,
          )}
        >
          <CloseIcon className="size-5" />
        </button>

        <span className="text-sm font-medium text-white/80">
          {current} / {safeTotal}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Download"
            className={cn(
              "grid size-10 place-items-center rounded-full bg-white/10 text-white",
              PRESS_FX,
            )}
          >
            <DownloadIcon className="size-5" />
          </button>
          <button
            type="button"
            aria-label="More options"
            className={cn(
              "grid size-10 place-items-center rounded-full bg-white/10 text-white",
              PRESS_FX,
            )}
          >
            <MoreIcon className="size-5" />
          </button>
        </div>
      </div>

      {/* Center photo area */}
      <div className="relative flex flex-1 items-center justify-center gap-3 px-4 py-6">
        {safeTotal > 1 && (
          <button
            type="button"
            aria-label="Previous photo"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            disabled={current <= 1}
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white disabled:opacity-30",
              PRESS_FX,
            )}
          >
            <ChevronLeftIcon className="size-5" />
          </button>
        )}

        <div
          role="button"
          tabIndex={0}
          aria-label="Toggle zoom"
          onClick={(e) => {
            e.stopPropagation();
            toggleZoom();
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            toggleZoom();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleZoom();
            }
          }}
          className="flex aspect-square w-full max-w-md cursor-zoom-in items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-neutral-700 via-neutral-800 to-neutral-900"
        >
          <div
            className="h-full w-full origin-center transition-transform duration-300 ease-out"
            style={{ transform: zoomed ? "scale(2)" : "scale(1)" }}
          >
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-600/60 via-neutral-700/60 to-neutral-900/60">
              <span className="text-sm text-white/40">Photo {current}</span>
            </div>
          </div>
        </div>

        {safeTotal > 1 && (
          <button
            type="button"
            aria-label="Next photo"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            disabled={current >= safeTotal}
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white disabled:opacity-30",
              PRESS_FX,
            )}
          >
            <ChevronRightIcon className="size-5" />
          </button>
        )}
      </div>

      {/* Bottom thumbnail strip */}
      {safeTotal > 1 && (
        <div
          className="flex items-center justify-center gap-2 overflow-x-auto px-4 pb-6"
          onClick={(e) => e.stopPropagation()}
        >
          {thumbnails.map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`Go to photo ${n}`}
              aria-current={n === current}
              onClick={() => {
                setZoomed(false);
                setCurrent(n);
              }}
              className={cn(
                "size-12 shrink-0 rounded-lg bg-gradient-to-br from-neutral-700 to-neutral-900",
                n === current ? "ring-2 ring-primary" : "opacity-60",
                PRESS_FX,
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
