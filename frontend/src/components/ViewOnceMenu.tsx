"use client";

import * as React from "react";
import { useState } from "react";

import { CheckIcon } from "@/components/icons";
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

/** Inline icon: infinity / keeps forever (icons.tsx has no InfinityIcon). Used for "Off". */
function InfinityIcon(p: SvgProps) {
  return (
    <svg {...iconBase(p)}>
      <path d="M7.5 9a3.5 3.5 0 0 0 0 7c2.5 0 3.5-2.2 4.5-3.5 1-1.3 2-3.5 4.5-3.5a3.5 3.5 0 0 1 0 7c-2.5 0-3.5-2.2-4.5-3.5-1-1.3-2-3.5-4.5-3.5z" />
    </svg>
  );
}

/** Inline icon: eye / view once (icons.tsx has no EyeIcon). */
function EyeIcon(p: SvgProps) {
  return (
    <svg {...iconBase(p)}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

/** Inline icon: timer / countdown (icons.tsx has no TimerIcon). Used for short durations. */
function TimerIcon(p: SvgProps) {
  return (
    <svg {...iconBase(p)}>
      <path d="M10 2h4" />
      <path d="M12 2v3" />
      <circle cx="12" cy="14" r="8" />
      <path d="M12 10v4l3 2" />
    </svg>
  );
}

/** Inline icon: flame / self-destructing (icons.tsx has no FlameIcon). Used for longer durations. */
function FlameIcon(p: SvgProps) {
  return (
    <svg {...iconBase(p)}>
      <path d="M12 2.5c1 3-3 4-3 7.5a3 3 0 0 0 6 0c0-1.2-.5-2-1-2.7.7 3.2 3 3.9 3 6.7a5 5 0 0 1-10 0c0-4.5 3-6.5 5-11.5z" />
    </svg>
  );
}

/** A single selectable duration/media-visibility option offered by {@link ViewOnceMenu}. */
export type ViewOnceOption = "off" | "once" | "5s" | "15s" | "1m";

interface ViewOnceOptionMeta {
  id: ViewOnceOption;
  label: string;
  description: string;
  icon: (p: SvgProps) => React.JSX.Element;
}

const VIEW_ONCE_OPTIONS: ViewOnceOptionMeta[] = [
  { id: "off", label: "Off", description: "Keep in chat", icon: InfinityIcon },
  { id: "once", label: "View once", description: "Opens once then gone", icon: EyeIcon },
  { id: "5s", label: "5 seconds", description: "Disappears 5s after opening", icon: TimerIcon },
  { id: "15s", label: "15 seconds", description: "Disappears 15s after opening", icon: TimerIcon },
  { id: "1m", label: "1 minute", description: "Disappears 1m after opening", icon: FlameIcon },
];

export interface ViewOnceMenuProps {
  /** Called with the chosen option when the user taps "Done". */
  onSelect: (option: ViewOnceOption) => void;
  /** Called after a selection is confirmed, or when the scrim/handle is tapped to dismiss. */
  onClose?: () => void;
  /** Additional classes merged onto the root (scrim) element. */
  className?: string;
}

/**
 * Bottom sheet for picking a disappearing-media option before sending a photo/video.
 *
 * Usage:
 * ```tsx
 * {viewOnceOpen && (
 *   <ViewOnceMenu
 *     onSelect={(option) => setMediaOption(option)}
 *     onClose={() => setViewOnceOpen(false)}
 *   />
 * )}
 * ```
 */
export default function ViewOnceMenu({ onSelect, onClose, className }: ViewOnceMenuProps) {
  const [selected, setSelected] = useState<ViewOnceOption>("off");

  const handleDone = () => {
    onSelect(selected);
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
        aria-label="Disappearing media"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close disappearing media menu"
          className="mx-auto mb-3 block h-1.5 w-10 shrink-0 cursor-pointer rounded-full bg-muted-foreground/30 transition-transform active:scale-95"
        />

        <h2 className="mb-2 px-1 text-base font-semibold text-foreground">Disappearing media</h2>

        <div role="radiogroup" aria-label="Disappearing media options" className="flex flex-col">
          {VIEW_ONCE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = option.id === selected;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelected(option.id)}
                className="flex cursor-pointer items-center gap-3 rounded-2xl px-1 py-2.5 text-left transition-transform active:scale-95"
              >
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground"
                  aria-hidden="true"
                >
                  <Icon className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{option.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{option.description}</span>
                </span>
                {isSelected && (
                  <CheckIcon className="size-5 shrink-0 text-primary" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleDone}
          className="mt-3 w-full cursor-pointer rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform active:scale-95"
        >
          Done
        </button>
      </div>
    </div>
  );
}
