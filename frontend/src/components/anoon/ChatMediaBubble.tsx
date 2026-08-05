"use client";

import * as React from "react";

import { useMediaLoad } from "@/hooks/useMediaLoad";
import { authedFileUrl, type MediaPart } from "@/lib/tinode";
import { cn } from "@/lib/utils";
import { PlayIcon, DoubleCheckIcon } from "@/components/icons";
import VoiceMessage from "@/components/VoiceMessage";

export type { MediaPart };

export interface ChatMediaBubbleProps {
  part: MediaPart;
  /** Render as an outgoing (own) bubble — mirrors the `own`/`mine` split used across the chat bubbles. */
  mine: boolean;
  /** Hook for the parent to open the fullscreen viewer (image only). */
  onOpen?: () => void;
  /** Anon view-once photo: blurred placeholder until opened, then "просмотрено" (Wave-2 #88). */
  viewOnce?: boolean;
  /** Whether this view-once photo has already been opened once. */
  viewed?: boolean;
  /** Time chip overlaid bottom-right (mock parity — media-only messages otherwise show no time). */
  timeLabel?: string;
  /** For own bubbles: render the read double-check in "read" colour when true. */
  read?: boolean;
}

function formatDuration(sec?: number): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Bottom-right meta chip overlaid on a chat photo/video, matching the mock
 * MediaBubble: an optional video-duration pill plus the time (and, for own
 * bubbles, the read double-check tinted by `read`). Renders nothing until the
 * chat screen passes a `timeLabel`.
 */
