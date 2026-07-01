import { cn } from "@/lib/utils";

type Tone = "neutral" | "danger" | "warning" | "success" | "accent";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-secondary",
  danger: "bg-danger/15 text-danger",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
  accent: "bg-accent/15 text-accent",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}
