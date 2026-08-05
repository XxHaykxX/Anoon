"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type SvgProps = React.SVGProps<SVGSVGElement>;

const iconBase = (p: SvgProps) => ({
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

/** Inline icon: image/photo (icons.tsx has no PhotoIcon). */
function PhotoIcon(p: SvgProps) {
  return (
    <svg {...iconBase(p)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.75" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </svg>
  );
}

/** Inline icon: video / film (icons.tsx has no VideoIcon). */
function VideoIcon(p: SvgProps) {
  return (
    <svg {...iconBase(p)}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3z" />
    </svg>
  );
}

interface AttachOption {
  id: string;
  label: string;
  icon: (p: SvgProps) => React.JSX.Element;
  /** Tasteful, calm tint applied as inline background/text colors for the tile. */
  tint: { bg: string; fg: string };
}

// Only photo + video are offered — real upload/send. File/location/contact/
// poll/music/gif were removed by product decision (roulette chat is media-light).
const ATTACH_OPTIONS: AttachOption[] = [
  { id: "photo", label: "Фото", icon: PhotoIcon, tint: { bg: "#E8EEFB", fg: "#3B5FCC" } },
  { id: "video", label: "Видео", icon: VideoIcon, tint: { bg: "#FCE8EE", fg: "#C23A63" } },
];

export interface AttachMenuProps {
  /** Called with the selected option's id (e.g. "photo", "camera") when a tile is tapped. */
  onSelect: (id: string) => void;
  /** Called after a selection, or when the scrim/handle area is tapped to dismiss without selecting. */
  onClose?: () => void;
  /** Additional classes merged onto the root (scrim) element. */
  className?: string;
}

/**
 * Bottom sheet of attachment options that rises from the composer's "+" button.
 *
 * Usage:
 * ```tsx
 * {attachOpen && (
 *   <AttachMenu
 *     onSelect={(id) => handleAttach(id)}
 *     onClose={() => setAttachOpen(false)}
 *   />
 * )}
 * ```
 */
export default function AttachMenu({ onSelect, onClose, className }: AttachMenuProps) {
  const handleSelect = (id: string) => {
    onSelect(id);
    onClose?.();
  };

  return (
    <div
      className={cn("absolute inset-0 z-50 bg-black/40", className)}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="absolute right-0 bottom-0 left-0 rounded-t-3xl bg-popover p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Attach"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close attach menu"
          className="mx-auto mb-4 block h-1.5 w-10 shrink-0 cursor-pointer rounded-full bg-muted-foreground/30 transition-transform active:scale-95"
        />

        <div className="flex justify-center gap-8 py-1">
          {ATTACH_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => handleSelect(option.id)}
                className="flex cursor-pointer flex-col items-center gap-1.5 transition-transform active:scale-95"
              >
                <span
                  className="grid size-14 place-items-center rounded-2xl"
                  style={{ backgroundColor: option.tint.bg, color: option.tint.fg }}
                  aria-hidden="true"
                >
                  <Icon className="size-6" />
                </span>
                <span className="text-xs font-medium text-foreground">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
