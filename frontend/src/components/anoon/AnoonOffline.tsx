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

export default function AnoonOffline() {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = () => {
    setRetrying(true);
    setTimeout(() => setRetrying(false), 1400);
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
        onClick={handleRetry}
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
    </div>
  );
}
