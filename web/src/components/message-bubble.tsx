"use client";

import { Check, CheckCheck, ImageOff, Play } from "lucide-react";

import type { LightboxItem } from "@/components/media-lightbox";
import { VoiceBubble } from "@/components/voice-bubble";
import { type Msg } from "@/store/chat";
import { cn } from "@/lib/utils";

// Пузырь сообщения: текст / фото / видео / голос. Фото и видео открываются в лайтбоксе по тапу.
export function MessageBubble({ m, onOpenMedia }: { m: Msg; onOpenMedia: (item: LightboxItem) => void }) {
  const base = cn(
    "max-w-[78%] overflow-hidden text-sm",
    m.mine ? "rounded-2xl rounded-br-md bg-accent text-accent-fg" : "rounded-2xl rounded-bl-md bg-surface-2 text-fg",
  );

  // Медиа недоступно после перезагрузки (blob-URL умер) — плашка вместо тайла.
  if ((m.kind === "image" || m.kind === "video") && (m.stale || !m.url)) {
    return (
      <div className={cn(base, "flex items-center gap-2 px-3.5 py-3 text-fg-muted")}>
        <ImageOff size={16} />
        <span className="text-xs">Медиа недоступно</span>
      </div>
    );
  }

  if (m.kind === "image" && m.url) {
    return (
      <button onClick={() => onOpenMedia({ kind: "image", url: m.url! })} className={cn(base, "block")} aria-label="Открыть фото">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.url} alt="фото" className="block max-h-72 w-56 object-cover" loading="lazy" />
      </button>
    );
  }

  if (m.kind === "video" && m.url) {
    return (
      <button onClick={() => onOpenMedia({ kind: "video", url: m.url! })} className={cn(base, "relative block")} aria-label="Открыть видео">
        <video src={m.url} muted playsInline preload="metadata" className="block max-h-72 w-56 object-cover" />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white">
            <Play size={24} fill="currentColor" />
          </span>
        </span>
        {m.durationSec ? (
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white">
            {Math.floor(m.durationSec / 60)}:{String(m.durationSec % 60).padStart(2, "0")}
          </span>
        ) : null}
      </button>
    );
  }

  if (m.kind === "voice") {
    return <VoiceBubble url={m.url} durationSec={m.durationSec} mine={m.mine} />;
  }

  return (
    <div className={cn(base, "px-3.5 py-2")}>
      <span>{m.text}</span>
      {m.mine ? <StatusTicks status={m.status} /> : null}
    </div>
  );
}

// Тики статуса для своих сообщений: ✓ отправлено, ✓✓ прочитано.
function StatusTicks({ status }: { status?: Msg["status"] }) {
  return (
    <span className="ml-1.5 inline-flex translate-y-0.5 align-middle text-accent-fg/70" aria-label={status === "read" ? "Прочитано" : "Отправлено"}>
      {status === "read" ? <CheckCheck size={13} /> : <Check size={13} />}
    </span>
  );
}
