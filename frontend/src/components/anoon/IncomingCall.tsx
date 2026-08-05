"use client";

import * as React from "react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { AnoonAvatar } from "@/components/anoon/_shared";
import { PhoneIcon } from "@/components/icons";

export interface IncomingCallProps {
  peerName: string;
  peerId: string;
  media: "audio" | "video";
  onAccept: () => void;
  onDecline: () => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

/** Deterministic avatar tone from the peer id, stable across re-renders. */
function toneFor(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return sum % 6;
}

/**
 * Full-screen ringing screen shown to a callee before they accept/decline.
 *
 * Usage: `<IncomingCall peerName="Собеседник" peerId="#04217" media="video" onAccept={accept} onDecline={decline} />`
 */
export default function IncomingCall({ peerName, peerId, media, onAccept, onDecline }: IncomingCallProps) {
  const initials = useMemo(() => getInitials(peerName), [peerName]);
  const tone = useMemo(() => toneFor(peerId), [peerId]);
  const kindLabel = media === "video" ? "Входящий видео-звонок" : "Входящий аудио-звонок";

  return (
    // `absolute`, not `fixed`: the whole app renders inside a fixed-size phone
    // frame (see AnoonApp), so a viewport-fixed overlay would break out of it.
    //
    // Design tokens, not raw neutrals/white: `background`+`foreground` render
    // #000/#fff under the app's forced dark (AnoonApp's `<div className="dark">`),
    // i.e. identical to the old bg-neutral-950/text-white, but they follow the
    // theme if it is ever unforced. Literal white/black survives ONLY where it
    // sits on a fixed-colour fill (the red decline / green accept buttons),
    // which reads the same in either theme.
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-between overflow-hidden bg-background px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))] text-foreground animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <span className="relative flex items-center justify-center">
          {/* Concentric pinging rings — matches the roulette "searching" motif. */}
          <span className="absolute size-52 rounded-full bg-primary/10 [animation-duration:2.4s] animate-ping motion-reduce:animate-none" />
          <span className="absolute size-40 rounded-full bg-primary/15 [animation-delay:0.3s] [animation-duration:2s] animate-ping motion-reduce:animate-none" />
          <span className="absolute size-52 rounded-full border border-primary/20" />
          <AnoonAvatar initials={initials} tone={tone} size={128} className="relative shadow-xl" />
        </span>

        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-xl font-semibold">{peerName}</p>
          <p className="text-sm tabular-nums text-foreground/50">{peerId}</p>
          <p className="mt-1 text-sm text-foreground/70">{kindLabel}</p>
        </div>
      </div>

      <div className="flex w-full items-center justify-around pb-4">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            aria-label="Отклонить звонок"
            onClick={onDecline}
            className={cn(
              "grid size-16 place-items-center rounded-full bg-destructive text-white shadow-[0_8px_24px_rgba(255,59,48,0.35)]",
              "transition-transform active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
            )}
          >
            <PhoneIcon className="size-7 rotate-[135deg]" />
          </button>
          <span className="text-xs text-foreground/70">Отклонить</span>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            aria-label="Принять звонок"
            onClick={onAccept}
            className={cn(
              "grid size-16 place-items-center rounded-full bg-online text-black shadow-[0_8px_24px_rgba(52,199,89,0.35)]",
              "transition-transform active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
            )}
          >
            <PhoneIcon className="size-7" />
          </button>
          <span className="text-xs text-foreground/70">Принять</span>
        </div>
      </div>
    </div>
  );
}
