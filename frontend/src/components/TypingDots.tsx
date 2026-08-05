import { cn } from "@/lib/utils"

interface TypingDotsProps {
  className?: string
}

/** Animated "typing…" indicator: `<TypingDots className="text-primary" />` */
export default function TypingDots({ className }: TypingDotsProps) {
  return (
    <span
      className={cn("anoon-typing inline-flex items-center gap-1", className)}
      role="status"
      aria-label="Typing"
    >
      <span className="anoon-typing__dot" style={{ animationDelay: "0ms" }} />
      <span className="anoon-typing__dot" style={{ animationDelay: "150ms" }} />
      <span className="anoon-typing__dot" style={{ animationDelay: "300ms" }} />
      <style>{`
        .anoon-typing__dot {
          width: 5px;
          height: 5px;
          border-radius: 9999px;
          background-color: currentColor;
          display: inline-block;
          animation: anoon-typing-bounce 1s ease-in-out infinite;
        }

        @keyframes anoon-typing-bounce {
          0%,
          80%,
          100% {
            opacity: 0.3;
            transform: translateY(0);
          }
          40% {
            opacity: 1;
            transform: translateY(-2px);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .anoon-typing__dot {
            animation: none;
            opacity: 1;
          }
        }
      `}</style>
    </span>
  )
}
