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
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  // The peer being reported: the anon roulette match if one is active, else the
  // open private chat. The two are picked apart up front rather than falling
  // through `??` field by field — an un-revealed roulette peer has no #ID at
  // all, and a per-field fallback would silently borrow the open chat's #ID and
  // file the report against the wrong person.
  const activeMatch = useAnoonStore((s) => s.activeMatch);
  const activeChat = useAnoonStore((s) => s.activeChat);
  const target = activeMatch
    ? {
        hashId: activeMatch.peerHashId,
        topic: activeMatch.topic,
        name: activeMatch.peerDisplayName
          ?? (activeMatch.peerAlias ? `Собеседник ${activeMatch.peerAlias}` : undefined),
      }
    : { hashId: activeChat?.hashId, topic: activeChat?.topic, name: activeChat?.displayName };

  const peerHashId = (target.hashId ?? "").replace(/^#/, "");
  // Последний фолбэк — просто «Собеседник», без хендла. Раньше здесь стоял
  // «Собеседник ~SAMPLE»: демонстрационный алиас из витрины, который на живом
  // экране жалобы читается как настоящий хендл того, на кого жалуются. Этот
  // путь достижим (перезагрузка в анон-чате до ответа `/roulette/status`), а
  // ошибиться в том, НА КОГО жалоба, — худшее, что может сказать этот экран.
  const peerLabel = target.name ?? (peerHashId ? `Собеседник #${peerHashId}` : "Собеседник");

  // Awaited, not fire-and-forget: the success sheet must mean the report was
  // actually filed. It used to render unconditionally, so a rejected report
  // still told the user «жалоба отправлена» — and someone who believes they
  // have reported an abuser does not report them again, so moderation never
  // hears about it. companion.report only resolves synthetically when the
  // backend is unreachable (the no-backend showcase); a real rejection throws.
  //
  // In the anon phase there is no #ID to send — companion resolves the target
  // from `topic` (match → the other member), which is also what proves the
  // reporter was in that conversation.
  const handleSend = async () => {
    if (!reason || sending) return;
    const category = REASONS.find((r) => r.label === reason)?.category ?? "other";
    setSending(true);
    setFailed(false);
    try {
      await getCompanionClient().report({
        reportedHashId: peerHashId || undefined,
        category,
        topic: target.topic,
        details: comment.trim() || undefined,
      });
      setSent(true);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  const reopen = () => {
    setReason(null);
    setComment("");
    setSent(false);
    setFailed(false);
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
          {/* Desktop: the sheet keeps its bottom anchor (it belongs to the chat
              it covers) but stops being a 1400px-wide bar — capped and centred.
              `inset-x-0` + `mx-auto` + a max width centres an absolutely
              positioned box. `lg:[.anoon-desktop_&]:` needs both halves: `lg:`
              alone fires in the showcase's 390px frames, the class alone is on
              the app root at every width (docs/DESKTOP-LAYOUT.md). */}
          <div className="absolute inset-x-0 bottom-0 z-20 max-h-[92%] overflow-y-auto rounded-t-3xl bg-card ring-1 ring-border animate-in slide-in-from-bottom duration-300 ease-out motion-reduce:animate-none lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:max-w-[32rem] lg:[.anoon-desktop_&]:rounded-b-3xl lg:[.anoon-desktop_&]:bottom-6">
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

                {/*
                  A failed report is stated plainly and the sheet stays open with
                  the reason and comment intact, so «Отправить ещё раз» is one tap
                  and nothing has to be retyped.
                */}
                {failed && (
                  <p role="alert" className="mt-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    Не удалось отправить жалобу. Проверьте соединение и попробуйте ещё раз.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!reason || sending}
                  className={`mt-4 w-full select-none rounded-full py-3.5 text-sm font-semibold transition-transform active:scale-95 ${
                    reason && !sending
                      ? "cursor-pointer bg-primary text-primary-foreground"
                      : "cursor-not-allowed bg-muted text-muted-foreground"
                  }`}
                >
                  {sending ? "Отправляем…" : failed ? "Отправить ещё раз" : "Отправить"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
