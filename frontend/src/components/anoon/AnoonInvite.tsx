"use client";

import { useState } from "react";
import { CheckIcon, ChevronLeftIcon, ForwardIcon } from "@/components/icons";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import { PRESS_FX } from "@/components/anoon/_shared";
import { USE_TINODE } from "@/lib/tinode";
import { useAnoonStore } from "@/store";

export default function AnoonInvite() {
  const nav = useAnoonNav();
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  // Real #ID from the signed-in user; stub only in the showcase (flag off / no user).
  const user = useAnoonStore((s) => s.user);
  const hashId = USE_TINODE && user ? user.hashId : "00001";
  const inviteLink = `anoon.app/add/${hashId}`;
  const inviteUrl = `https://${inviteLink}`;
  const myId = `#${hashId}`;

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(inviteUrl).catch(() => {});
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleShare = () => {
    // Real share sheet when available (mobile browsers); fall back to the
    // same copy-link behavior everywhere else rather than doing nothing.
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator
        .share({ title: "anoon", text: `Мой код ${myId}`, url: inviteUrl })
        .catch(() => {});
      return;
    }
    handleCopy();
    setShared(true);
    window.setTimeout(() => setShared(false), 1800);
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center gap-1 px-6 pb-2 pt-6">
        <button
          type="button"
          onClick={() => nav.back()}
          aria-label="Назад"
          className="-ml-5 grid size-12 shrink-0 place-items-center rounded-full text-foreground transition-transform active:scale-95"
        >
          <ChevronLeftIcon className="size-6" />
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Пригласить друга</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Отправьте ссылку или назовите свой #ID
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 pb-4">
        {/* #ID card — no QR (BUG-20: removed entirely, link + #ID is enough). */}
        <div className="mt-3 flex w-full flex-col items-center rounded-3xl border border-border bg-card p-6">
          <p className="text-xs text-muted-foreground">Мой код</p>
          <p className="mt-1 font-mono text-3xl font-bold tracking-wide">{myId}</p>
        </div>

        {/* Link pill */}
        <div className="mt-5 w-full">
          <p className="mb-1.5 px-1 text-xs text-muted-foreground">Ссылка-приглашение</p>
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-muted px-4 py-3">
            <span className="truncate text-sm font-medium">{inviteLink}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex w-full gap-2.5">
          <button
            type="button"
            onClick={handleCopy}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground ${PRESS_FX}`}
          >
            {copied ? (
              <>
                <CheckIcon className="size-4" />
                Скопировано
              </>
            ) : (
              "Скопировать ссылку"
            )}
          </button>
          <button
            type="button"
            onClick={handleShare}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full bg-muted py-3 text-sm font-semibold text-foreground ${PRESS_FX}`}
          >
            <ForwardIcon className="size-4" />
            {shared ? "Готово" : "Поделиться"}
          </button>
        </div>

        <p className="mt-4 px-2 text-center text-xs leading-relaxed text-muted-foreground">
          Кто перейдёт по ссылке — сможет отправить вам запрос дружбы.
          Свою собственную ссылку добавить нельзя.
        </p>
      </div>
    </div>
  );
}
