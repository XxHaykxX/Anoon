import * as React from "react";
import { cn } from "@/lib/utils";
import { DoubleCheckIcon } from "@/components/icons";

interface LocationMessageProps {
  /** Render as an outgoing (sent) bubble instead of an incoming one. */
  own?: boolean;
  /** Bold place name shown under the map preview. */
  label?: string;
  /** Address / subtitle shown under the label. */
  address?: string;
  /** Extra classes merged onto the outer bubble. */
  className?: string;
}

/**
 * Static, presentational location/map chat bubble.
 *
 * Renders a CSS-only "map" preview (grid + faint road lines + a centered
 * pin) with a label/address footer, a small timestamp, and read-receipt
 * ticks when `own` is set. No client-side state — safe to render on the
 * server.
 *
 * @example
 * ```tsx
 * <LocationMessage />
 * <LocationMessage own label="The Roasted Bean" address="4 Market Ln, Riverside" />
 * ```
 */
export default function LocationMessage({
  own = false,
  label = "Coffee & Co.",
  address = "12 Harbor St, Old Town",
  className,
}: LocationMessageProps) {
  return (
    <div
      className={cn(
        "w-[240px] rounded-2xl overflow-hidden",
        own
          ? "bg-bubble-out text-bubble-out-foreground self-end"
          : "bg-bubble-in text-bubble-in-foreground self-start",
        className
      )}
    >
      {/* Map preview */}
      <div className="relative h-[130px] w-full overflow-hidden bg-muted">
        {/* faint grid */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 21px, var(--border) 21px, var(--border) 22px), repeating-linear-gradient(90deg, transparent, transparent 21px, var(--border) 21px, var(--border) 22px)",
          }}
        />
        {/* stylized "roads" */}
        <div className="absolute top-[28%] left-0 h-[3px] w-full bg-border/70 -rotate-2" />
        <div className="absolute top-0 left-[62%] h-full w-[3px] bg-border/70 rotate-3" />
        <div className="absolute top-[70%] left-0 h-[2px] w-full bg-border/50 rotate-1" />

        {/* pin */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            className={cn(
              "size-8 drop-shadow-md",
              own ? "text-destructive" : "text-primary"
            )}
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 2c-4.42 0-8 3.58-8 8 0 5.25 6.72 11.16 7.02 11.41a1.5 1.5 0 0 0 1.96 0C13.28 21.16 20 15.25 20 10c0-4.42-3.58-8-8-8Zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
          </svg>
          <span className="mt-0.5 h-1.5 w-4 rounded-full bg-black/25 blur-[1px]" />
        </div>
      </div>

      {/* Label / address row */}
      <div className="px-3 py-2 flex flex-col gap-0.5">
        <span className="text-sm font-medium truncate">{label}</span>
        <span
          className={cn(
            "text-xs truncate",
            own ? "text-bubble-out-foreground/60" : "text-muted-foreground"
          )}
        >
          {address}
        </span>

        <div className="mt-1 flex items-center justify-between gap-2">
          <a
            href="#"
            className="text-xs font-medium text-primary hover:underline"
          >
            Open in Maps
          </a>
          <span
            className={cn(
              "flex items-center gap-1 text-[11px] shrink-0",
              own ? "text-bubble-out-foreground/60" : "text-muted-foreground"
            )}
          >
            12:41 pm
            {own && <DoubleCheckIcon className="size-4" />}
          </span>
        </div>
      </div>
    </div>
  );
}
