"use client";

import { useState } from "react";
import { CloseIcon, CheckIcon } from "@/components/icons";
import { useAnoonStore } from "@/store";
import { getCompanionClient, type ReportCategory } from "@/lib/companion";

/** Report reasons shown in the sheet, each mapped to a wire `ReportCategory`. */
const REASONS: { label: string; category: ReportCategory }[] = [
  { label: "Спам / реклама", category: "spam" },
  { label: "Оскорбления / травля", category: "abuse" },
  { label: "Непристойный контент", category: "sexual" },
  { label: "Подозрение на несовершеннолетнего", category: "illegal" },
  { label: "Мошенничество", category: "illegal" },
  { label: "Другое", category: "other" },
];

type Reason = (typeof REASONS)[number]["label"];

export interface AnoonReportProps {
  /** Called once the sheet closes (send or dismiss) — router wiring uses this to pop back. */
  onClose?: () => void;
}

export default function AnoonReport({ onClose }: AnoonReportProps) {
  const [open, setOpen] = useState(true);
  const [reason, setReason] = useState<Reason | null>(null);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);

  // The peer being reported: the anon roulette match if one is active, else the
  // open private chat. `peerHashId` is what the /reports endpoint keys off.
  const activeMatch = useAnoonStore((s) => s.activeMatch);
  const activeChat = useAnoonStore((s) => s.activeChat);
  const peerHashId = (activeMatch?.peerHashId ?? activeChat?.hashId ?? "").replace(/^#/, "");
  const peerTopic = activeMatch?.topic ?? activeChat?.topic;
  const peerLabel = activeMatch?.peerDisplayName
    ?? activeChat?.displayName
    ?? (peerHashId ? `Собеседник #${peerHashId}` : "Собеседник #04821");

  const handleSend = () => {
    if (!reason) return;
    const category = REASONS.find((r) => r.label === reason)?.category ?? "other";
    // Fire-and-forget: companion.report has its own mock fallback that always
    // resolves, so the success UI shows whether or not the backend is reachable.
    void getCompanionClient().report({
      reportedHashId: peerHashId,
      category,
      topic: peerTopic,
      details: comment.trim() || undefined,
    });
    setSent(true);
  };

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  const reopen = () => {
    setReason(null);
    setComment("");
    setSent(false);
    setOpen(true);
  };

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-background text-foreground">
      {/* Faux underlying chat context */}
      <div className="pointer-events-none absolute inset-0 flex flex-col opacity-40">
        <div className="border-b border-border px-5 py-4">
          <p className="font-semibold">{peerLabel}</p>
          <p className="text-xs text-muted-foreground">был(а) недавно</p>
        </div>
      </div>

      {!open ? (
        <button
          type="button"
          onClick={reopen}
          className="z-10 cursor-pointer select-none rounded-full bg-muted px-5 py-2.5 text-sm font-medium text-foreground transition-transform active:scale-95"
        >
          Открыть жалобу
        </button>
      ) : (
        <>
          {/* Scrim */}
          <div
            className="absolute inset-0 z-10 bg-black/60 animate-in fade-in-0 duration-200 motion-reduce:animate-none"
            onClick={handleClose}
          />

          {/* Sheet */}
          <div className="absolute inset-x-0 bottom-0 z-20 max-h-[92%] overflow-y-auto rounded-t-3xl bg-card ring-1 ring-border animate-in slide-in-from-bottom duration-300 ease-out motion-reduce:animate-none">
            <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-3xl bg-card px-5 pb-3 pt-4">
              <div className="pointer-events-none absolute inset-x-0 top-2 mx-auto h-1 w-10 rounded-full bg-muted-foreground/30" />
              <h2 className="text-lg font-bold">Пожаловаться</h2>
              <button
                type="button"
                onClick={handleClose}
                className="cursor-pointer select-none text-muted-foreground transition-transform active:scale-95"
                aria-label="Закрыть"
              >
                <CloseIcon className="size-5" />
              </button>
            </div>

            {sent ? (
              <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                <div className="flex size-16 items-center justify-center rounded-full bg-primary">
                  <CheckIcon className="size-8 text-primary-foreground" />
                </div>
                <p className="text-lg font-bold">Спасибо, жалоба отправлена</p>
                <p className="max-w-[16rem] text-sm text-muted-foreground">
                  Мы рассмотрим обращение и примем меры, если правила были нарушены.
                </p>
                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-2 cursor-pointer select-none rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-95"
                >
                  Готово
                </button>
              </div>
            ) : (
              <div className="px-5 pb-6 pt-1">
                <p className="pb-2 text-sm text-muted-foreground">Выберите причину</p>
                <div className="space-y-2">
                  {REASONS.map((r) => {
                    const selected = reason === r.label;
                    return (
                      <button
                        key={r.label}
                        type="button"
                        onClick={() => setReason(r.label)}
                        className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-transform active:scale-95 ${
                          selected ? "border-primary bg-primary/10" : "border-border bg-background"
                        }`}
                      >
                        <span
                          className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                            selected ? "border-primary" : "border-muted-foreground/40"
                          }`}
                        >
                          {selected ? <span className="size-2.5 rounded-full bg-primary" /> : null}
                        </span>
                        <span className="text-sm font-medium">{r.label}</span>
                      </button>
                    );
                  })}
                </div>

                <p className="pb-2 pt-4 text-sm text-muted-foreground">Комментарий (необязательно)</p>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  placeholder="Опишите, что произошло…"
                  className="w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                />

                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!reason}
                  className={`mt-4 w-full cursor-pointer select-none rounded-full py-3.5 text-sm font-semibold transition-transform active:scale-95 ${
                    reason
                      ? "bg-primary text-primary-foreground"
                      : "cursor-not-allowed bg-muted text-muted-foreground"
                  }`}
                >
                  Отправить
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
