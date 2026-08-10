"use client";

import { Fragment, memo, useCallback, useEffect, useRef, useState } from "react";
import { AnoonAvatar, PRESS_FX } from "@/components/anoon/_shared";
import TypingDots from "@/components/TypingDots";
import MediaBubble from "@/components/MediaBubble";
import EmojiPicker from "@/components/EmojiPicker";
import AttachMenu from "@/components/AttachMenu";
import ChatMediaBubble from "@/components/anoon/ChatMediaBubble";
import MessageActions from "@/components/anoon/MessageActions";
import ReplyPreview from "@/components/anoon/ReplyPreview";
import VoiceRecorder from "@/components/anoon/VoiceRecorder";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import { USE_TINODE, uploadFile, authedFileUrl, type MediaKind, type MediaPart } from "@/lib/tinode";
import { useAnoonStore } from "@/store";
import { useMediaViewerStore, type MediaViewerItem } from "@/store/mediaViewerStore";
import { useCallStore } from "@/store/callStore";
import {
  ChevronLeftIcon,
  EmojiIcon,
  PlusIcon,
  PhoneIcon,
  VideoIcon,
  SendIcon,
  CheckIcon,
  DoubleCheckIcon,
} from "@/components/icons";

/** Placeholder text used for the mock-only (no live topic) attach fallback. */
const ATTACH_PLACEHOLDER: Record<string, string> = {
  photo: "📷 Фото",
  video: "🎥 Видео",
};


/**
 * Desktop column for the thread and the composer row. The work area is up to
 * 60rem wide on ≥1024px; a thread that uses all of it turns every line into a
 * ruler-wide sentence and parks the composer's send button an arm away from its
 * input. Header and the hairline borders still span the full width — only the
 * content inside them is centred.
 *
 * `lg:[.anoon-desktop_&]:` needs both halves: `lg:` alone would also fire in the
 * showcase, which renders this screen inside fixed 390px frames on a wide
 * monitor; `.anoon-desktop` alone is on the app root at every width and would
 * restyle the phone. See docs/DESKTOP-LAYOUT.md.
 */
const DESKTOP_COL =
  "lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:w-full lg:[.anoon-desktop_&]:max-w-[48rem]";
/** The same column as padding — for rows (header, composer) whose hairline must stay full-width. */
const DESKTOP_COL_PX = "lg:[.anoon-desktop_&]:px-[max(1rem,calc((100%-48rem)/2))]";
/** Right edge of that column, for the absolutely-positioned overlays hung off the screen root. */
const DESKTOP_COL_RIGHT = "lg:[.anoon-desktop_&]:right-[max(0.75rem,calc((100%-48rem)/2))]";
/** Left edge of the same column (emoji picker). */
const DESKTOP_COL_LEFT = "lg:[.anoon-desktop_&]:left-[max(0.5rem,calc((100%-48rem)/2))]";

/** Distance from the bottom (px) within which the thread still counts as following the newest message. */
const FOLLOW_SLACK_PX = 160;
/** Distance from the bottom (px) at which the «к последнему сообщению» button appears. */
const JUMP_SLACK_PX = 240;
/** How long a smooth scroll we started may run before its own scroll events count as the user's. */
const SMOOTH_SCROLL_MS = 450;

/** Three-dot vertical menu icon (icons.tsx has no dedicated one). */
const MoreIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <circle cx="12" cy="5" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="12" cy="19" r="1.7" />
  </svg>
);

const ReportIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M5 21V4h11l-1.5 3.5L16 11H5" />
  </svg>
);

/** Chevron-down — used by the scroll-to-latest button (icons.tsx has none). */
const ChevronDownIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

type DeliveryStatus = "sending" | "sent" | "delivered" | "read";
type Reaction = { emoji: string; mine: boolean };

/** Local mock-thread message (real threads come from the store). */
type MockMsg = {
  id: number;
  text: string;
  own: boolean;
  time: string;
  read?: boolean;
  quote?: string;
  media?: MediaPart[];
};

/** Unified per-row view model rendered by {@link PrivateBubble}. */
type Row = {
  key: string;
  id: number;
  /** Real Tinode seq for store actions; undefined for mock / not-yet-acked. */
  seq?: number;
  own: boolean;
  text: string;
  time: string;
  /** Raw send timestamp (ms) — drives day-divider grouping (BUG-26). Undefined in mock. */
  ts?: number;
  status?: DeliveryStatus;
  reactions?: Reaction[];
  replyTo?: { seq?: number; text: string };
  edited?: boolean;
  deleted?: boolean;
  media?: MediaPart[];
  viewOnce?: boolean;
  /** RealtimeFix injects `{system:true,text:"…"}` rows (e.g. peer-left) — rendered as a centered muted line (BUG-15). */
  system?: boolean;
};

const INITIAL_MESSAGES: MockMsg[] = [
  { id: 1, text: "Привет! Рада, что профили открылись 🙂", own: false, time: "12:31" },
  { id: 2, text: "Взаимно! Теперь можно нормально поговорить", own: true, time: "12:32", read: true },
  { id: 3, text: "Как прошёл твой день?", own: false, time: "12:33" },
  { id: 4, text: "Отлично, спасибо. А у тебя?", own: true, time: "12:34", read: true },
];

