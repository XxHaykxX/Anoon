"use client";

import { useState, type SVGProps } from "react";
import { cn } from "@/lib/utils";
import { CloseIcon, SendIcon } from "@/components/icons";

type IconProps = SVGProps<SVGSVGElement>;

/** Crop icon — not present in the shared icon set. */
const CropIcon = (p: IconProps) => (
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
    <path d="M6 2v16a1 1 0 0 0 1 1h16" />
    <path d="M2 6h16a1 1 0 0 1 1 1v16" />
  </svg>
);

/** Draw / pencil icon — not present in the shared icon set. */
const DrawIcon = (p: IconProps) => (
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
    <path d="M4 20l4-1 10-10a2 2 0 0 0-3-3L5 16z" />
    <path d="M13.5 6.5l3 3" />
  </svg>
);

/** Sticker / smiling square icon — not present in the shared icon set. */
const StickerIcon = (p: IconProps) => (
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
    <path d="M4 5a1 1 0 0 1 1-1h9l6 6v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    <path d="M14 4v5a1 1 0 0 0 1 1h5" />
    <path d="M9 14c.6.8 1.5 1.3 2.5 1.3S13.4 14.8 14 14" />
  </svg>
);

/** Plus / add-more icon — not present in the shared icon set. */
const AddIcon = (p: IconProps) => (
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
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const PRESS_FX = "active:scale-95 transition-transform cursor-pointer";

/** Number of thumbnail placeholder tiles rendered in the strip. */
const THUMBNAIL_COUNT = 3;

export type MediaPreviewProps = {
  /** Called when the user taps Send, with the composed caption and view-once flag. */
  onSend?: (opts: { caption: string; viewOnce: boolean }) => void;
  /** Called when the preview should close (X button). Also called right after `onSend`. */
  onClose?: () => void;
  className?: string;
};

/**
 * Fullscreen media preview shown after picking a photo/video, before sending, for the
 * Anoon messenger.
 *
 * Usage:
 * ```tsx
 * <MediaPreview
 *   onSend={({ caption, viewOnce }) => sendMedia({ caption, viewOnce })}
 *   onClose={() => setPreviewOpen(false)}
 * />
 * ```
 */
export default function MediaPreview({
  onSend,
  onClose,
  className,
}: MediaPreviewProps) {
  const [caption, setCaption] = useState("");
  const [viewOnce, setViewOnce] = useState(false);
  const [activeThumb, setActiveThumb] = useState(0);

  const handleSend = () => {
    onSend?.({ caption, viewOnce });
    onClose?.();
  };

  return (
    <div className={cn("absolute inset-0 flex flex-col bg-black/95 text-white", className)}>
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 px-4 pt-4">
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Crop"
            className={cn(
              "grid size-10 place-items-center rounded-full bg-white/10 text-white",
              PRESS_FX,
            )}
          >
            <CropIcon className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Draw"
            className={cn(
              "grid size-10 place-items-center rounded-full bg-white/10 text-white",
              PRESS_FX,
            )}
          >
            <DrawIcon className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Sticker"
            className={cn(
              "grid size-10 place-items-center rounded-full bg-white/10 text-white",
              PRESS_FX,
            )}
          >
            <StickerIcon className="size-5" />
          </button>
        </div>
      </div>

      {/* Center media placeholder */}
      <div className="m-4 flex flex-1 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-neutral-700 via-neutral-800 to-neutral-900">
        <span className="text-sm text-white/40">Photo preview</span>
      </div>

      {/* Thumbnail strip */}
      <div className="flex items-center justify-center gap-2 px-4 pb-4">
        {Array.from({ length: THUMBNAIL_COUNT }, (_, i) => i).map((i) => (
          <button
            key={i}
            type="button"
            aria-label={`Select image ${i + 1}`}
            aria-current={i === activeThumb}
            onClick={() => setActiveThumb(i)}
            className={cn(
              "size-12 shrink-0 rounded-lg bg-gradient-to-br from-neutral-700 to-neutral-900",
              i === activeThumb ? "ring-2 ring-primary" : "opacity-60",
              PRESS_FX,
            )}
          />
        ))}
        <button
          type="button"
          aria-label="Add more"
          className={cn(
            "grid size-12 shrink-0 place-items-center rounded-lg border border-dashed border-white/30 text-white/60",
            PRESS_FX,
          )}
        >
          <AddIcon className="size-5" />
        </button>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center gap-2 px-4 pb-4">
        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Add a caption..."
          className="h-11 flex-1 rounded-full bg-white/10 px-4 text-sm text-white placeholder:text-white/50 outline-none"
        />

        <button
          type="button"
          aria-label="Toggle view once"
          aria-pressed={viewOnce}
          onClick={() => setViewOnce((v) => !v)}
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold",
            viewOnce ? "bg-primary text-black" : "bg-white/10 text-white",
            PRESS_FX,
          )}
        >
          1
        </button>

        <button
          type="button"
          aria-label="Send"
          onClick={handleSend}
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground",
            PRESS_FX,
          )}
        >
          <SendIcon className="size-5" />
        </button>
      </div>
    </div>
  );
}
