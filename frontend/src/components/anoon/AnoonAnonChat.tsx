"use client";

import { Fragment, memo, useCallback, useEffect, useRef, useState } from "react";
import VoiceMessage from "@/components/VoiceMessage";
import MediaBubble from "@/components/MediaBubble";
import EmojiPicker from "@/components/EmojiPicker";
import AttachMenu from "@/components/AttachMenu";
import TypingDots from "@/components/TypingDots";
import ChatMediaBubble from "@/components/anoon/ChatMediaBubble";
import MessageActions from "@/components/anoon/MessageActions";
import ReplyPreview from "@/components/anoon/ReplyPreview";
import VoiceRecorder from "@/components/anoon/VoiceRecorder";
import { StatusDot, AnoonAvatar, PRESS_FX } from "@/components/anoon/_shared";
import AnoonConversationEnded from "@/components/anoon/AnoonConversationEnded";
import AnoonRevealPrompt from "@/components/anoon/AnoonRevealPrompt";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import {
  USE_TINODE,
  uploadFile,
  authedFileUrl,
  getTinodeClient,
  type MediaKind,
  type MediaPart,
} from "@/lib/tinode";
import { getCompanionClient } from "@/lib/companion";
import { useAnoonStore } from "@/store";
import { useMediaViewerStore, type MediaViewerItem } from "@/store/mediaViewerStore";
import { useCallStore } from "@/store/callStore";
import {
  ChevronLeftIcon,
  PlusIcon,
  EmojiIcon,
  MicIcon,
  PhoneIcon,
  VideoIcon,
  SendIcon,
  CheckIcon,
  DoubleCheckIcon,
  CloseIcon,
  BlockIcon,
  UserCircleIcon,
} from "@/components/icons";

const PARTNER_ID = "~SAMPLE";

/**
 * Placeholder message text sent per attach type. Real media upload is Phase F;
 * for now picking an attachment drops a labelled text bubble into the thread.
 */
const ATTACH_PLACEHOLDER: Record<string, string> = {
  photo: "📷 Фото",
  camera: "📷 Фото",
  file: "📎 Файл",
  location: "📍 Геопозиция",
  contact: "👤 Контакт",
  poll: "📊 Опрос",
  music: "🎵 Аудио",
  gif: "🎞️ GIF",
};

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
  own: boolean;
  text: string;
  time: string;
  status?: DeliveryStatus;
  quote?: string;
  media?: MediaPart[];
};

