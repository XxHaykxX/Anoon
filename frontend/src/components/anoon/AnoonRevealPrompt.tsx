"use client";

import { useState } from "react";
import { BlockIcon, CloseIcon, UserCircleIcon } from "@/components/icons";
import { PRESS_FX } from "@/components/anoon/_shared";

type Resolution = "pending" | "opened" | "declined" | "blocked";

export interface AnoonRevealPromptProps {
  /**
   * Partner handle shown in the prompt. In the anon phase this is the per-match
   * alias («~K7X2QM»), which is all this screen ever legitimately holds — the
   * real «#00012» only exists after both sides have revealed.
   */
  partnerId?: string;
  /** Render as a centered modal overlay instead of an inline system card. */
  asModal?: boolean;
  onOpen?: () => void;
  onDecline?: () => void;
  onBlock?: () => void;
}

/**
 * Reveal-profile proposal — the core "make friends" moment of anoon.
 * Works standalone (self-contained state) or embedded inside a chat thread.
 */
export default function AnoonRevealPrompt({
  partnerId = "~SAMPLE",
  asModal = false,
  onOpen,
  onDecline,
  onBlock,
}: AnoonRevealPromptProps) {
  const [state, setState] = useState<Resolution>("pending");

  const card = (
    <div className="w-full max-w-[320px] rounded-2xl border border-border bg-card p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <UserCircleIcon className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-foreground">
            Собеседник хочет открыть профиль
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {`Собеседник ${partnerId} предлагает раскрыть профили — вы увидите имя, фото и станете друзьями.`}
          </p>
        </div>
      </div>

      {state === "pending" ? (
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              setState("opened");
              onOpen?.();
            }}
            className={`w-full rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground ${PRESS_FX}`}
          >
            Открыть
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setState("declined");
                onDecline?.();
              }}
              className={`flex-1 rounded-full bg-muted py-2.5 text-sm font-medium text-foreground ${PRESS_FX}`}
            >
              Отклонить
            </button>
            <button
              type="button"
              onClick={() => {
                setState("blocked");
                onBlock?.();
              }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full bg-destructive/15 py-2.5 text-sm font-medium text-destructive ${PRESS_FX}`}
            >
              <BlockIcon className="size-4" />
              Заблокировать
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm">
          {state === "opened" && (
            <span className="font-medium text-online">
              Профили открыты — вы теперь друзья
            </span>
          )}
          {state === "declined" && (
            <span className="text-muted-foreground">Предложение отклонено</span>
          )}
          {state === "blocked" && (
            <span className="flex items-center gap-1.5 font-medium text-destructive">
              <BlockIcon className="size-4" />
              Собеседник заблокирован
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (!asModal) {
    // Inline system message inside the thread.
    return <div className="anoon-msg-in flex w-full justify-center py-1">{card}</div>;
  }

  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/50 p-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <div className="relative animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none">
        <button
          type="button"
          onClick={() => onDecline?.()}
          aria-label="Закрыть"
          className={`absolute -right-1 -top-1 z-10 grid size-7 place-items-center rounded-full bg-muted text-muted-foreground ${PRESS_FX}`}
        >
          <CloseIcon className="size-4" />
        </button>
        {card}
      </div>
    </div>
  );
}
