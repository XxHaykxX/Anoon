"use client";

/**
 * Static fixtures for the design showcase (`app/page.tsx`).
 *
 * The catalogue renders every entry as a bare `<Screen />` with no props, but
 * several real screens are overlays or sub-components that only mean anything
 * with data behind them. Each wrapper below feeds one of those a plausible
 * fixture so it can be design-reviewed in isolation.
 *
 * Nothing here is app code — it exists purely so the catalogue can show what
 * users actually see. Components are imported and rendered AS-IS; if a screen
 * needs changing, it gets changed in `components/`, not worked around here.
 */

import type { ReactNode } from "react";
import { useMediaViewerStore } from "@/store/mediaViewerStore";
import { type MediaPart } from "@/lib/tinode";
import AnoonFriends from "@/components/anoon/AnoonFriends";
import AnoonWallet from "@/components/anoon/AnoonWallet";
import IncomingCall from "@/components/anoon/IncomingCall";
import AnoonMediaViewer from "@/components/anoon/AnoonMediaViewer";
import AnoonMediaViewerDemo from "@/components/anoon/AnoonMediaViewerDemo";
import ChatMediaBubble from "@/components/anoon/ChatMediaBubble";
import MessageActions from "@/components/anoon/MessageActions";
import ReactionBar from "@/components/anoon/ReactionBar";
import ReplyPreview from "@/components/anoon/ReplyPreview";
import VoiceRecorder from "@/components/anoon/VoiceRecorder";

/** Catalogue callbacks go nowhere — the showcase has no app state to drive. */
const noop = () => {};

/**
 * Gradient SVG as a data URI, so media fixtures are real, self-contained image
 * sources with no network dependency. Same trick AnoonMediaViewerDemo uses.
 * `authedFileUrl` passes non-`/` refs through untouched, so these survive it.
 */
function gradientSrc(from: string, to: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='720' height='960'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${from}'/><stop offset='1' stop-color='${to}'/>` +
    `</linearGradient></defs><rect width='720' height='960' fill='url(#g)'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Overlays are `absolute inset-0`; give them the positioned box they expect. */
function OverlayHost({ children }: { children: ReactNode }) {
  return <div className="relative h-full w-full overflow-hidden">{children}</div>;
}

/* ────────────────────────── Screens ────────────────────────── */

/**
 * «Чаты» — the post-login landing screen. Same component as «Контакты», in its
 * other mode (see AnoonApp's ChatsScreen wrapper), so both modes get reviewed.
 */
export function AnoonChatsShowcase() {
  return <AnoonFriends mode="chats" />;
}

/** Coins + subscription overlay, reached from AnoonProfile. */
export function AnoonWalletShowcase() {
  return (
    <OverlayHost>
      <AnoonWallet onClose={noop} />
    </OverlayHost>
  );
}

/** Ringing screen shown to the callee before accept/decline. */
export function IncomingCallShowcase() {
  return (
    <OverlayHost>
      <IncomingCall
        peerName="Собеседник"
        peerId="#04217"
        media="video"
        onAccept={noop}
        onDecline={noop}
      />
    </OverlayHost>
  );
}

/**
 * Fullscreen lightbox. The viewer reads the global store and AnoonApp mounts it
 * only while `open`, so the catalogue reproduces that: tap a thumbnail in the
 * demo screen to open it, swipe down / tap ✕ to close.
 */
export function AnoonMediaViewerShowcase() {
  const open = useMediaViewerStore((s) => s.open);
  return (
    <OverlayHost>
      <AnoonMediaViewerDemo />
      {open && <AnoonMediaViewer />}
    </OverlayHost>
  );
}

/* ─────────────────────── Chat sub-components ─────────────────────── */

const PHOTO_PART: MediaPart = {
  kind: "image",
  url: gradientSrc("#8E9BC0", "#5F6F9E"),
  mime: "image/svg+xml",
  name: "photo.svg",
  size: 148_000,
  width: 720,
  height: 960,
};

const VIDEO_PART: MediaPart = {
  kind: "video",
  url: gradientSrc("#93BEA0", "#64977B"),
  mime: "video/mp4",
  name: "clip.mp4",
  size: 2_400_000,
  width: 720,
  height: 960,
  duration: 42,
};

/** One labelled specimen in the parts catalogue. */
function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-4 last:border-b-0">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </section>
  );
}

/**
 * The five chat sub-components on one screen rather than five near-empty tabs —
 * they are parts of a bubble row, not screens, and they read best side by side.
 */
export function ChatPartsShowcase() {
  return (
    <div className="anoon-noscroll h-full w-full overflow-y-auto bg-background text-foreground">
      <Part label="ReplyPreview — ответ">
        <ReplyPreview text="Договорились, до встречи" onCancel={noop} />
      </Part>

      <Part label="ReplyPreview — редактирование">
        <ReplyPreview text="Привет 👋 Отличное, только с работы" onCancel={noop} mode="edit" />
      </Part>

      <Part label="ReactionBar">
        <div className="flex justify-start">
          <ReactionBar onPick={noop} />
        </div>
      </Part>

      <Part label="MessageActions — чужое сообщение">
        <div className="relative h-[232px]">
          <MessageActions
            own={false}
            canEdit={false}
            canDeleteAll={false}
            onReact={noop}
            onReply={noop}
            onCopy={noop}
            onEdit={noop}
            onDeleteMine={noop}
            onDeleteAll={noop}
            onClose={noop}
            className="left-0 top-0"
          />
        </div>
      </Part>

      <Part label="MessageActions — своё сообщение">
        <div className="relative h-[280px]">
          <MessageActions
            own
            canEdit
            canDeleteAll
            onReact={noop}
            onReply={noop}
            onCopy={noop}
            onEdit={noop}
            onDeleteMine={noop}
            onDeleteAll={noop}
            onClose={noop}
            className="right-0 top-0"
          />
        </div>
      </Part>

      <Part label="ChatMediaBubble — фото, входящее">
        <div className="flex justify-start">
          <ChatMediaBubble part={PHOTO_PART} mine={false} timeLabel="18:04" />
        </div>
      </Part>

      <Part label="ChatMediaBubble — видео, исходящее">
        <div className="flex justify-end">
          <ChatMediaBubble part={VIDEO_PART} mine timeLabel="18:05" read />
        </div>
      </Part>

      <Part label="ChatMediaBubble — фото «просмотр один раз»">
        <div className="flex justify-start">
          <ChatMediaBubble part={PHOTO_PART} mine={false} viewOnce timeLabel="18:06" />
        </div>
      </Part>

      <Part label="VoiceRecorder — покой (запись начнётся по нажатию)">
        <VoiceRecorder onRecorded={noop} />
      </Part>
    </div>
  );
}