/** Unified per-row view model rendered by {@link AnonBubble}. */
type Row = {
  key: string;
  id: number;
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

const INITIAL_MESSAGES: MockMsg[] = [
  { id: 1, own: false, text: "Привет! Как настроение сегодня?", time: "18:02" },
  { id: 2, own: true, text: "Привет 👋 Отличное, только с работы", time: "18:03", status: "read" },
  { id: 3, own: false, text: "О, знакомо. Чем занимаешься?", time: "18:04" },
  { id: 4, own: true, text: "Дизайню приложения. А ты?", time: "18:05", status: "read" },
  { id: 5, own: false, text: "Пишу музыку по вечерам 🎹", time: "18:06" },
];

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
 * A single anonymous-chat message bubble. Memoized on its (primitive) props so
 * appending a message or opening one bubble's action sheet re-renders only that
 * bubble. Callbacks must be referentially stable and receive the bubble `id` so
 * the parent resolves the live row (seq/text) from its ref.
 */
const AnonBubble = memo(function AnonBubble({
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
  void reactionsKey; // primitive used only for memo comparisons

  if (deleted) {
    return (
      <div className={`flex max-w-[78%] ${own ? "self-end" : "self-start"}`}>
        <span className="rounded-2xl bg-muted px-3.5 py-2 text-sm italic text-muted-foreground">
          сообщение удалено
        </span>
      </div>
    );
  }

  return (
    <div
      className={`relative flex max-w-[78%] flex-col ${
        own ? "items-end self-end" : "items-start self-start"
      }`}
    >
      <div
        data-seq={seq}
        className={`anoon-msg-in relative select-none rounded-2xl px-3.5 py-2 ${
          own ? "bg-bubble-out text-bubble-out-foreground" : "bg-bubble-in text-bubble-in-foreground"
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
              own ? "text-bubble-out-foreground/60" : "text-bubble-in-foreground/50"
            }`}
          >
            {edited && <span className="italic opacity-70">изменено</span>}
            {time}
            {own && <StatusTicks status={status} />}
          </span>
        </div>

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

/** Anonymous chat screen (роулетка) — Собеседник #ID, no photo/name. */
export default function AnoonAnonChat() {
  const nav = useAnoonNav();
  const real = USE_TINODE;

  // Real anon-chat state (companion match + Tinode anon topic), driven by the
  // store. In mock mode these are unused and the local sample thread renders.
  const activeMatch = useAnoonStore((s) => s.activeMatch);
  const storeMessages = useAnoonStore((s) => s.messages);
  const storePeerTyping = useAnoonStore((s) => s.peerTyping);
  // Peer activity ("typing" | "media" | null) for the active anon chat — note
  // the anon field is `anonPeerActivity` (the friend chat uses `peerActivity`).
  // Falls back to the boolean peerTyping below. (BUG-18)
  const storePeerActivity = useAnoonStore((s) => s.anonPeerActivity);
  const anonRevealState = useAnoonStore((s) => s.anonRevealState);
  const anonRevealPending = useAnoonStore((s) => s.anonRevealPending);
  const anonViewed = useAnoonStore((s) => s.anonViewed);
  const sendAnonMessage = useAnoonStore((s) => s.sendAnonMessage);
  const sendAnonMedia = useAnoonStore((s) => s.sendAnonMedia);
  const sendAnonReaction = useAnoonStore((s) => s.sendAnonReaction);
  const editAnonMessage = useAnoonStore((s) => s.editAnonMessage);
  const deleteAnonMessage = useAnoonStore((s) => s.deleteAnonMessage);
  const markAnonViewed = useAnoonStore((s) => s.markAnonViewed);
  const notifyAnonTyping = useAnoonStore((s) => s.notifyAnonTyping);
  const requestReveal = useAnoonStore((s) => s.requestReveal);
  const respondReveal = useAnoonStore((s) => s.respondReveal);
  const resyncAnonReveal = useAnoonStore((s) => s.resyncAnonReveal);
  const anonRevealAsksLeft = useAnoonStore((s) => s.anonRevealAsksLeft);
  // Both asks used and declined: the server refuses any further request in this
  // match, so disable before the tap rather than explaining after it.
  const revealAsksExhausted = real && anonRevealAsksLeft === 0;
  const rateMatch = useAnoonStore((s) => s.rateMatch);
  const endMatch = useAnoonStore((s) => s.endMatch);
  const closeAnon = useAnoonStore((s) => s.closeAnon);
  const openViewer = useMediaViewerStore((s) => s.openViewer);

  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<MockMsg[]>(INITIAL_MESSAGES);
  const [reactions, setReactions] = useState<Record<number, string>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [actionFor, setActionFor] = useState<number | null>(null);
  const [replyTarget, setReplyTarget] = useState<{ seq?: number; text: string } | null>(null);
  const [editTarget, setEditTarget] = useState<{ seq: number; text: string } | null>(null);
  const [viewOnceArmed, setViewOnceArmed] = useState(false);
  const [ended, setEnded] = useState(false);
  // In mock mode the reveal card shows immediately; in real mode it appears only
  // when the peer actually asks (anonRevealState === "peer_requested").
  const [showReveal, setShowReveal] = useState(!USE_TINODE);
  const [banner, setBanner] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  // True while the voice recorder is capturing — the composer hides its other
  // controls and gives the record bar the whole row (BUG-37).
  const [voiceRecording, setVoiceRecording] = useState(false);
  const lastKpAt = useRef(0);
  const longPressTimer = useRef<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<Row[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);

  // NOTE: closeAnon() is deliberately NOT tied to this component's unmount.
  // activeMatch lives in the app-level store (populated by AnoonApp's always-on
  // companion listener, not by this component), so an unmount-cleanup effect
  // here fires on React StrictMode's dev-only mount→cleanup→remount and wipes
  // it out from under a still-active match. Real "leave" points call closeAnon()
  // explicitly instead.

  // Flash a one-time confirmation the moment the profiles are revealed. This
  // syncs a transient UI banner to a one-shot store event (reveal), which is a
  // legitimate effect-driven setState.
  useEffect(() => {
    if (real && anonRevealState === "revealed") {
      setBanner("Профили открыты — вы теперь друзья");
      const t = setTimeout(() => setBanner(null), 2200);
      return () => clearTimeout(t);
    }
  }, [real, anonRevealState]);

  // Heal the reveal handshake when the tab comes back to the foreground.
  //
  // reveal_request / reveal_declined ride the same best-effort socket as
  // everything else, so a backgrounded tab can miss one and then sit on a stale
  // «Ожидание…» that nothing clears — the exact stuck state #23 exists to
  // remove, just reached through a dropped frame instead of a missing event.
  // Visibility regain is when that can have happened, so we resync precisely
  // then rather than polling on a timer: it fires when it can help and stays
  // quiet when it cannot.
  useEffect(() => {
    if (!real) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") void resyncAnonReveal();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [real, resyncAnonReveal]);

  // Derived peer identity: anonymous «Собеседник ~K7X2QM» until a mutual reveal.
  //
  // Two different handles, deliberately spelled differently. Before the reveal
  // companion sends only a per-match pseudonym («~K7X2QM») — it used to send the
  // peer's real permanent #ID here, which let either side add/block/report/find
  // the other with no consent. The «#00012» form appears only once peerHashId
  // exists, i.e. after applyRevealed.
  const revealed = real && anonRevealState === "revealed";
  const partnerId = real
    ? activeMatch?.peerHashId
      ? `#${activeMatch.peerHashId.replace(/^#/, "")}`
      : activeMatch?.peerAlias ?? ""
    : PARTNER_ID;
  const headerName = revealed ? activeMatch?.peerDisplayName ?? "Собеседник" : "Собеседник";
  const peerInitials = (activeMatch?.peerDisplayName?.trim()[0] ?? "?").toUpperCase();

  // After a mutual reveal, surface the peer's real avatar in the header. The
  // photo ref rides on the anon topic's `public` (un-blanked by the reveal), but
  // may land a beat after `revealed` flips — poll a few times, then fall back to
  // initials (BUG-14). Read-only use of the tinode client.
  const [peerAvatarUrl, setPeerAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!revealed || !activeMatch?.topic) {
      setPeerAvatarUrl(null);
      return;
    }
    const topic = activeMatch.topic;
    let tries = 0;
    const read = () => {
      const ref = getTinodeClient().avatarRefFor(topic);
      if (ref) {
        setPeerAvatarUrl(authedFileUrl(ref));
        return true;
      }
      return false;
    };
    if (read()) return;
    const iv = window.setInterval(() => {
      if (read() || ++tries > 6) window.clearInterval(iv);
    }, 500);
    return () => window.clearInterval(iv);
  }, [revealed, activeMatch?.topic]);

  const view: Row[] = real
    ? storeMessages.map((m, i) => {
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
        status: m.own ? m.status : undefined,
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

  // Keep the thread pinned to the latest message: jump instantly on first paint,
  // then smooth-follow new messages only while the user is already near the
  // bottom (so reading history isn't yanked away).
  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
    setShowJump(false);
  };
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (!didInitialScroll.current) {
      // Wait for the first non-empty paint so history that loads a beat later
      // still pins to the bottom instead of consuming the flag while empty.
      if (view.length === 0) return;
      el.scrollTop = el.scrollHeight;
      didInitialScroll.current = true;
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [view.length]);
  const onThreadScroll = () => {
    const el = threadRef.current;
    if (el) setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
  };
  // Tapping a reply-quote scrolls to (and briefly flashes) the quoted message.
  const jumpToSeq = useCallback((seq: number) => {
    const el = threadRef.current?.querySelector<HTMLElement>(`[data-seq="${seq}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("anoon-quote-flash");
    window.setTimeout(() => el.classList.remove("anoon-quote-flash"), 1200);
  }, []);

  // Unified peer-activity signal: prefer the store's "typing"/"media" field,
  // fall back to the boolean, and always animate in mock mode (BUG-18).
  const peerActivity: "typing" | "media" | null = real
    ? (storePeerActivity ?? (storePeerTyping ? "typing" : null))
    : "typing";
  const peerActivityText = peerActivity === "media" ? "отправляет медиа…" : "печатает…";

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
    if (editTarget) {
      if (real) void editAnonMessage(editTarget.seq, trimmed);
      else
        setMessages((prev) =>
          prev.map((m) => (m.id === editTarget.seq ? { ...m, text: trimmed } : m)),
        );
      setEditTarget(null);
      setDraft("");
      setEmojiOpen(false);
      return;
    }
    if (real) {
      const reply =
        replyTarget?.seq != null ? { seq: replyTarget.seq, text: replyTarget.text } : undefined;
      void sendAnonMessage(trimmed, reply);
      setDraft("");
      setReplyTarget(null);
      setEmojiOpen(false);
      return;
    }
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), own: true, text: trimmed, time: formatNow(), status: "sent", quote: replyTarget?.text },
    ]);
    setDraft("");
    setReplyTarget(null);
    setEmojiOpen(false);
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    // Throttle typing notifications to ~1 every 3s (real mode only).
    if (real && Date.now() - lastKpAt.current > 3000) {
      lastKpAt.current = Date.now();
      notifyAnonTyping();
    }
  };

  // End → rating → rate (real) or just close the overlay (mock).
  const finishRating = (rating?: number) => {
    setEnded(false);
    if (!real) return;
    if (rating) void rateMatch(rating);
    closeAnon();
    nav.go("home");
  };

  // Tap "Раскрыть профиль": ask the peer to reveal (real) or preview the card.
  //
  // A rejected request surfaces instead of passing for sent: the client used to
  // fabricate a `revealed` event on failure, so the chat claimed the profiles
  // were open while the match was still anonymous server-side.
  const onRevealClick = () => {
    if (!real) {
      setShowReveal(true);
      return;
    }
    void requestReveal().catch(() => {
      flash("Не удалось отправить запрос. Попробуйте ещё раз.");
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

  const startCall = (media: "audio" | "video") => {
    if (!real) return;
    // Address the peer by whichever handle we legitimately hold: the real #ID
    // once revealed, the per-match alias while anonymous. Companion resolves an
    // alias only inside the match that minted it, so an anonymous call needs no
    // #ID — and neither side's #ID rides the signaling frames.
    const to = activeMatch?.peerHashId
      ? `#${activeMatch.peerHashId.replace(/^#/, "")}`
      : activeMatch?.peerAlias;
    if (!to) return;
    useCallStore.getState().startCall(to, headerName, media);
  };

  // ── Message-action callbacks (stable) ────────────────────────────────────
  const setReactionQuick = useCallback(
    (id: number, emoji: string) => {
      const row = rowById(id);
      if (real) {
        if (row?.seq) void useAnoonStore.getState().sendAnonReaction(row.seq, emoji);
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
        if (row?.seq) void sendAnonReaction(row.seq, emoji);
      } else {
        setReactions((prev) => ({ ...prev, [id]: emoji }));
      }
    },
    [real, sendAnonReaction],
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
        if (row?.seq) void deleteAnonMessage(row.seq, false);
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      }
    },
    [real, deleteAnonMessage],
  );
  const deleteAll = useCallback(
    (id: number) => {
      const row = rowById(id);
      setActionFor(null);
      if (real) {
        if (row?.seq) void deleteAnonMessage(row.seq, true);
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      }
    },
    [real, deleteAnonMessage],
  );
  const startLongPress = useCallback((id: number) => {
    longPressTimer.current = window.setTimeout(() => setActionFor(id), 420);
  }, []);
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const flash = (text: string) => {
    setMenuOpen(false);
    setBanner(text);
    setTimeout(() => setBanner(null), 2200);
  };

  // Block the anonymous peer, then end the match and leave.
  //
  // Awaited, and we only leave once the block actually landed. A block is a
  // safety action: if it silently failed and we walked out anyway, the user
  // would believe they were protected while the matcher could still pair them
  // with that person again. On failure we stay put with the menu closed and a
  // banner, so the action can simply be repeated.
  const blockPeer = async () => {
    setMenuOpen(false);
    if (!real) {
      flash("Собеседник заблокирован");
      return;
    }
    // Keyed by topic, not #ID: the anon phase withholds the peer's #ID, so
    // companion resolves the match itself and treats membership in it as the
    // authorization. Lands in the same blacklist as a block by #ID.
    const topic = activeMatch?.topic;
    if (topic) {
      try {
        await getCompanionClient().blockAnonPeer(topic);
      } catch {
        flash("Не удалось заблокировать. Попробуйте ещё раз.");
        return;
      }
    }
    void endMatch();
    closeAnon();
    nav.go("home");
  };

  // Upload a picked file and drop it into the thread as a media message.
  const handleFilePicked = async (kind: MediaKind, file: File | undefined) => {
    if (!file) return;
    const useViewOnce = kind === "image" && viewOnceArmed;
    setViewOnceArmed(false);
    try {
      // Tell the peer we're uploading → they see «отправляет медиа…» (BUG-18).
      useAnoonStore.getState().notifyAnonMediaSending();
      const up = await uploadFile(file, file.name, file.type);
      await sendAnonMedia(up, kind, undefined, useViewOnce ? { viewOnce: true } : undefined);
    } catch {
      flash("Не удалось отправить");
    }
  };

  // Attach: real mode opens the native photo/video picker and uploads for
  // real; mock mode (no live topic) keeps the old labelled placeholder bubble.
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
      { id: Date.now(), own: true, text, time: formatNow(), status: "sent" },
    ]);
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
    if (seq != null) markAnonViewed(seq);
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

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
        <ChevronLeftIcon
          className={`size-6 shrink-0 text-foreground ${PRESS_FX}`}
          aria-label="Назад"
          onClick={() => {
            if (real) closeAnon();
            nav.back();
          }}
        />

        {/*
          Avatar: anonymous gray mask until reveal, then the peer's real avatar
          (or initials) dissolves in — the anon blur clears as identity lands
          (BUG-14). The `key` flips on reveal so the entrance animation re-fires.
        */}
        <style>{`
          @keyframes anoonRevealAvatar {
            0%   { filter: blur(14px); opacity: 0.3; transform: scale(0.82); }
            55%  { filter: blur(3px);  opacity: 1;   transform: scale(1.04); }
            100% { filter: blur(0);    opacity: 1;   transform: scale(1); }
          }
          .anoon-reveal-avatar { animation: anoonRevealAvatar 0.6s cubic-bezier(0.2,0.7,0.2,1) both; }
          @keyframes anoonQuoteFlash {
            0%, 100% { box-shadow: 0 0 0 0 transparent; }
            30%      { box-shadow: 0 0 0 3px var(--color-primary, #FDBF2D); }
          }
          .anoon-quote-flash { animation: anoonQuoteFlash 1.2s ease; }
          @media (prefers-reduced-motion: reduce) {
            .anoon-reveal-avatar { animation: none; }
            .anoon-quote-flash { animation: none; }
          }
        `}</style>
        <div
          key={revealed ? "avatar-revealed" : "avatar-anon"}
          className={`size-9 shrink-0 overflow-hidden rounded-full ${revealed ? "anoon-reveal-avatar ring-2 ring-primary" : ""}`}
        >
          {revealed && peerAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- server-relative ref, no next/image loader needed
            <img
              src={peerAvatarUrl}
              alt={headerName}
              className="size-full object-cover"
            />
          ) : revealed ? (
            <AnoonAvatar initials={peerInitials} tone={0} size={36} />
          ) : (
            <div className="grid size-full place-items-center bg-muted text-muted-foreground">
              <UserCircleIcon className="size-6" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{headerName}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {/*
              No tabular-nums: this is «~K7X2QM» for the whole anonymous phase
              and only becomes an all-digit «#00012» after a reveal. Fixed-width
              figures on an almost letters-only string buy no alignment (it is a
              single inline handle, not a column) and just widen the digits that
              do appear.
            */}
            {/*
              Nothing at all until the handle is known (page reload in an anon
              chat, before /roulette/status answers). A bare «—» read as the
              person being called that, where an absent line just reads as
              loading — which is what it is.
            */}
            {partnerId && <span>{partnerId}</span>}
            <StatusDot online />
            {peerActivity && <span className="truncate text-online">{peerActivityText}</span>}
          </span>
        </div>

        {/* Audio + video call buttons → useCallStore.startCall (Wave-2 #81 coupling). */}
        {real && activeMatch && (
          <>
            <button
              type="button"
              onClick={() => startCall("audio")}
              aria-label="Аудиозвонок"
              className={`grid size-8 shrink-0 place-items-center rounded-full text-foreground ${PRESS_FX}`}
            >
              <PhoneIcon className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => startCall("video")}
              aria-label="Видеозвонок"
              className={`grid size-8 shrink-0 place-items-center rounded-full text-foreground ${PRESS_FX}`}
            >
              <VideoIcon className="size-5" />
            </button>
          </>
        )}

        {!revealed && (
          <button
            type="button"
            onClick={onRevealClick}
            disabled={anonRevealPending || revealAsksExhausted}
            className={`shrink-0 rounded-full bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60 ${PRESS_FX}`}
          >
            {anonRevealPending ? "Ожидание…" : "Раскрыть"}
          </button>
        )}

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Меню чата"
          className={`grid size-8 shrink-0 place-items-center rounded-full text-foreground ${PRESS_FX}`}
        >
          <MoreIcon className="size-5" />
        </button>

        {/* ⋮ dropdown */}
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setMenuOpen(false)}
              role="presentation"
            />
            <div className="absolute right-3 top-14 z-40 w-52 origin-top-right overflow-hidden rounded-2xl border border-border bg-popover py-1 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  if (real) void endMatch();
                  setEnded(true);
                }}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted ${PRESS_FX}`}
              >
                <CloseIcon className="size-4.5 text-muted-foreground" />
                Завершить разговор
              </button>
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
              <button
                type="button"
                onClick={() => void blockPeer()}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-destructive hover:bg-muted ${PRESS_FX}`}
              >
                <BlockIcon className="size-4.5" />
                Заблокировать
              </button>
            </div>
          </>
        )}
      </div>

      {/* Transient banner */}
      {banner && (
        <div className="anoon-msg-in absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background shadow-lg">
          {banner}
        </div>
      )}

      {/* Thread */}
      <div
        ref={threadRef}
        onScroll={onThreadScroll}
        className="flex flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden px-3 py-3"
        onClick={() => setActionFor(null)}
      >
        <div className="mx-auto rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
          {revealed
            ? "Профили открыты — вы теперь друзья"
            : partnerId
              ? `Вы общаетесь анонимно · ${partnerId}`
              : "Вы общаетесь анонимно"}
        </div>

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
              <AnonBubble
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
                viewed={m.seq != null ? Boolean(anonViewed[m.seq]) : false}
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
          <>
            <MediaBubble
              kind="photo"
              aspectClassName="aspect-[4/3]"
              sizeLabel="1.8 MB"
              timeLabel="18:07"
              onOpen={() => nav.push("media-viewer")}
            />
            <VoiceMessage durationSec={12} own />
          </>
        )}

        {/*
          Peer declined our reveal request. Neutral and non-final by design: a
          decline can be reconsidered, the «Раскрыть» button is usable again
          (anonRevealPending was cleared), and nothing here names or blames
          either side. Asking again clears this line.
        */}
        {real && anonRevealState === "declined" && !revealAsksExhausted && (
          <div className="anoon-msg-in flex w-full justify-center py-1">
            <p className="max-w-[320px] rounded-2xl bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
              Собеседник пока не готов открыть профиль. Можно предложить позже.
            </p>
          </div>
        )}

        {/*
          Both asks spent. This replaces the «можно предложить позже» line rather
          than sitting next to it — that line would now be untrue. Says plainly
          that the door is not shut, only that it is no longer ours to open:
          the peer's own ability to propose is a separate budget, and being
          exhausted never blocks accepting.
        */}
        {revealAsksExhausted && (
          <div className="anoon-msg-in flex w-full justify-center py-1">
            <p className="max-w-[320px] rounded-2xl bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
              Вы уже дважды предлагали раскрыть профиль. Больше предложить нельзя — но собеседник
              всё ещё может предложить сам.
            </p>
          </div>
        )}

        {/*
          Reveal-profile proposal as an inline system card.
          Mock: shown on demand (local state). Real: shown when the peer asks
          (anonRevealState === "peer_requested"); actions hit the companion.
        */}
        {((real && anonRevealState === "peer_requested") || (!real && showReveal)) && (
          <AnoonRevealPrompt
            partnerId={partnerId}
            onOpen={() => {
              setShowReveal(false);
              if (real)
                void respondReveal(true).catch(() => {
                  flash("Не удалось раскрыть профиль. Попробуйте ещё раз.");
                });
              else flash("Профили открыты — вы теперь друзья");
            }}
            onDecline={() => {
              setShowReveal(false);
              if (real)
                void respondReveal(false).catch(() => {
                  flash("Не удалось отправить ответ. Попробуйте ещё раз.");
                });
            }}
            // «Заблокировать» now actually blocks. It used to send a plain
            // decline and flash «Собеседник заблокирован» — the card said the
            // peer was blocked while nothing was, so the matcher could pair them
            // again and the user had been told not to worry. Blocking ends the
            // match, which answers the reveal request more definitively than a
            // decline would, so there is nothing to send first.
            onBlock={() => {
              setShowReveal(false);
              void blockPeer();
            }}
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
          className={`absolute bottom-20 right-3 z-20 grid size-9 place-items-center rounded-full border border-border bg-card text-foreground shadow-lg ${PRESS_FX}`}
        >
          <ChevronDownIcon className="size-5" />
        </button>
      )}

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

      {/* Composer */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
        {/* While recording, hide the text controls so the record bar owns the row (BUG-37). */}
        {!voiceRecording && (
          <>
            <PlusIcon
              className={`size-6 shrink-0 text-muted-foreground ${PRESS_FX}`}
              onClick={() => setAttachOpen(true)}
            />
            {/* View-once photo toggle (anon only, real mode). */}
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
            <input
              type="text"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={editTarget ? "Изменить сообщение" : "Сообщение"}
              className="min-w-0 flex-1 rounded-full bg-muted px-4 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <EmojiIcon
              className={`size-6 shrink-0 text-muted-foreground ${PRESS_FX}`}
              onClick={() => setEmojiOpen((v) => !v)}
            />
          </>
        )}
        {draft.trim().length > 0 ? (
          <button
            type="button"
            onClick={send}
            aria-label="Отправить"
            className={`grid size-6 shrink-0 place-items-center text-primary ${PRESS_FX}`}
          >
            <SendIcon className="size-6" />
          </button>
        ) : real ? (
          <VoiceRecorder
            onRecordingChange={setVoiceRecording}
            onRecorded={async (file, dur) => {
              try {
                // Peer sees «отправляет медиа…» while the voice note uploads (BUG-18).
                useAnoonStore.getState().notifyAnonMediaSending();
                const up = await uploadFile(file, file.name, file.type);
                await sendAnonMedia(up, "audio", { duration: Math.round(dur) });
              } catch {
                flash("Не удалось отправить");
              }
            }}
          />
        ) : (
          // Mock mode has no live topic to record into — explain-itself affordance.
          <button
            type="button"
            onClick={() => flash("Голосовые сообщения скоро")}
            aria-label="Голосовое сообщение (скоро)"
            className={`grid size-6 shrink-0 place-items-center text-muted-foreground/60 ${PRESS_FX}`}
          >
            <MicIcon className="size-6" />
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
        <div className="absolute bottom-16 left-2 z-30">
          <EmojiPicker
            onSelect={(emoji) => setDraft((d) => d + emoji)}
            onClose={() => setEmojiOpen(false)}
          />
        </div>
      )}

      {attachOpen && (
        <AttachMenu onSelect={sendAttachment} onClose={() => setAttachOpen(false)} />
      )}

      {ended && (
        <AnoonConversationEnded
          onSubmit={(rating) => finishRating(rating)}
          onSkip={() => finishRating()}
        />
      )}
    </div>
  );
}
