"use client";

import { useEffect, useState, type ReactNode, type SVGProps } from "react";
import { cn } from "@/lib/utils";
import { MicIcon, VideoIcon, PhoneIcon } from "@/components/icons";

type CallIconProps = SVGProps<SVGSVGElement>;

const callIconBase = (p: CallIconProps) => ({
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

/** Sound-wave speaker glyph — not present in the shared icon set. */
const SpeakerIcon = (p: CallIconProps) => (
  <svg {...callIconBase(p)}>
    <path d="M4 10v4h4l5 4V6l-5 4z" />
    <path d="M16.5 9a4.2 4.2 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11" />
  </svg>
);

/** Mic-off glyph used for the muted (filled/active) state of the Mute button. */
const MicOffIcon = (p: CallIconProps) => (
  <svg {...callIconBase(p)}>
    <path d="M9 9V5a3 3 0 0 1 6 0v4" />
    <path d="M6 11a6 6 0 0 0 8.6 5.4M18 11a6 6 0 0 1-1.2 3.6" />
    <path d="M12 17v4M3 3l18 18" />
  </svg>
);

const PRESS_FX = "active:scale-95 transition-transform cursor-pointer";
const RINGING_SECONDS = 2;

export type CallScreenProps = {
  name?: string;
  video?: boolean;
  onEnd?: () => void;
  className?: string;
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const m = Math.floor(safe / 60).toString().padStart(2, "0");
  const s = Math.floor(safe % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

type ControlButtonProps = {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
};

function ControlButton({ label, active, onClick, children }: ControlButtonProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          "grid size-14 place-items-center rounded-full",
          active ? "bg-[color:var(--primary)] text-black" : "bg-white/10 text-white",
          PRESS_FX,
        )}
      >
        {children}
      </button>
      <span className="text-xs text-white/70">{label}</span>
    </div>
  );
}

/**
 * Usage: `<CallScreen name="Nora" video onEnd={close} />`
 */
export default function CallScreen({
  name = "Nora Bennett",
  video = false,
  onEnd,
  className,
}: CallScreenProps) {
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [videoOn, setVideoOn] = useState(video);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const isRinging = seconds < RINGING_SECONDS;
  const statusLabel = isRinging ? "Ringing…" : formatDuration(seconds - RINGING_SECONDS);
  const initials = getInitials(name);

  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col overflow-hidden bg-neutral-950 text-white",
        className,
      )}
    >
      <div className="relative flex-1 overflow-hidden">
        {videoOn ? (
          <>
            {/* Full-bleed muted "remote video" surface */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,#3a3a42_0%,#141417_55%,#0a0a0c_100%)]" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div
                className="grid size-24 place-items-center rounded-full text-2xl font-semibold text-white/90"
                style={{ background: "linear-gradient(135deg, #4b4b55 0%, #232329 100%)" }}
              >
                {initials}
              </div>
              <p className="text-lg font-medium">{name}</p>
              <p className="text-sm text-white/60">{statusLabel}</p>
            </div>

            {/* Self-view thumbnail */}
            <div
              className="absolute right-4 top-4 h-32 w-24 overflow-hidden rounded-2xl border border-white/15 shadow-[var(--elevation-3)]"
              style={{ background: "linear-gradient(160deg, rgba(253,191,45,0.2) 0%, #232329 70%)" }}
            >
              <div className="grid h-full w-full place-items-center text-xs text-white/70">You</div>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6">
            <div
              className="grid size-36 place-items-center rounded-full text-4xl font-semibold text-black shadow-[var(--elevation-3)]"
              style={{ background: "linear-gradient(135deg, var(--primary) 0%, #b8860b 100%)" }}
            >
              {initials}
            </div>
            <div className="flex flex-col items-center gap-1">
              <p className="text-xl font-semibold">{name}</p>
              <p className="text-sm text-white/60">{statusLabel}</p>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-end justify-center gap-6 pb-10 pt-6">
        <ControlButton label="Mute" active={muted} onClick={() => setMuted((v) => !v)}>
          {muted ? <MicOffIcon className="size-6" /> : <MicIcon className="size-6" />}
        </ControlButton>

        <ControlButton label="Speaker" active={speaker} onClick={() => setSpeaker((v) => !v)}>
          <SpeakerIcon className="size-6" />
        </ControlButton>

        <ControlButton label="Video" active={videoOn} onClick={() => setVideoOn((v) => !v)}>
          <VideoIcon className="size-6" />
        </ControlButton>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            aria-label="End call"
            onClick={onEnd}
            className={cn(
              "grid size-14 place-items-center rounded-full bg-[color:var(--destructive)] text-white",
              PRESS_FX,
            )}
          >
            <PhoneIcon className="size-6 rotate-[135deg]" />
          </button>
          <span className="text-xs text-white/70">End</span>
        </div>
      </div>
    </div>
  );
}
