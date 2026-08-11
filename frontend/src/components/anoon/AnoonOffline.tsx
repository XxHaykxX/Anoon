"use client";

import { useState } from "react";

/* Local: globe with a slash through it. */
function GlobeOffIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export interface AnoonOfflineProps {
  /**
   * Called when the probe below proves the network is back. The shell (AnoonApp)
   * uses it to drop this overlay; the standalone "offline" route leaves it out.
   */
  onOnline?: () => void;
}

export default function AnoonOffline({ onOnline }: AnoonOfflineProps) {
  const [retrying, setRetrying] = useState(false);
  const [stillOffline, setStillOffline] = useState(false);

  /**
   * A real probe, not a spinner. This used to be `setTimeout(…, 1400)` — the
   * button spun, said nothing, and left the user on the same screen with no
   * idea whether anything had been checked.
   *
   * `navigator.onLine` is not enough on its own: it only reports whether the OS
   * has a link, and the usual case here is a link that carries no traffic. So
   * fetch something small and same-origin with the cache bypassed — the
   * manifest, which is always deployed — and let it fail if there's no route.
   */
  const handleRetry = async () => {
    setRetrying(true);
    setStillOffline(false);
    try {
      await fetch("/manifest.webmanifest", { method: "HEAD", cache: "no-store" });
      onOnline?.();
    } catch {
      setStillOffline(true);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-background px-8 text-center text-foreground">
      <div className="flex size-24 items-center justify-center rounded-full bg-muted">
        <GlobeOffIcon className="size-12 text-muted-foreground" />
      </div>

      <h1 className="mt-6 text-xl font-bold">Нет интернета</h1>
      <p className="mt-2 max-w-[16rem] text-sm text-muted-foreground">
        Проверьте подключение к сети и повторите попытку.
      </p>

      <button
        type="button"
        onClick={() => void handleRetry()}
        disabled={retrying}
        className="mt-7 flex min-w-40 items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform active:scale-95 disabled:opacity-70"
      >
        {retrying ? (
          <>
            <span className="size-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
            Проверяем…
          </>
        ) : (
          "Повторить"
        )}
      </button>

      {stillOffline && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Соединения по-прежнему нет
        </p>
      )}
    </div>
  );
}