function MediaMetaChip({
  mine,
  timeLabel,
  read,
  durationLabel,
}: {
  mine: boolean;
  timeLabel?: string;
  read?: boolean;
  durationLabel?: string | null;
}) {
  if (!timeLabel && !durationLabel) return null;
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1">
      {durationLabel && (
        <span className="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          <PlayIcon className="size-2.5" />
          {durationLabel}
        </span>
      )}
      {timeLabel && (
        <span className="flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {timeLabel}
          {mine && (
            <DoubleCheckIcon
              className={cn("size-3.5", read ? "text-read-tick" : "text-white/80")}
            />
          )}
        </span>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Inline document icon (icons.tsx has no dedicated file/document glyph). */
const DocumentIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v5h5" />
  </svg>
);

/** Eye glyph for the view-once "tap to open" state (icons.tsx has none). */
const EyeIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/** Eye-with-slash glyph for the spent "просмотрено" state. */
const EyeOffIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M3 3l18 18" />
    <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
    <path d="M9.9 4.6A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a13.3 13.3 0 0 1-2.16 2.94M6.5 6.6A13.3 13.3 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3-.48" />
  </svg>
);

/**
 * Every bubble in this file is a flex item of the chat thread's scrolling
 * column (`flex flex-1 flex-col … overflow-y-auto` in AnoonPrivateChat /
 * AnoonAnonChat), so all of them must opt out of shrinking.
 *
 * Per CSS Flexbox §4.5 a flex item's `min-height: auto` only resolves to its
 * min-content size while the item's computed `overflow` is `visible`. The
 * photo/video bubbles need `overflow-hidden` to clip the image to `rounded-2xl`,
 * which drops their automatic minimum to **0** — so once the thread's content
 * exceeds its height, flex distributes the negative free space by squashing
 * them, and a media bubble collapses to 0px tall while the `<img>` inside still
 * lays out at full size (clipped away). Text bubbles keep `overflow: visible`
 * and are protected by the automatic minimum, so the media bubble absorbs the
 * whole overflow on its own. Measured: receiver thread overflowing by 541px →
 * button height 0 with scrollHeight 270; `flex-shrink: 0` → 270.
 *
 * A message bubble must never be squeezed by thread overflow — the thread
 * scrolls instead. Keep `shrink-0` on every bubble root below.
 */
const BUBBLE_SHRINK = "shrink-0";

/**
 * Placeholder painted behind the media while it loads. Purely structural — it
 * exists so the bubble reserves height instead of collapsing to 0px, which
 * previously kept an unloaded photo clipped out of the scrolling thread (and
 * therefore never loading at all).
 */
function MediaSkeleton() {
  return (
    <span className="pointer-events-none absolute inset-0 grid place-items-center bg-white/5">
      <span className="size-7 animate-spin rounded-full border-2 border-white/20 border-t-white/60 motion-reduce:animate-none" />
    </span>
  );
}

/** Inline style that reserves the bubble's height until the media has loaded. */
function reserveStyle(part: MediaPart, loaded: boolean): React.CSSProperties | undefined {
  if (loaded) return undefined;
  const ratio = part.width && part.height ? `${part.width} / ${part.height}` : "4 / 3";
  return { aspectRatio: ratio, maxHeight: 320 };
}

/** Shown in place of the media when the url 404s / the asset fails to decode. */
function BrokenNote({ mine }: { mine: boolean }) {
  return (
    <div
      className={`${BUBBLE_SHRINK} max-w-[220px] rounded-2xl px-3 py-2 text-xs ${
        mine
          ? "self-end bg-bubble-out text-bubble-out-foreground/70"
          : "self-start bg-bubble-in text-bubble-in-foreground/70"
      }`}
    >
      не удалось загрузить
    </div>
  );
}

/**
 * Renders a single media attachment inside a chat thread, dispatching on
 * `part.kind`. Self-aligning (own messages hug the right edge) so it can be
 * dropped straight into the same flex-col thread as text bubbles.
 *
 * Usage:
 * ```tsx
 * <ChatMediaBubble part={part} mine={m.own} onOpen={() => openViewer(part)} />
 * ```
 */
export default function ChatMediaBubble({
  part,
  mine,
  onOpen,
  viewOnce,
  viewed,
  timeLabel,
  read,
}: ChatMediaBubbleProps) {
  // Recipient-side view-once media is gated behind a tap: only its blurred
  // image preview actually loads (the video variant shows a plain gradient).
  const viewOnceGated =
    Boolean(viewOnce) && !mine && (part.kind === "image" || part.kind === "video");
  const hasLoadableTag = viewOnceGated
    ? !viewed && part.kind === "image"
    : part.kind === "image" || part.kind === "video";

  const { loaded, broken, attempt, mediaRef, onLoad, onError } = useMediaLoad(hasLoadableTag);
  const align = mine ? "self-end" : "self-start";
  // Tinode file GETs 403 without auth in the query string — resolve the ref.
  // Recomputed on every retry (`attempt`) so a session token that only became
  // available after the first paint makes it into the URL.
  const src = authedFileUrl(part.url);

  if (broken) {
    return <BrokenNote mine={mine} />;
  }

  // View-once media (anon / friend chat): once opened it is permanently spent;
  // before that the recipient sees a blurred, tap-to-open placeholder. The
  // sender's own bubble skips the gate and shows the media normally.
  if (viewOnceGated) {
    const noun = part.kind === "image" ? "Фото" : "Видео";
    if (viewed) {
      return (
        <div
          data-testid="viewonce-tile"
          data-viewonce-state="seen"
          className={`${BUBBLE_SHRINK} flex w-[70vw] max-w-[270px] items-center gap-2 rounded-2xl bg-bubble-in px-3.5 py-3 text-xs text-bubble-in-foreground/60 ${align}`}
        >
          <EyeOffIcon className="size-4 shrink-0 opacity-70" />
          <span>{noun} просмотрено</span>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => onOpen?.()}
        aria-label={`Открыть ${noun.toLowerCase()} (один раз)`}
        data-testid="viewonce-tile"
        data-viewonce-state="unseen"
        className={`${BUBBLE_SHRINK} relative block aspect-[4/5] w-[70vw] max-w-[270px] cursor-pointer overflow-hidden rounded-2xl transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 ${align}`}
      >
        {part.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- server-relative ref, no next/image loader needed
          <img
            key={attempt}
            ref={mediaRef}
            src={src}
            alt=""
            aria-hidden
            onLoad={onLoad}
            onError={onError}
            decoding="async"
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
          />
        ) : (
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-br from-neutral-700 to-neutral-900"
          />
        )}
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 px-4 text-center text-white backdrop-blur-[2px]">
          <span className="grid size-12 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
            <EyeIcon className="size-6" />
          </span>
          <span className="text-sm font-semibold">{noun} на один просмотр</span>
          <span className="text-[11px] text-white/70">Нажми, чтобы посмотреть</span>
        </span>
      </button>
    );
  }

  if (part.kind === "image") {
    return (
      <button
        type="button"
        onClick={() => onOpen?.()}
        aria-label="Открыть изображение"
        data-testid="chat-image"
        data-media-state={loaded ? "loaded" : "loading"}
        style={reserveStyle(part, loaded)}
        className={`${BUBBLE_SHRINK} relative block w-[70vw] max-w-[270px] cursor-pointer overflow-hidden rounded-2xl transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 ${align}`}
      >
        {!loaded && <MediaSkeleton />}
        {/* eslint-disable-next-line @next/next/no-img-element -- server-relative ref, no next/image loader needed */}
        <img
          key={attempt}
          ref={mediaRef}
          src={src}
          alt={part.name || "Изображение"}
          width={part.width}
          height={part.height}
          onLoad={onLoad}
          onError={onError}
          // NOT `loading="lazy"`: an unloaded chat photo has no intrinsic size,
          // so the bubble is 0px tall — inside the scrolling thread that keeps
          // it clipped out of view, lazy-loading never triggers, and it stays
          // 0px tall forever. Deferring the one thing that gives the bubble its
          // height is a deadlock, so chat photos always load eagerly.
          decoding="async"
          className={cn(
            "block max-h-[320px] w-full object-cover",
            loaded ? "" : "absolute inset-0 h-full opacity-0",
          )}
        />
        <MediaMetaChip mine={mine} timeLabel={timeLabel} read={read} />
      </button>
    );
  }

  if (part.kind === "video") {
    // A tappable poster (first frame) with a play badge — tap opens the
    // fullscreen viewer (real dark overlay + native controls) rather than
    // scrubbing a tiny inline player (BUG-11).
    return (
      <button
        type="button"
        onClick={() => onOpen?.()}
        aria-label="Открыть видео"
        data-testid="chat-video"
        data-media-state={loaded ? "loaded" : "loading"}
        style={reserveStyle(part, loaded)}
        className={`${BUBBLE_SHRINK} relative block w-[70vw] max-w-[270px] cursor-pointer overflow-hidden rounded-2xl transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 ${align}`}
      >
        {!loaded && <MediaSkeleton />}
        <video
          key={attempt}
          ref={mediaRef}
          preload="metadata"
          muted
          playsInline
          src={src}
          onLoadedMetadata={onLoad}
          onError={onError}
          className={cn(
            "block max-h-[320px] w-full bg-black object-cover",
            loaded ? "" : "absolute inset-0 h-full opacity-0",
          )}
        />
        <span className="absolute inset-0 grid place-items-center bg-black/15">
          <span className="grid size-14 place-items-center rounded-full bg-black/50 text-white ring-1 ring-white/40 backdrop-blur-sm">
            <PlayIcon className="size-6 translate-x-0.5" />
          </span>
        </span>
        <MediaMetaChip
          mine={mine}
          timeLabel={timeLabel}
          read={read}
          durationLabel={formatDuration(part.duration)}
        />
      </button>
    );
  }

  if (part.kind === "audio") {
    // Styled voice-note UI (waveform / play-pause / progress) over a real
    // <audio> element — no more raw native controls (BUG-13).
    return (
      <VoiceMessage
        key={attempt}
        className={`${BUBBLE_SHRINK} ${align}`}
        src={src}
        durationSec={part.duration}
        own={mine}
        rootTestId="chat-voice"
        onError={onError}
      />
    );
  }

  // file
  return (
    <a
      href={src}
      download={part.name}
      className={`${BUBBLE_SHRINK} flex max-w-[260px] cursor-pointer items-center gap-2.5 rounded-2xl px-3 py-2.5 transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 ${align} ${
        mine
          ? "bg-bubble-out text-bubble-out-foreground"
          : "bg-bubble-in text-bubble-in-foreground"
      }`}
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-full ${
          mine ? "bg-black/10" : "bg-primary/15 text-primary"
        }`}
      >
        <DocumentIcon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{part.name}</span>
        <span className="block text-[11px] opacity-60">{formatSize(part.size)}</span>
      </span>
    </a>
  );
}
