"use client";

import { ShieldIcon, LockIcon, ChevronLeftIcon } from "@/components/icons";
import { useAnoonNav } from "@/components/anoon/anoonNav";

export default function AnoonBanned() {
  const nav = useAnoonNav();
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-background px-8 text-center text-foreground">
      {/* Dev/back exit — real ban state has nowhere for the user to navigate to. */}
      <button
        type="button"
        onClick={() => nav.back()}
        aria-label="Назад"
        className="absolute left-1 top-6 grid size-12 place-items-center rounded-full text-foreground transition-transform active:scale-95"
      >
        <ChevronLeftIcon className="size-6" />
      </button>

      {/* Shield with lock */}
      <div className="relative mb-7">
        <div className="flex size-28 items-center justify-center rounded-full bg-destructive/10 ring-1 ring-destructive/30">
          <ShieldIcon className="size-14 text-destructive" />
        </div>
        <div className="absolute -bottom-1 -right-1 flex size-11 items-center justify-center rounded-full bg-destructive ring-4 ring-background">
          <LockIcon className="size-5 text-white" />
        </div>
      </div>

      <h1 className="text-2xl font-bold">Доступ заблокирован</h1>

      <p className="mt-3 max-w-[18rem] text-sm leading-relaxed text-muted-foreground">
        Ваш аккаунт заблокирован администрацией за нарушение правил сообщества.
        Чат и поиск собеседников больше недоступны.
      </p>

      <div className="mt-8 w-full max-w-[19rem] space-y-2.5">
        <div className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-border">
          <LockIcon className="size-5 shrink-0 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Отправка сообщений недоступна</span>
        </div>
        <div className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-border">
          <LockIcon className="size-5 shrink-0 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Поиск собеседников недоступен</span>
        </div>
      </div>

      <p className="mt-8 max-w-[18rem] text-xs text-muted-foreground/70">
        Если вы считаете, что произошла ошибка, обратитесь в поддержку.
      </p>
    </div>
  );
}
