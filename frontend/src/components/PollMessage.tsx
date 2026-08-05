"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CheckIcon } from "@/components/icons";

interface PollMessageProps {
  /** Render as an outgoing (own) bubble instead of an incoming one. */
  own?: boolean;
  /** The poll question shown above the options. */
  question?: string;
  /** The list of selectable poll options. */
  options?: string[];
  className?: string;
}

const DEFAULT_QUESTION = "Where should we go for the team offsite?";
const DEFAULT_OPTIONS: string[] = ["Lisbon 🇵🇹", "Bali 🇮🇩", "Tbilisi 🇬🇪", "Cape Town 🇿🇦"];

/** Small seeded pseudo-random generator so initial vote counts are stable across SSR/CSR. */
function seededVotes(count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const seed = Math.sin(i * 12.9898 + 45.164) * 43758.5453;
    const frac = seed - Math.floor(seed);
    return 1 + Math.floor(frac * 6); // 1..6 votes
  });
}

/**
 * Interactive poll chat bubble for the Anoon messenger.
 *
 * Renders a question with an "Anonymous Poll" caption and a list of tappable
 * options. Tapping an option casts a vote (client-side only) and switches the
 * options into result bars showing each option's share of the total votes,
 * with a checkmark on the option the user picked.
 *
 * @example
 * <PollMessage
 *   question="What should we order for lunch?"
 *   options={["Pizza", "Sushi", "Burgers"]}
 * />
 *
 * @example
 * // Outgoing (own) bubble with defaults
 * <PollMessage own />
 */
export default function PollMessage({
  own = false,
  question = DEFAULT_QUESTION,
  options = DEFAULT_OPTIONS,
  className,
}: PollMessageProps) {
  const safeOptions = options.length > 0 ? options : DEFAULT_OPTIONS;

  const [votes, setVotes] = React.useState<Record<number, number>>(() => {
    const seeded = seededVotes(safeOptions.length);
    return Object.fromEntries(seeded.map((v, i) => [i, v]));
  });
  const [voted, setVoted] = React.useState<number | null>(null);

  const totalVotes = React.useMemo(
    () => Object.values(votes).reduce((sum, v) => sum + v, 0),
    [votes]
  );

  function handleVote(index: number) {
    if (voted !== null) return;
    setVotes((prev) => ({ ...prev, [index]: (prev[index] ?? 0) + 1 }));
    setVoted(index);
  }

  return (
    <div
      className={cn(
        "rounded-2xl px-3.5 py-3 max-w-[280px] flex flex-col gap-0.5",
        own
          ? "bg-bubble-out text-bubble-out-foreground self-end"
          : "bg-bubble-in text-bubble-in-foreground self-start",
        className
      )}
    >
      <p className="text-[15px] font-medium leading-snug">{question}</p>
      <p className={cn("text-xs mb-2", own ? "opacity-70" : "text-muted-foreground")}>
        Anonymous Poll
      </p>

      <div className="flex flex-col gap-1.5">
        {safeOptions.map((option, index) => {
          const count = votes[index] ?? 0;
          const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isChosen = voted === index;

          if (voted === null) {
            return (
              <button
                key={index}
                type="button"
                onClick={() => handleVote(index)}
                className={cn(
                  "text-left text-sm rounded-xl px-3 py-2 transition-colors active:scale-[0.98]",
                  "active:opacity-80",
                  own ? "bg-black/10 hover:bg-black/15" : "bg-black/5 hover:bg-black/10"
                )}
              >
                {option}
              </button>
            );
          }

          return (
            <div
              key={index}
              className="relative overflow-hidden rounded-xl px-3 py-2 bg-primary/25"
            >
              <span
                className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${percent}%` }}
                aria-hidden="true"
              />
              <span className="relative flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 min-w-0">
                  {isChosen && (
                    <CheckIcon className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate">{option}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">{percent}%</span>
              </span>
            </div>
          );
        })}
      </div>

      <p className={cn("text-xs mt-2", own ? "opacity-70" : "text-muted-foreground")}>
        {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
      </p>
    </div>
  );
}
