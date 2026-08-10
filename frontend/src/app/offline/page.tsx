"use client";

/* Offline fallback served by the service worker when a navigation fails. */

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

export default function OfflinePage() {
  return (
    /* `dark` belongs here, not only inside AnoonApp: this page is its own root
       and the theme tokens are light at `:root`, so without it the offline
       fallback comes up as a white sheet in the middle of a black app — with
       its body text at 3.26:1, below AA. Same trap the app itself hit when the
       browser was never told the app is dark. */
    <div className="dark flex flex-1 flex-col items-center justify-center bg-background px-8 text-center text-foreground">
      <div className="flex size-20 items-center justify-center rounded-3xl bg-primary shadow-lg">
        <span className="text-3xl font-extrabold text-black">a</span>
      </div>

      <div className="mt-6 flex size-16 items-center justify-center rounded-full bg-muted">
        <GlobeOffIcon className="size-8 text-muted-foreground" />
      </div>

      <h1 className="mt-5 text-xl font-bold">Нет интернета</h1>
      <p className="mt-2 max-w-[16rem] text-sm text-muted-foreground">
        Проверьте подключение к сети и повторите попытку.
      </p>

      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-7 flex min-w-40 items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground transition-transform active:scale-95"
      >
        Повторить
      </button>
    </div>
  );
}
