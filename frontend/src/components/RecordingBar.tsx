"use client";

import { useEffect, useRef, useState } from "react";

import { MicIcon, SendIcon, TrashIcon } from "@/components/icons";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils";

/** Number of waveform bars kept on screen before the oldest ones are dropped. */
const MAX_BARS = 50;
/** How often a new waveform bar is appended, in milliseconds. */
const BAR_PUSH_INTERVAL_MS = 200;
/** How often the recording timer advances, in milliseconds. */
const TIMER_INTERVAL_MS = 1000;
/** Number of most-recent bars rendered with the "active" (bg-primary) color. */
const ACTIVE_BAR_COUNT = 8;
/** Minimum / maximum bar height, in pixels. */
const MIN_BAR_HEIGHT_PX = 4;
const MAX_BAR_HEIGHT_PX = 32;

export interface RecordingBarProps {
  /** Called with the elapsed recording duration (in seconds) when the send button is pressed. */
  onSend?: (durationSec: number) => void;
  /** Called when the cancel/trash button is pressed. */
  onCancel?: () => void;
  /** Additional classes merged onto the root element. */
  className?: string;
}

interface WaveformBar {
  id: number;
  heightPx: number;
}

/**
 * Deterministic pseudo-random bar height derived from a sine-based hash of the index
 * (avoids Math.random so the waveform is reproducible/testable).
 */
function pseudoBarHeight(index: number): number {
  const raw = Math.sin(index * 12.9898 + 78.233) * 43758.5453123;
  const fraction = raw - Math.floor(raw);
  return Math.round(MIN_BAR_HEIGHT_PX + fraction * (MAX_BAR_HEIGHT_PX - MIN_BAR_HEIGHT_PX));
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Usage: `<RecordingBar onSend={(sec) => sendVoiceNote(sec)} onCancel={() => setRecording(false)} />`
 */
export default function RecordingBar({ onSend, onCancel, className }: RecordingBarProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [bars, setBars] = useState<WaveformBar[]>([]);
  const prefersReducedMotion = usePrefersReducedMotion();
  const nextBarIndexRef = useRef(0);

  // Running timer.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setElapsedSeconds((previous) => previous + 1);
    }, TIMER_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  // Live growing waveform: append a new bar periodically, capping the buffer.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const index = nextBarIndexRef.current;
      nextBarIndexRef.current += 1;

      setBars((previous) => {
        const next = [...previous, { id: index, heightPx: pseudoBarHeight(index) }];
        return next.length > MAX_BARS ? next.slice(next.length - MAX_BARS) : next;
      });
    }, BAR_PUSH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  const handleSend = () => {
    onSend?.(elapsedSeconds);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 border-t border-border bg-background",
        className,
      )}
    >
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel recording"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <TrashIcon className="size-5" aria-hidden="true" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
          aria-hidden="true"
        >
          <MicIcon className="size-3.5" />
        </span>

        <span
          className={cn(
            "size-2.5 shrink-0 rounded-full bg-red-500",
            !prefersReducedMotion && "animate-pulse",
          )}
          aria-hidden="true"
        />

        <span className="shrink-0 text-sm font-medium text-foreground">Recording…</span>

        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {formatDuration(elapsedSeconds)}
        </span>

        <div
          className="flex h-8 flex-1 items-end gap-[2px] overflow-hidden"
          role="img"
          aria-label="Live waveform of the current voice recording"
        >
          {bars.map((bar, index) => (
            <span
              key={bar.id}
              style={{ height: `${bar.heightPx}px` }}
              className={cn(
                "w-[3px] shrink-0 rounded-full transition-colors",
                index >= bars.length - ACTIVE_BAR_COUNT ? "bg-primary" : "bg-muted-foreground/30",
              )}
            />
          ))}
        </div>

        <span className="hidden shrink-0 text-xs text-muted-foreground select-none sm:inline">
          ‹ slide to cancel
        </span>
      </div>

      <button
        type="button"
        onClick={handleSend}
        aria-label="Send voice message"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90"
      >
        <SendIcon className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
