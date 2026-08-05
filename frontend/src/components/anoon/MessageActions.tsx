"use client";

import ReactionBar from "@/components/anoon/ReactionBar";
import { PRESS_FX } from "@/components/anoon/_shared";
import { TrashIcon } from "@/components/icons";


/** Inline reply/quote icon (icons.tsx has no ReplyIcon). */
const ReplyIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M9 7 4 12l5 5" />
    <path d="M4 12h11a5 5 0 0 1 5 5v1" />
  </svg>
);

/** Copy / duplicate icon (icons.tsx has no CopyIcon). */
const CopyIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </svg>
);

/** Pencil / edit icon (icons.tsx has no EditIcon). */
const EditIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  >
    <path d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3z" />
    <path d="M13.5 6.5l3 3" />
  </svg>
);

export interface MessageActionsProps {
  /** Whether the target bubble is the local user's own message. */
  own: boolean;
  /** Own plain-text message → editing is offered. */
  canEdit: boolean;
  /** Own & recent → "удалить у всех" is offered (hard delete). */
  canDeleteAll: boolean;
  /** Pick a quick reaction emoji. */
  onReact: (emoji: string) => void;
  onReply: () => void;
  /** Copy the message text to the clipboard. Omitted for text-less (media-only) bubbles. */
  onCopy?: () => void;
  onEdit: () => void;
  /** Soft delete — hide for me only. */
  onDeleteMine: () => void;
  /** Hard delete — remove for everyone (own & recent). */
  onDeleteAll: () => void;
  /** Dismiss the sheet (also fired after any action). */
  onClose: () => void;
  /** Positioning classes from the parent (e.g. "right-0 top-full mt-1"). */
  className?: string;
}

/**
 * Long-press action sheet for a chat bubble: a quick-reaction row (reuses
 * {@link ReactionBar}) above a small menu — Ответить / Редактировать / Удалить
 * у меня / Удалить у всех. Wave-2 #84/#85/#86. The parent positions this via
 * `className` and provides an outside-click overlay of its own.
 */
export default function MessageActions({
  own,
  canEdit,
  canDeleteAll,
  onReact,
  onReply,
  onCopy,
  onEdit,
  onDeleteMine,
  onDeleteAll,
  onClose,
  className = "",
}: MessageActionsProps) {
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div className={`z-40 flex flex-col items-stretch gap-1.5 ${className}`}>
      <ReactionBar onPick={(emoji) => run(() => onReact(emoji))()} />

      {/* Enter animation matches the ReactionBar spring above it — without it
          the emoji row springs in and this menu snapped, a visible mismatch.
          `origin-top` is the neutral choice: the sheet is positioned relative
          to the bubble and can open on either side. */}
      <div className="w-40 origin-top overflow-hidden rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none">
        <button
          type="button"
          onClick={run(onReply)}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted ${PRESS_FX}`}
        >
          <ReplyIcon className="size-4 text-muted-foreground" />
          Ответить
        </button>

        {onCopy && (
          <button
            type="button"
            onClick={run(onCopy)}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted ${PRESS_FX}`}
          >
            <CopyIcon className="size-4 text-muted-foreground" />
            Копировать
          </button>
        )}

        {own && canEdit && (
          <button
            type="button"
            onClick={run(onEdit)}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted ${PRESS_FX}`}
          >
            <EditIcon className="size-4 text-muted-foreground" />
            Редактировать
          </button>
        )}

        <button
          type="button"
          onClick={run(onDeleteMine)}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted ${PRESS_FX}`}
        >
          <TrashIcon className="size-4 text-muted-foreground" />
          Удалить у меня
        </button>

        {own && canDeleteAll && (
          <button
            type="button"
            onClick={run(onDeleteAll)}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-destructive hover:bg-muted ${PRESS_FX}`}
          >
            <TrashIcon className="size-4" />
            Удалить у всех
          </button>
        )}
      </div>
    </div>
  );
}
