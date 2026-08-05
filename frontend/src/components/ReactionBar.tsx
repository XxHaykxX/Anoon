"use client";

import { PlusIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Quick-reaction emoji shown in the pill, in display order. */
const QUICK_REACTIONS = ["\u{1F44D}", "❤️", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F64F}"] as const;

export interface ReactionBarProps {
  /** Called with the selected emoji when a reaction button is pressed. */
  onReact: (emoji: string) => void;
  /** Called after a reaction is picked, or when the "more" button is pressed. */
  onClose?: () => void;
  /** Additional classes merged onto the root element. */
  className?: string;
}

/**
 * Small floating emoji reaction picker shown above a chat message.
 *
 * Usage: `<ReactionBar onReact={(emoji) => addReaction(messageId, emoji)} onClose={() => setPickerOpen(false)} />`
 */
export default function ReactionBar({ onReact, onClose, className }: ReactionBarProps) {
  const handlePick = (emoji: string) => {
    onReact(emoji);
    onClose?.();
  };

  return (
    <div
      role="menu"
      aria-label="React to message"
      className={cn(
        "anoon-screen-in flex items-center gap-1 rounded-full border border-border bg-popover px-2 py-1.5 shadow-lg",
        className,
      )}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          role="menuitem"
          onClick={() => handlePick(emoji)}
          aria-label={`React with ${emoji}`}
          className="flex size-10 items-center justify-center rounded-full text-2xl transition-transform hover:bg-muted active:scale-125"
        >
          {emoji}
        </button>
      ))}

      <button
        type="button"
        onClick={() => onClose?.()}
        aria-label="More reactions"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-transform hover:bg-muted hover:text-foreground active:scale-125"
      >
        <PlusIcon className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}
