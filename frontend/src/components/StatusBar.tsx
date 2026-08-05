import { cn } from "@/lib/utils"

interface StatusBarProps {
  className?: string
}

/**
 * Static iOS-style status bar for the top of a phone mockup frame.
 * Intentionally non-interactive (no live clock) to avoid SSR/client
 * time-mismatch hydration warnings — always shows "9:41".
 *
 * @example
 * <StatusBar />
 */
export default function StatusBar({ className }: StatusBarProps) {
  return (
    <div
      className={cn(
        "h-7 px-6 flex items-center justify-between text-foreground text-xs font-semibold select-none",
        className
      )}
    >
      <span>9:41</span>
      <span className="flex items-center gap-1.5">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <rect x="0.5" y="9" width="2.5" height="6" rx="0.5" />
          <rect x="4.5" y="7" width="2.5" height="8" rx="0.5" />
          <rect x="8.5" y="4.5" width="2.5" height="10.5" rx="0.5" />
          <rect x="12.5" y="1.5" width="2.5" height="13.5" rx="0.5" />
        </svg>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M8 13.2a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z" />
          <path d="M8 9.4c-1.5 0-2.9.55-4 1.5a.6.6 0 0 1-.8-.9A7.4 7.4 0 0 1 8 8c1.85 0 3.55.65 4.8 1.9a.6.6 0 1 1-.85.85A6.2 6.2 0 0 0 8 9.4z" />
          <path d="M8 5.9c-2.55 0-4.9 1-6.65 2.65a.6.6 0 1 1-.8-.9A11.4 11.4 0 0 1 8 4.6c2.95 0 5.65 1.15 7.65 3.05a.6.6 0 0 1-.85.85A10.2 10.2 0 0 0 8 5.9z" />
        </svg>
        <svg
          width="18"
          height="16"
          viewBox="0 0 18 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <rect
            x="0.75"
            y="2.75"
            width="14.5"
            height="10.5"
            rx="2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            opacity="0.4"
          />
          <rect x="2.25" y="4.25" width="11.5" height="7.5" rx="1.2" />
          <rect x="16" y="6" width="1.5" height="4" rx="0.75" />
        </svg>
      </span>
    </div>
  )
}
