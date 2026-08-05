"use client";

import { CloseIcon } from "@/components/icons";
import { PRESS_FX } from "@/components/anoon/_shared";

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

/** Pencil icon for the edit-in-progress preview (icons.tsx has no EditIcon). */
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

export interface ReplyPreviewProps {
  /** The quoted / being-edited message body. */
  text: string;
  /** Dismiss the preview (cancel the reply or the edit). */
  onCancel: () => void;
  /** "edit" swaps the label + icon for the edit-in-progress case. */
  mode?: "reply" | "edit";
}

/**
 * The strip shown just above the composer while composing a reply (a quoted
 * snippet of the target message) or editing an existing message. Rendering is
 * self-contained; the parent owns the reply/edit state and the cancel action.
 */
export default function ReplyPreview({ text, onCancel, mode = "reply" }: ReplyPreviewProps) {
  const editing = mode === "edit";
  return (
    <div className="flex items-center gap-2 border-t border-border bg-card px-3 py-2">
      {editing ? (
        <EditIcon className="size-4 shrink-0 text-primary" />
      ) : (
        <ReplyIcon className="size-4 shrink-0 text-primary" />
      )}
      <div className="min-w-0 flex-1 border-l-2 border-primary pl-2">
        <p className="text-[11px] font-medium text-primary">
          {editing ? "Редактирование" : "Ответ"}
        </p>
        <p className="truncate text-xs text-muted-foreground">{text}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label={editing ? "Отменить редактирование" : "Отменить ответ"}
        className={`grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground ${PRESS_FX}`}
      >
        <CloseIcon className="size-4" />
      </button>
    </div>
  );
}