function formatNow(): string {
  const d = new Date();
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function formatTs(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

/** Human day-divider label: «Сегодня» / «Вчера» / «5 июля» (BUG-26). */
function dayLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/** Delivery-status ticks for own messages (Wave-2 #82). */
function StatusTicks({ status }: { status?: DeliveryStatus }) {
  if (!status) return null;
  if (status === "sending" || status === "sent") {
    return <CheckIcon className="size-3.5 text-bubble-out-foreground/60" />;
  }
  if (status === "delivered") {
    return <DoubleCheckIcon className="size-4 text-bubble-out-foreground/60" />;
  }
  return <DoubleCheckIcon className="size-4 text-read-tick" />;
}

/**
 * A single private-chat message bubble. Memoized on its (primitive) props so
 * appending a message or opening one bubble's action sheet does not re-render
 * the whole thread. Callbacks passed in must be referentially stable (see the
 * useCallback wrappers below) and receive the bubble `id` so the parent can
 * resolve the live row (seq/text) from its ref.
 */
const PrivateBubble = memo(function PrivateBubble({
  id,
  seq,
  own,
  text,
  time,
  status,
  reactionsKey,
  reactions,
  quote,
  quoteSeq,
  edited,
  deleted,
  canEdit,
  actionsOpen,
  onSetReaction,
  onOpenActions,
  onReact,
  onReply,
  onEdit,
  onDeleteMine,
  onDeleteAll,
  onCloseActions,
  onStartLongPress,
  onCancelLongPress,
  onQuoteJump,
}: {
  id: number;
  seq?: number;
  own: boolean;
  text: string;
  time: string;
  status?: DeliveryStatus;
  /** Serialized reactions — a primitive so memo can compare cheaply. */
  reactionsKey: string;
  reactions?: Reaction[];
  quote?: string;
  quoteSeq?: number;
  edited?: boolean;
  deleted?: boolean;
  canEdit: boolean;
  actionsOpen: boolean;
  onSetReaction: (id: number, emoji: string) => void;
  onOpenActions: (id: number) => void;
  onReact: (id: number, emoji: string) => void;
  onReply: (id: number) => void;
  onEdit: (id: number) => void;
  onDeleteMine: (id: number) => void;
  onDeleteAll: (id: number) => void;
  onCloseActions: () => void;
  onStartLongPress: (id: number) => void;
  onCancelLongPress: () => void;
  onQuoteJump: (seq: number) => void;
}) {
  void reactionsKey; // used only to key memo comparisons

  if (deleted) {
    return (
      <div
        className={`flex max-w-[78%] lg:[.anoon-desktop_&]:max-w-[32rem] ${
          own ? "self-end" : "self-start"
        }`}
      >
        <span className="rounded-2xl bg-muted px-3.5 py-2 text-sm italic text-muted-foreground">
          сообщение удалено
        </span>
      </div>
    );
  }

  return (
    <div
      className={`relative flex max-w-[78%] flex-col lg:[.anoon-desktop_&]:max-w-[32rem] ${
        own ? "items-end self-end" : "items-start self-start"
      }`}
    >
      <div
        data-seq={seq}
        className={`anoon-msg-in relative select-none rounded-2xl px-3.5 py-2 ${
          own
            ? "bg-bubble-out text-bubble-out-foreground"
            : "bg-bubble-in text-bubble-in-foreground"
        }`}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={() => onSetReaction(id, "❤️")}
        onPointerDown={() => onStartLongPress(id)}
        onPointerUp={onCancelLongPress}
        onPointerLeave={onCancelLongPress}
      >
        {quote && (
          <button
            type="button"
            disabled={quoteSeq == null}
            onClick={(e) => {
              e.stopPropagation();
              if (quoteSeq != null) onQuoteJump(quoteSeq);
            }}
            className={`mb-1 block max-w-full line-clamp-2 break-words rounded-md border-l-2 px-2 py-1 text-left text-xs ${
              quoteSeq != null ? "cursor-pointer" : "cursor-default"
            } ${
              own
                ? "border-black/40 bg-black/10 text-bubble-out-foreground/80"
                : "border-primary/50 bg-primary/10 text-bubble-in-foreground/80"
            }`}
          >
            {quote}
          </button>
        )}
        <div className="flex items-end gap-1.5">
          <span className="text-sm">{text}</span>
          <span
            className={`flex shrink-0 items-center gap-0.5 text-[11px] ${
              own ? "text-bubble-out-foreground/60" : "text-muted-foreground"
            }`}
          >
            {edited && <span className="italic opacity-70">изменено</span>}
            {time}
            {own && <StatusTicks status={status} />}
          </span>
        </div>

        {/* Long-press action sheet: reactions + reply/edit/delete */}
        {actionsOpen && (
          <MessageActions
            className={`absolute bottom-full mb-1.5 ${own ? "right-0" : "left-0"}`}
            own={own}
            canEdit={canEdit}
            canDeleteAll={own}
            onReact={(emoji) => onReact(id, emoji)}
            onReply={() => onReply(id)}
            onCopy={text ? () => void navigator.clipboard?.writeText(text) : undefined}
            onEdit={() => onEdit(id)}
            onDeleteMine={() => onDeleteMine(id)}
            onDeleteAll={() => onDeleteAll(id)}
            onClose={onCloseActions}
          />
        )}
      </div>

      {/* Applied reactions */}
      {reactions && reactions.length > 0 && (
        <div className={`-mt-1.5 flex gap-1 ${own ? "flex-row-reverse" : ""}`}>
          {reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenActions(id);
              }}
              className={`flex items-center rounded-full border px-1.5 py-0.5 text-xs shadow-sm ${PRESS_FX} ${
                r.mine ? "border-primary bg-primary/15" : "border-border bg-card"
              }`}
            >
              {r.emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * `onBack` decouples the screen from the router (#34). As a route it pops the
 * stack; as the right pane of the desktop two-pane «Чаты» it clears the
 * parent's selection instead — there is nothing to pop, the list never left.
 * The live topic follows the mount either way: the effect below opens
 * chatTarget and closes it on unmount AND on a peer switch, so the pane can
 * swap conversations (or go empty) without leaking a subscription.
 */
export default function AnoonPrivateChat({ onBack }: { onBack?: () => void } = {}) {
  const nav = useAnoonNav();
  const real = USE_TINODE;

  // Real chat state (Tinode p2p topic) — populated by AnoonFriends → openChat.
  const activeChat = useAnoonStore((s) => s.activeChat);
  const storeMsgs = useAnoonStore((s) => s.chatMessages);
  const peerTyping = useAnoonStore((s) => s.chatPeerTyping);
  // Peer activity ("typing" | "media" | null) for the active friend chat.
  // Falls back to the boolean chatPeerTyping below. (BUG-18)
  const storePeerActivity = useAnoonStore((s) => s.peerActivity);
  const chatPeerOnline = useAnoonStore((s) => s.chatPeerOnline);
  const chatPeerLastSeen = useAnoonStore((s) => s.chatPeerLastSeen);
  const chatViewed = useAnoonStore((s) => s.chatViewed);
  const sendChatMessage = useAnoonStore((s) => s.sendChatMessage);
  const sendFriendMedia = useAnoonStore((s) => s.sendFriendMedia);
  const sendChatReaction = useAnoonStore((s) => s.sendChatReaction);
  const editChatMessage = useAnoonStore((s) => s.editChatMessage);
  const deleteChatMessage = useAnoonStore((s) => s.deleteChatMessage);
  const markChatViewed = useAnoonStore((s) => s.markChatViewed);
  const notifyTyping = useAnoonStore((s) => s.notifyTyping);
  const openChat = useAnoonStore((s) => s.openChat);
  const closeChat = useAnoonStore((s) => s.closeChat);
  const chatTargetId = useAnoonStore((s) => s.chatTarget?.id);
  const openViewer = useMediaViewerStore((s) => s.openViewer);

  const [messages, setMessages] = useState<MockMsg[]>(INITIAL_MESSAGES);
  const [draft, setDraft] = useState("");
  const [reactions, setReactions] = useState<Record<number, string>>({});
  const [actionFor, setActionFor] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<{ seq?: number; text: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{ seq: number; text: string } | null>(null);
  const [viewOnceArmed, setViewOnceArmed] = useState(false);
  const [showJump, setShowJump] = useState(false);
  // True while the voice recorder is capturing — the composer hides its other
  // controls and gives the record bar the whole row (BUG-37).
  const [voiceRecording, setVoiceRecording] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const lastKpAt = useRef(0);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  // Live snapshot of the rendered rows so id-based callbacks can resolve seq/text.
  const rowsRef = useRef<Row[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);
  /** While true the thread stays glued to the newest message; cleared once the user scrolls up. */
  const followBottom = useRef(true);
  /** Timestamp until which a smooth scroll we started is still animating. */
  const smoothUntil = useRef(0);
  const repinTimer = useRef<number | null>(null);

  const flash = (text: string) => {
    setBanner(text);
    setTimeout(() => setBanner(null), 2200);
  };

  // Open the target topic on mount, leave it on unmount. Opening here (rather
  // than in the friends list before navigation) keeps the open/close symmetric
  // so a React StrictMode double-mount — mount → cleanup(closeChat) → mount —
  // re-opens on the second mount instead of leaving activeChat null. The target
  // (chatTarget) survives closeChat precisely so this can re-read it.
  useEffect(() => {
    if (!real) return;
    const target = useAnoonStore.getState().chatTarget;
    if (target) void openChat(target);
    return () => closeChat();
  }, [real, chatTargetId, openChat, closeChat]);

  // Peer info + thread come from the store in real mode, mock otherwise.
  const peerName = real ? activeChat?.displayName ?? "Чат" : "Лиса";
  const peerInitials = real
    ? (activeChat?.displayName.trim()[0] ?? "?").toUpperCase()
    : "Л";
  const peerTone = real ? activeChat?.avatarTone ?? 0 : 2;
  const peerOnline = real ? chatPeerOnline : true;
  // Unified peer-activity signal: prefer the store's "typing"/"media" field,
  // fall back to the boolean chatPeerTyping (BUG-18).
  const peerActivity: "typing" | "media" | null = real
    ? (storePeerActivity ?? (peerTyping ? "typing" : null))
    : null;
  const subtitle = real
    ? peerActivity === "media"
      ? "отправляет медиа…"
      : peerActivity === "typing"
        ? "печатает…"
        : chatPeerOnline
          ? "в сети"
          : chatPeerLastSeen ?? "не в сети"
    : "в сети";

  const view: Row[] = real
    ? storeMsgs.map((m, i) => {
        const seq = Number.isFinite(Number(m.id)) ? Number(m.id) : undefined;
        return {
          key: m.id,
          id: i + 1,
          seq,
          own: m.mine,
          text: m.text,
          time: formatTs(m.ts),
          ts: m.ts,
          status: m.mine ? m.status : undefined,
          reactions: m.reactions,
          replyTo: m.replyTo ? { seq: m.replyTo.seq, text: m.replyTo.text } : undefined,
          edited: m.edited,
          deleted: m.deleted,
          media: m.media,
          viewOnce: m.viewOnce,
          // RealtimeFix may inject a `{system:true}` peer-left row into the message list.
          system: (m as { system?: boolean }).system || undefined,
        };
      })
    : messages.map((m) => ({
        key: String(m.id),
        id: m.id,
        own: m.own,
        text: m.text,
        time: m.time,
        status: m.own ? (m.read ? "read" : "sent") : undefined,
        reactions: reactions[m.id] ? [{ emoji: reactions[m.id], mine: true }] : undefined,
        replyTo: m.quote ? { text: m.quote } : undefined,
        media: m.media,
      }));
  // Keep the id→row lookup fresh for the (post-render) action callbacks without
  // writing the ref during render (React forbids it).
  useEffect(() => {
    rowsRef.current = view;
  });

  const rowById = (id: number) => rowsRef.current.find((r) => r.id === id);

  const pinToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = threadRef.current;
    if (!el) return;
    if (behavior === "smooth") smoothUntil.current = Date.now() + SMOOTH_SCROLL_MS;
    // No setShowJump here: this runs from effects/observers, and the resulting
    // scroll event drives `showJump` through onThreadScroll anyway.
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  /**
   * Re-glue the thread to the newest message after its content grew. Deferred
   * while a smooth follow is still animating (snapping mid-flight would cut it
   * short) and re-armed for when that animation ends, so growth that lands
   * inside the animation window never leaves the thread parked above the bottom.
   */
  const repin = useCallback(() => {
    if (!followBottom.current) return;
    // Never move the thread out from under a finger that is mid-long-press —
    // the bubble would slide away and `onPointerLeave` would cancel the hold.
    if (longPressTimer.current != null) return;
    const wait = smoothUntil.current - Date.now();
    if (wait > 0) {
      if (repinTimer.current != null) window.clearTimeout(repinTimer.current);
      repinTimer.current = window.setTimeout(() => {
        repinTimer.current = null;
        if (followBottom.current) pinToBottom("auto");
      }, wait + 30);
      return;
    }
    pinToBottom("auto");
  }, [pinToBottom]);

  // Keep the thread glued to the newest message.
  //
  // The thread's content keeps growing well *after* its first paint: history
  // arrives in batches, and every photo/video bubble swaps its reserved
  // aspect-ratio box (see reserveStyle in ChatMediaBubble) for the media's real
  // height the moment it loads. A one-shot "scrollTop = scrollHeight on mount"
  // therefore lands short, and because the follow-up below only re-pins when
  // already near the bottom, the thread never recovers.
  //
  // Measured on a media-heavy friend thread (8 photos): the chat opened at
  // scrollTop 2245 of a 3318px thread with a 668px viewport — 405px above the
  // newest message — and stayed there for as long as it was watched, so an
  // arriving message rendered at y≈1190 inside an 844px-tall viewport: visible
  // to the DOM, off-screen and un-tappable for the user.
  //
  // Re-pin on every size change (resize, DOM growth, media finishing its load)
  // until the user scrolls away themselves.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    // Coalesce bursts — eight photos finishing at once would otherwise force
    // eight synchronous layouts — into a single repin per frame.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        repin();
      });
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true });
    // `load`/`loadedmetadata` don't bubble — catch them in the capture phase so
    // a photo or video resolving its real height re-pins the thread.
    el.addEventListener("load", schedule, true);
    el.addEventListener("loadedmetadata", schedule, true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("load", schedule, true);
      el.removeEventListener("loadedmetadata", schedule, true);
      if (repinTimer.current != null) window.clearTimeout(repinTimer.current);
    };
  }, [repin]);

  // Follow every new message while the thread is still glued to the bottom
  // (`followBottom` starts true, so this also covers the first non-empty paint).
  //
  // Deliberately instant, not smooth: a follow is at most one bubble's worth of
  // scroll, where an eased 200ms glide is imperceptible but does leave the newest
  // bubble drifting under the user's finger for the length of the animation —
  // long enough for a tap or long-press aimed at it to land on the gap below.
  // Smooth is kept for the «к последнему сообщению» button, where the travel is
  // large enough for the motion to mean something.
  useEffect(() => {
    if (view.length === 0) return;
    if (followBottom.current) pinToBottom("auto");
  }, [view.length, pinToBottom]);

  const scrollToBottom = () => {
    followBottom.current = true;
    // Hide the button on the tap rather than waiting for the smooth scroll to
    // carry the thread back inside JUMP_SLACK_PX.
    setShowJump(false);
    pinToBottom("smooth");
  };

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJump(dist > JUMP_SLACK_PX);
    // Scroll events emitted by our own smooth follow are not the user choosing
    // to leave the bottom — only a real scroll may detach the thread.
    if (Date.now() < smoothUntil.current) return;
    followBottom.current = dist < FOLLOW_SLACK_PX;
  };
  // Tapping a reply-quote scrolls to (and briefly flashes) the quoted message.
  const jumpToSeq = useCallback((seq: number) => {
    const el = threadRef.current?.querySelector<HTMLElement>(`[data-seq="${seq}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("anoon-quote-flash");
    window.setTimeout(() => el.classList.remove("anoon-quote-flash"), 1200);
  }, []);

  // Precompute which rows open a new calendar day → render a day divider above
  // them (BUG-26). Keyed by row.key; only rows carrying a real ts participate.
  const dayDividerFor: Record<string, string> = {};
  {
    let lastDay = "";
    for (const r of view) {
      if (r.ts == null) continue;
      const d = new Date(r.ts);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (key !== lastDay) {
        dayDividerFor[r.key] = dayLabel(r.ts);
        lastDay = key;
      }
    }
  }

  const send = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setEmojiOpen(false);
    // Editing an existing message.
    if (editTarget) {
      if (real) void editChatMessage(editTarget.seq, trimmed);
      else
        setMessages((prev) =>
          prev.map((m) => (m.id === editTarget.seq ? { ...m, text: trimmed } : m)),
        );
      setEditTarget(null);
      setDraft("");
      return;
    }
    if (real) {
      const reply =
        replyTarget?.seq != null ? { seq: replyTarget.seq, text: replyTarget.text } : undefined;
      void sendChatMessage(trimmed, reply);
      setReplyTarget(null);
      setDraft("");
      return;
    }
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), text: trimmed, own: true, time: formatNow(), read: false, quote: replyTarget?.text },
    ]);
    setReplyTarget(null);
    setDraft("");
  };

  // Upload a picked file and drop it into the thread as a media message.
  const handleFilePicked = async (kind: MediaKind, file: File | undefined) => {
    if (!file) return;
    const useViewOnce = kind === "image" && viewOnceArmed;
    setViewOnceArmed(false);
    try {
      // Tell the peer we're uploading → they see «отправляет медиа…» (BUG-18).
      useAnoonStore.getState().notifyMediaSending();
      const up = await uploadFile(file, file.name, file.type);
      await sendFriendMedia(up, kind, undefined, useViewOnce ? { viewOnce: true } : undefined);
    } catch {
      flash("Не удалось отправить");
    }
  };

  // Build the fullscreen viewer's item list from a row's media part, resolving
  // the SAME authed URL ChatMediaBubble renders so the opened image === the
  // thumbnail (BUG-10). Pass the whole conversation's images+videos so swipe
  // navigation works, positioned on the tapped part.
  const openConversationMedia = (rowKey: string, partIdx: number) => {
    const items: MediaViewerItem[] = [];
    let target = 0;
    for (const r of rowsRef.current) {
      if (!r.media) continue;
      // View-once media never joins the swipeable gallery — it would let the
      // recipient reveal a one-shot photo by swiping, bypassing the tap gate.
      // It's only openable via its own openViewOnce path.
      if (r.viewOnce) continue;
      r.media.forEach((part, i) => {
        if (part.kind !== "image" && part.kind !== "video") return;
        if (r.key === rowKey && i === partIdx) target = items.length;
        items.push({
          src: authedFileUrl(part.url),
          type: part.kind === "video" ? "video" : "image",
          caption: part.name || undefined,
        });
      });
    }
    if (items.length === 0) return;
    openViewer(items, target);
  };

  // Open a view-once photo: reveal it fullscreen once, then mark it spent. Shows
  // only that single item (viewOnce), not the whole conversation.
  const openViewOnce = (rowKey: string, partIdx: number, seq: number | undefined) => {
    if (seq != null) markChatViewed(seq);
    const part = rowsRef.current.find((r) => r.key === rowKey)?.media?.[partIdx];
    if (!part) return;
    openViewer(
      [
        {
          src: authedFileUrl(part.url),
          type: part.kind === "video" ? "video" : "image",
          viewOnce: true,
          caption: part.name || undefined,
        },
      ],
      0,
    );
  };

  // Attach: real mode opens the native photo/video picker and uploads for
  // real; mock mode (no live topic) keeps a labelled placeholder bubble.
  const sendAttachment = (id: string) => {
    setAttachOpen(false);
    if (real) {
      if (id === "photo") photoInputRef.current?.click();
      else if (id === "video") videoInputRef.current?.click();
      return;
    }
    const text = ATTACH_PLACEHOLDER[id] ?? "📎 Вложение";
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), text, own: true, time: formatNow(), read: false },
    ]);
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    // Throttle typing notifications to ~1 every 3s.
    if (real && Date.now() - lastKpAt.current > 3000) {
      lastKpAt.current = Date.now();
      notifyTyping();
    }
  };

  const startCall = (media: "audio" | "video") => {
    if (!real || !activeChat) return;
    useCallStore.getState().startCall(activeChat.hashId, peerName, media);
  };

  // Stable callbacks passed down to the memoized PrivateBubble — referential
  // stability lets React.memo skip untouched bubbles. Each resolves the live
  // row by id via rowsRef (so it always sees the current seq/text).
  const setReactionQuick = useCallback(
    (id: number, emoji: string) => {
      const row = rowById(id);
      if (real) {
        if (row?.seq) void useAnoonStore.getState().sendChatReaction(row.seq, emoji);
      } else {
        setReactions((prev) => {
          const next = { ...prev };
          if (next[id] === emoji) delete next[id];
          else next[id] = emoji;
          return next;
        });
      }
    },
    [real],
  );

  const react = useCallback(
    (id: number, emoji: string) => {
      const row = rowById(id);
      if (real) {
        if (row?.seq) void sendChatReaction(row.seq, emoji);
      } else {
        setReactions((prev) => ({ ...prev, [id]: emoji }));
      }
    },
    [real, sendChatReaction],
  );

  const openActions = useCallback((id: number) => setActionFor(id), []);
  const closeActions = useCallback(() => setActionFor(null), []);

  const reply = useCallback((id: number) => {
    const row = rowById(id);
    if (!row) return;
    setReplyTarget({ seq: row.seq, text: row.text || "вложение" });
    setEditTarget(null);
    setActionFor(null);
  }, []);

  const edit = useCallback((id: number) => {
    const row = rowById(id);
    if (!row || row.seq == null) return;
    setEditTarget({ seq: row.seq, text: row.text });
    setReplyTarget(null);
    setDraft(row.text);
    setActionFor(null);
  }, []);

  const deleteMine = useCallback(
    (id: number) => {
      const row = rowById(id);
      setActionFor(null);
      if (real) {
        if (row?.seq) void deleteChatMessage(row.seq, false);
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      }
    },
    [real, deleteChatMessage],
  );

  const deleteAll = useCallback(
    (id: number) => {
      const row = rowById(id);
      setActionFor(null);
      if (real) {
        if (row?.seq) void deleteChatMessage(row.seq, true);
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      }
    },
    [real, deleteChatMessage],
  );

  const startLongPress = useCallback((id: number) => {
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      setActionFor(id);
    }, 420);
  }, []);
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // A repin suppressed while the press was in flight is safe to run now.
    repin();
  }, [repin]);

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className={`flex items-center gap-3 border-b border-border px-4 py-2.5 ${DESKTOP_COL_PX}`}>
        {/* `onBack` is only passed by the desktop two-pane «Чаты», where this
            chevron went nowhere — it emptied the pane the user was reading.
            There the way out is picking another row, so the chevron is a phone
            affordance only. */}
        {!onBack && (
          <ChevronLeftIcon
            className={`size-6 shrink-0 text-foreground ${PRESS_FX}`}
            aria-label="Назад"
            onClick={() => {
              if (real) closeChat();
              nav.back();
            }}
          />
        )}
        <div className="relative shrink-0">
          <AnoonAvatar initials={peerInitials} tone={peerTone} size={38} />
          {peerOnline && (
            <span className="absolute bottom-0 right-0 size-2.5 rounded-full bg-online ring-2 ring-background" />
          )}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{peerName}</span>
          <span
            className={`truncate text-xs ${
              real && !peerOnline && !peerActivity ? "text-muted-foreground" : "text-online"
            }`}
          >
            {subtitle}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {/* Audio + video call buttons → useCallStore.startCall (Wave-2 #81 coupling). */}
          <button
            type="button"
            onClick={() => startCall("audio")}
            aria-label="Аудиозвонок"
            className={`grid size-8 place-items-center rounded-full text-foreground ${PRESS_FX}`}
          >
            <PhoneIcon className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => startCall("video")}
            aria-label="Видеозвонок"
            className={`grid size-8 place-items-center rounded-full text-foreground ${PRESS_FX}`}
          >
            <VideoIcon className="size-5" />
          </button>
          <MoreIcon
            className={`size-5 text-foreground ${PRESS_FX}`}
            aria-label="Меню чата"
            onClick={() => setMenuOpen((v) => !v)}
          />
        </div>

        {/* ⋮ dropdown */}
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setMenuOpen(false)}
              role="presentation"
            />
            <div className={`absolute right-3 top-14 z-40 w-52 origin-top-right overflow-hidden rounded-2xl border border-border bg-popover py-1 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none ${DESKTOP_COL_RIGHT}`}>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  nav.push("report");
                }}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted ${PRESS_FX}`}
              >
                <ReportIcon className="size-4.5 text-muted-foreground" />
                Пожаловаться
              </button>
            </div>
          </>
        )}
      </div>

      {/* Transient banner (upload errors, etc.) */}
      {banner && (
        <div className="anoon-msg-in absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background shadow-lg">
          {banner}
        </div>
      )}

      {/* Thread */}
      <div
        ref={threadRef}
        onScroll={onThreadScroll}
        className={`flex flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-4 py-3 lg:[.anoon-desktop_&]:justify-end ${DESKTOP_COL}`}
        onClick={() => {
          setActionFor(null);
        }}
      >
        {/* Desktop: pin a short thread to the BOTTOM of the work area. A phone
            viewport is filled by the thread anyway; a 900px-tall desktop one is
            not, and four messages hanging from the top with 400px of nothing
            above the composer read as a broken screen.
            A spacer rather than `justify-end` on purpose: `justify-content:
            flex-end` on a scroll container makes overflowing content unreachable
            above the scroll origin, while `margin-top:auto` collapses to 0 the
            moment the thread overflows. `hidden` keeps it out of the phone's box
            model entirely (no box, no gap-3 slot). */}
        <div aria-hidden className="hidden lg:[.anoon-desktop_&]:block lg:[.anoon-desktop_&]:mt-auto" />
        {!real && (
          <span className="my-1 self-center rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            Профили открыты — вы теперь друзья
          </span>
        )}
        {real && view.length === 0 && (
          <span className="my-1 self-center rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            Нет сообщений — напишите первым
          </span>
        )}

        {view.map((m) => (
          <Fragment key={m.key}>
            {/* Day divider when this row opens a new calendar day (BUG-26). */}
            {dayDividerFor[m.key] && (
              <div className="my-2 flex justify-center">
                <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
                  {dayDividerFor[m.key]}
                </span>
              </div>
            )}
            {m.system ? (
            // System line injected by RealtimeFix (e.g. «Собеседник покинул чат»).
            <div className="my-1 flex justify-center">
              <span className="max-w-[80%] rounded-full bg-muted px-3 py-1 text-center text-[11px] text-muted-foreground">
                {m.text}
              </span>
            </div>
          ) : (
          <div className="contents">
            {(m.text || m.deleted) && (
              <PrivateBubble
                id={m.id}
                seq={m.seq}
                own={m.own}
                text={m.text}
                time={m.time}
                status={m.status}
                reactionsKey={(m.reactions ?? []).map((r) => r.emoji + (r.mine ? "1" : "0")).join(",")}
                reactions={m.reactions}
                quote={m.replyTo?.text}
                quoteSeq={m.replyTo?.seq}
                edited={m.edited}
                deleted={m.deleted}
                canEdit={m.own && !!m.text && !m.media?.length && m.seq != null}
                actionsOpen={actionFor === m.id}
                onSetReaction={setReactionQuick}
                onOpenActions={openActions}
                onReact={react}
                onReply={reply}
                onEdit={edit}
                onDeleteMine={deleteMine}
                onDeleteAll={deleteAll}
                onCloseActions={closeActions}
                onStartLongPress={startLongPress}
                onCancelLongPress={cancelLongPress}
                onQuoteJump={jumpToSeq}
              />
            )}
            {m.media?.map((part, i) => (
              <ChatMediaBubble
                key={`${m.key}-media-${i}`}
                part={part}
                mine={m.own}
                timeLabel={m.time}
                read={m.status === "read"}
                viewOnce={m.viewOnce}
                viewed={m.seq != null ? Boolean(chatViewed[m.seq]) : false}
                onOpen={() =>
                  m.viewOnce
                    ? openViewOnce(m.key, i, m.seq)
                    : openConversationMedia(m.key, i)
                }
              />
            ))}
          </div>
            )}
          </Fragment>
        ))}

        {/* Sample media (mock preview only) */}
        {!real && (
          <MediaBubble
            kind="photo"
            aspectClassName="aspect-[4/3]"
            sizeLabel="2.1 MB"
            timeLabel="12:35"
            onOpen={() => nav.push("media-viewer")}
          />
        )}

        {/* Activity indicator — animated dots while the peer types, plus an
            «отправляет медиа…» label while they're uploading (BUG-18). */}
        {peerActivity && (
          <div className="flex items-center gap-2 self-start">
            <div className="flex items-center gap-1 rounded-2xl bg-bubble-in px-3.5 py-3">
              <TypingDots className="text-muted-foreground" />
            </div>
            {peerActivity === "media" && (
              <span className="text-[11px] text-muted-foreground">отправляет медиа…</span>
            )}
          </div>
        )}
      </div>

      {/* Scroll-to-latest button — shown when scrolled up away from the bottom. */}
      {showJump && (
        <button
          type="button"
          onClick={() => scrollToBottom()}
          aria-label="К последнему сообщению"
          // Desktop: ride the right edge of the thread column, not of the work
          // area — otherwise the button floats in the empty gutter beside it.
          className={`absolute bottom-20 right-3 z-20 grid size-9 place-items-center rounded-full border border-border bg-card text-foreground shadow-lg ${DESKTOP_COL_RIGHT} ${PRESS_FX}`}
        >
          <ChevronDownIcon className="size-5" />
        </button>
      )}

      {/* Reply-quote flash highlight keyframes (scoped; UA hides <style>). */}
      <style>{`
        @keyframes anoonQuoteFlash {
          0%, 100% { box-shadow: 0 0 0 0 transparent; }
          30%      { box-shadow: 0 0 0 3px var(--color-primary, #FDBF2D); }
        }
        .anoon-quote-flash { animation: anoonQuoteFlash 1.2s ease; }
        @media (prefers-reduced-motion: reduce) { .anoon-quote-flash { animation: none; } }
      `}</style>

      {/* Hint. The gestures are pointer events (onDoubleClick / onPointerDown),
          so a mouse drives them fine — only the wording was touch-only. Desktop
          gets the same two affordances named the way a mouse does them. */}
      <p className="px-4 pb-1 text-center text-[10px] text-muted-foreground">
        <span className="lg:[.anoon-desktop_&]:hidden">Двойной тап — ❤️, долгий тап — меню</span>
        <span className="hidden lg:[.anoon-desktop_&]:inline">
          Двойной клик — ❤️, зажать — меню
        </span>
      </p>

      {/* View-once armed hint */}
      {real && viewOnceArmed && (
        <div className="flex items-center gap-2 border-t border-border bg-card px-3 py-2 text-xs text-primary">
          <span>📷 Следующее фото — на один просмотр</span>
          <button
            type="button"
            onClick={() => setViewOnceArmed(false)}
            className={`ml-auto text-muted-foreground ${PRESS_FX}`}
          >
            Отменить
          </button>
        </div>
      )}

      {/* Reply / edit preview above composer */}
      {editTarget ? (
        <ReplyPreview
          text={editTarget.text}
          mode="edit"
          onCancel={() => {
            setEditTarget(null);
            setDraft("");
          }}
        />
      ) : replyTarget ? (
        <ReplyPreview text={replyTarget.text} onCancel={() => setReplyTarget(null)} />
      ) : null}

      {/* Composer. On desktop the hairline still spans the whole work area while
          the controls sit in the thread's column — done with padding rather than
          a nested wrapper so the phone markup is untouched. */}
      <div className={`flex items-center gap-2 border-t border-border px-3 py-2.5 ${DESKTOP_COL_PX}`}>
        {/* While recording, hide the text controls so the record bar owns the row (BUG-37). */}
        {!voiceRecording && (
          <>
            <PlusIcon
              className={`size-6 shrink-0 text-muted-foreground ${PRESS_FX}`}
              onClick={() => setAttachOpen(true)}
              aria-label="Прикрепить"
            />
            {/* View-once photo toggle (real mode only). */}
            {real && (
              <button
                type="button"
                onClick={() => setViewOnceArmed((v) => !v)}
                aria-label="Фото на один просмотр"
                className={`grid size-6 shrink-0 place-items-center rounded-full text-sm ${PRESS_FX} ${
                  viewOnceArmed ? "text-primary" : "text-muted-foreground/70"
                }`}
                title="Фото на один просмотр"
              >
                👁
              </button>
            )}
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              className={`shrink-0 text-muted-foreground ${PRESS_FX}`}
              aria-label="Эмодзи"
            >
              <EmojiIcon className="size-6" />
            </button>
            <input
              type="text"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={editTarget ? "Изменить сообщение" : "Сообщение"}
              className="flex-1 rounded-full bg-muted px-4 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </>
        )}
        {draft.trim().length > 0 ? (
          <button
            type="button"
            onClick={send}
            className={`shrink-0 text-primary ${PRESS_FX}`}
            aria-label="Отправить"
          >
            <SendIcon className="size-6" />
          </button>
        ) : real ? (
          <VoiceRecorder
            onRecordingChange={setVoiceRecording}
            onRecorded={async (file, dur) => {
              try {
                // Peer sees «отправляет медиа…» while the voice note uploads (BUG-18).
                useAnoonStore.getState().notifyMediaSending();
                const up = await uploadFile(file, file.name, file.type);
                await sendFriendMedia(up, "audio", { duration: Math.round(dur) });
              } catch {
                flash("Не удалось отправить");
              }
            }}
          />
        ) : (
          <button
            type="button"
            disabled
            className={`shrink-0 text-muted-foreground/40 ${PRESS_FX} disabled:pointer-events-none`}
            aria-label="Отправить"
          >
            <SendIcon className="size-6" />
          </button>
        )}
      </div>

      {/* Hidden native pickers for real photo/video attach (see sendAttachment). */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void handleFilePicked("image", file);
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void handleFilePicked("video", file);
        }}
      />

      {emojiOpen && (
        <div className={`absolute bottom-16 left-2 z-30 ${DESKTOP_COL_LEFT}`}>
          <EmojiPicker
            onSelect={(emoji) => setDraft((d) => d + emoji)}
            onClose={() => setEmojiOpen(false)}
          />
        </div>
      )}

      {attachOpen && (
        <AttachMenu onSelect={sendAttachment} onClose={() => setAttachOpen(false)} />
      )}
    </div>
  );
}
