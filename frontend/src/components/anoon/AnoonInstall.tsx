"use client";

import { useState } from "react";
import { ChevronLeftIcon, DownloadIcon, CheckIcon } from "@/components/icons";
import { AnoonLogo } from "@/components/anoon/_shared";
import { useAnoonNav } from "@/components/anoon/anoonNav";

/* Local iOS-style share icon (square with up arrow). */
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3v11" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 12H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-1" />
    </svg>
  );
}

/* Local add-to-home (plus in a rounded square). */
function AddSquareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

type Platform = "android" | "iphone";

export default function AnoonInstall() {
  const nav = useAnoonNav();
  const [platform, setPlatform] = useState<Platform>("android");
  const [installed, setInstalled] = useState(false);

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center gap-1 px-6 pt-6">
        <button
          type="button"
          onClick={() => nav.back()}
          aria-label="Назад"
          className="-ml-5 grid size-12 shrink-0 place-items-center rounded-full text-foreground transition-transform active:scale-95"
        >
          <ChevronLeftIcon className="size-6" />
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-7 pb-10 text-center">
        {/* App icon */}
        <div
          className="flex size-20 items-center justify-center rounded-3xl shadow-lg"
          style={{ background: "#FDBF2D" }}
        >
          <span className="text-3xl font-extrabold text-black">a</span>
        </div>

        <h1 className="mt-5 text-2xl font-bold">
          Установить <AnoonLogo className="text-2xl" />
        </h1>
        <p className="mt-2 max-w-[17rem] text-sm text-muted-foreground">
          Добавьте приложение на главный экран — быстрый запуск и уведомления,
          как в нативном приложении.
        </p>

        {/* Platform switch */}
        <div className="mt-6 inline-flex rounded-full bg-muted p-1 text-sm font-medium">
          <button
            type="button"
            onClick={() => setPlatform("android")}
            className={`rounded-full px-4 py-1.5 transition-colors ${
              platform === "android"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground"
            }`}
          >
            Android
          </button>
          <button
            type="button"
            onClick={() => setPlatform("iphone")}
            className={`rounded-full px-4 py-1.5 transition-colors ${
              platform === "iphone"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground"
            }`}
          >
            iPhone
          </button>
        </div>

        {/* Platform content */}
        <div className="mt-6 w-full">
          {platform === "android" ? (
            <button
              type="button"
              onClick={() => setInstalled(true)}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-95"
            >
              {installed ? (
                <>
                  <CheckIcon className="size-5" />
                  Устанавливается…
                </>
              ) : (
                <>
                  <DownloadIcon className="size-5" />
                  Установить
                </>
              )}
            </button>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-4 text-left">
              <p className="text-sm font-semibold">Как установить на iPhone</p>
              <ol className="mt-3 space-y-3 text-sm">
                <li className="flex items-center gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    1
                  </span>
                  <span className="flex flex-1 items-center gap-1.5">
                    Нажмите
                    <ShareIcon className="size-5 text-primary" />
                    <span className="font-medium">«Поделиться»</span>
                  </span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    2
                  </span>
                  <span className="flex flex-1 items-center gap-1.5">
                    Выберите
                    <AddSquareIcon className="size-5 text-primary" />
                    <span className="font-medium">«На экран „Домой“»</span>
                  </span>
                </li>
              </ol>

              {/* Arrow pointing down to the browser share bar */}
              <div className="mt-4 flex flex-col items-center text-muted-foreground">
                <svg
                  viewBox="0 0 24 40"
                  className="h-9 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2v32" />
                  <path d="M6 28l6 6 6-6" />
                </svg>
                <span className="text-[11px]">Кнопка «Поделиться» — внизу браузера</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
