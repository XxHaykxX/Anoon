"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { PlayIcon, PauseIcon } from "@/components/icons";

interface VoiceMessageProps {
  /**
   * Real audio source. When provided the waveform is driven by an actual
   * `<audio>` element (play/pause/seek/progress). When omitted the component
   * runs a self-contained simulated playback — used by the mock/showcase.
   */
  src?: string;
  durationSec?: number;
  own?: boolean;
  className?: string;
  /** data-testid for the bubble root (QA anchor). @default "voice-bubble" */
  rootTestId?: string;
  /** Bubbled up when the audio ref fails to load (parent shows a broken note). */
  onError?: () => void;
}

const BAR_COUNT = 40;

/** Deterministic pseudo-random bar heights (0..1) so SSR/CSR markup always match. */
const BAR_HEIGHTS: readonly number[] = Array.from({ length: BAR_COUNT }, (_, i) => {
  // Simple deterministic hash -> stable "random-looking" waveform.
  const seed = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  const frac = seed - Math.floor(seed);
  return 0.25 + frac * 0.75; // keep bars visually non-trivial (25%..100%)
});

function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Chat voice-note bubble with an animated waveform.
 * - Real:  `<VoiceMessage src={url} durationSec={10} own />`
 * - Mock:  `<VoiceMessage durationSec={10} own />` (simulated playback)
 */
export default function VoiceMessage({
  src,
  durationSec = 10,
  own = false,
  className,
  rootTestId = "voice-bubble",
  onError,
}: VoiceMessageProps) {
  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  // Real audio's true duration (from metadata) overrides the passed hint once known.
  const [loadedDuration, setLoadedDuration] = React.useState<number | null>(null);

  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const duration = loadedDuration ?? (durationSec > 0 ? durationSec : 10);

  // Simulated playback — only when there is no real audio to drive.
  React.useEffect(() => {
    if (src || !playing) return;

    const stepMs = 100;
    const step = stepMs / (duration * 1000);

    const id = setInterval(() => {
      setProgress((prev) => {
        const next = prev + step;
        if (next >= 1) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
    }, stepMs);

    return () => clearInterval(id);
  }, [src, playing, duration]);

  const toggle = React.useCallback(() => {
    if (!src) {
      setPlaying((p) => !p);
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  }, [src]);

  const seekTo = React.useCallback(
    (ratio: number) => {
      const el = audioRef.current;
      const clamped = Math.min(1, Math.max(0, ratio));
      if (src && el && Number.isFinite(duration)) {
        el.currentTime = clamped * duration;
        setProgress(clamped);
      } else if (!src) {
        setProgress(clamped);
      }
    },
    [src, duration],
  );

  const elapsedSec = progress * duration;
  const activeBarIndex = Math.min(BAR_COUNT - 1, Math.floor(progress * BAR_COUNT));

  return (
    <div
      data-testid={rootTestId}
      className={cn(
        "rounded-2xl px-3 py-2 flex items-center gap-3",
        own
          ? "bg-bubble-out text-bubble-out-foreground self-end"
          : "bg-bubble-in text-bubble-in-foreground self-start",
        className
      )}
    >
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          className="hidden"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setLoadedDuration(d);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            // MediaRecorder webm blobs often report Infinity duration until
            // fully buffered — fall back to the known/hint duration so the
            // waveform still progresses.
            const d =
              Number.isFinite(el.duration) && el.duration > 0
                ? el.duration
                : loadedDuration ?? durationSec;
            if (d > 0) setProgress(Math.min(1, el.currentTime / d));
          }}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
            if (audioRef.current) audioRef.current.currentTime = 0;
          }}
          onError={() => onError?.()}
        />
      )}

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
        aria-pressed={playing}
        data-testid="voice-play"
        className={cn(
          "size-9 shrink-0 rounded-full grid place-items-center",
          own ? "bg-black/10" : "bg-primary text-primary-foreground"
        )}
      >
        {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
      </button>

      <div
        className="flex items-center gap-[2px] h-7 cursor-pointer"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          seekTo((e.clientX - r.left) / r.width);
        }}
      >
        {BAR_HEIGHTS.map((h, i) => {
          const played = i < activeBarIndex;
          const isActive = playing && i === activeBarIndex;
          return (
            <span
              key={i}
              className={cn(
                "w-[2px] rounded-full transition-colors duration-150",
                own
                  ? played
                    ? "bg-black/70"
                    : "bg-black/25"
                  : played
                  ? "bg-primary"
                  : "bg-muted-foreground/30",
                isActive && "anoon-voicebar--pulse"
              )}
              style={{ height: `${Math.round(h * 100)}%` }}
            />
          );
        })}
      </div>

      <span className="text-xs tabular-nums shrink-0 opacity-70">
        {playing || progress > 0 ? formatTime(elapsedSec) : formatTime(duration)}
      </span>

      <style>{`
        @keyframes anoon-voicebar-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
        .anoon-voicebar--pulse {
          animation: anoon-voicebar-pulse 0.6s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .anoon-voicebar--pulse {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
