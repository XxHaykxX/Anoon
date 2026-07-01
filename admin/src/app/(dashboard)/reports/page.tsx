"use client";

import { useList, useUpdate } from "@refinedev/core";
import { AnimatePresence, motion } from "framer-motion";
import { CheckSquare, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { BanDialog, type BanTarget } from "@/components/ban-dialog";
import { BulkBar } from "@/components/bulk-bar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MediaGallery } from "@/components/media-gallery";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import type { MediaAssetRow, ReportRow } from "@/data/fixtures";
import { addAction } from "@/lib/audit";
import { useSelection } from "@/lib/use-selection";
import { cn } from "@/lib/utils";

const reasonTone = { spam: "neutral", abuse: "danger", sexual: "warning", illegal: "danger", other: "neutral" } as const;
const reasonLabel = { spam: "Спам", abuse: "Оскорбления", sexual: "Сексуальное", illegal: "Противоправное", other: "Другое" } as const;

type BulkKind = "ban" | "dismiss" | null;

const fmt = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function ReportsPage() {
  const { result, query } = useList<ReportRow>({
    resource: "reports",
    sorters: [{ field: "createdAt", order: "desc" }],
    pagination: { mode: "off" },
  });
  const { result: mediaResult } = useList<MediaAssetRow>({ resource: "media", pagination: { mode: "off" } });
  const { mutate: update } = useUpdate();
  const [sel_, setSel] = useState(0);
  const [banFor, setBanFor] = useState<{ id: string; target: BanTarget } | null>(null);
  const [bulkKind, setBulkKind] = useState<BulkKind>(null);
  const pick = useSelection();

  const rows = (result?.data ?? []).filter((r) => r.status === "open" || r.status === "in_review");
  const allSelected = rows.length > 0 && rows.every((r) => pick.has(r.id));
  // Клампим индекс на чтении (список сокращается после бана/отклонения) — без setState в effect.
  const sel = rows.length ? Math.min(sel_, rows.length - 1) : 0;
  const selected = rows[sel] ?? null;
  const allMedia = mediaResult?.data ?? [];

  const dismiss = useCallback(
    (r: ReportRow) => {
      update({ resource: "reports", id: r.id, values: { status: "resolved_dismissed" } });
      addAction({ type: "dismiss_report", target: `${r.targetNickname} #${r.targetPublicId}`, reason: "Жалоба отклонена" });
      toast("Жалоба отклонена");
    },
    [update],
  );

  // Клавиатурный triage: J/K навигация, B бан, X отклонить.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (banFor || bulkKind) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j" || e.key === "ArrowDown") setSel(Math.min(sel + 1, rows.length - 1));
      else if (e.key === "k" || e.key === "ArrowUp") setSel(Math.max(sel - 1, 0));
      else if (e.key === "b" && rows[sel]) setBanFor({ id: rows[sel].id, target: { nickname: rows[sel].targetNickname, publicId: rows[sel].targetPublicId } });
      else if (e.key === "x" && rows[sel]) dismiss(rows[sel]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, sel, banFor, bulkKind, dismiss]);

  function toggleAll() {
    if (allSelected) pick.clear();
    else pick.set(rows.map((r) => r.id));
  }

  const openCount = rows.filter((r) => r.status === "open").length;

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Очередь жалоб</h1>
          <p className="text-sm text-fg-muted">
            Разбирай сверху вниз. <kbd className="rounded bg-surface-2 px-1">J/K</kbd> навигация · <kbd className="rounded bg-surface-2 px-1">B</kbd> бан · <kbd className="rounded bg-surface-2 px-1">X</kbd> отклонить
          </p>
        </div>
        <Badge tone="accent">{openCount} открытых</Badge>
      </div>

      {query.isLoading ? (
        <div className="text-sm text-fg-muted">Загрузка…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-1 p-10 text-center text-fg-muted">Жалоб нет</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          {/* Левая панель — список */}
          <div>
            <button onClick={toggleAll} className="mb-2 inline-flex items-center gap-2 text-xs text-fg-secondary transition hover:text-fg">
              {allSelected ? <CheckSquare size={16} className="text-accent" /> : <Square size={16} />}
              Выбрать все
            </button>
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {rows.map((r, i) => (
                  <motion.button
                    key={r.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2, ease: "easeOut", delay: query.isFetching ? 0 : i * 0.03 }}
                    onClick={() => setSel(i)}
                    aria-current={i === sel}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border bg-surface-1 p-3 text-left transition-colors",
                      i === sel ? "border-accent" : "border-border hover:border-white/20",
                      pick.has(r.id) && "bg-surface-2",
                    )}
                  >
                    <span
                      role="checkbox"
                      aria-checked={pick.has(r.id)}
                      aria-label={pick.has(r.id) ? "Снять выбор" : "Выбрать"}
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        pick.toggle(r.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          pick.toggle(r.id);
                        }
                      }}
                      className="shrink-0 cursor-pointer text-fg-secondary transition hover:text-accent"
                    >
                      {pick.has(r.id) ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">{r.targetNickname}</span>
                        <span className="font-mono text-xs text-fg-muted">#{r.targetPublicId}</span>
                      </span>
                      {r.note && <span className="block truncate text-sm text-fg-secondary">{r.note}</span>}
                    </span>
                    {r.reason === "illegal" && <Badge tone="danger">!</Badge>}
                    <Badge tone={reasonTone[r.reason]}>{reasonLabel[r.reason]}</Badge>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Правая панель — детали выбранной жалобы */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            {selected ? (
              <div className="rounded-xl border border-border bg-surface-1 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-lg font-semibold">{selected.targetNickname}</h2>
                      <span className="font-mono text-xs text-fg-muted">#{selected.targetPublicId}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tone={reasonTone[selected.reason]}>{reasonLabel[selected.reason]}</Badge>
                      {selected.reason === "illegal" && <Badge tone="danger">Эскалация</Badge>}
                      <span className="text-xs text-fg-muted">{fmt(selected.createdAt)}</span>
                    </div>
                  </div>
                </div>

                {selected.note ? (
                  <p className="mt-4 rounded-lg border border-border bg-surface-2/50 p-3 text-sm text-fg-secondary">{selected.note}</p>
                ) : (
                  <p className="mt-4 text-sm text-fg-muted">Без комментария</p>
                )}

                {/* Медиа нарушителя (приватность: просмотр аудируется в MediaGallery) */}
                <div className="mt-5">
                  <h3 className="mb-2 text-sm font-medium text-fg-secondary">Медиа пользователя</h3>
                  <MediaGallery
                    media={allMedia.filter((m) => m.ownerProfileId === selected.targetProfileId)}
                    ownerLabel={`${selected.targetNickname} #${selected.targetPublicId}`}
                  />
                </div>

                <div className="mt-6 flex gap-2">
                  <button
                    onClick={() => setBanFor({ id: selected.id, target: { nickname: selected.targetNickname, publicId: selected.targetPublicId } })}
                    className="flex-1 rounded-lg bg-danger/15 px-3 py-2.5 text-sm font-medium text-danger transition hover:bg-danger/25"
                  >
                    Забанить
                  </button>
                  <button
                    onClick={() => dismiss(selected)}
                    className="flex-1 rounded-lg bg-surface-2 px-3 py-2.5 text-sm font-medium text-fg-secondary transition hover:text-fg"
                  >
                    Отклонить
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-surface-1 p-10 text-center text-fg-muted">
                Выбери жалобу слева
              </div>
            )}
          </div>
        </div>
      )}

      <BulkBar
        count={pick.count}
        onClear={pick.clear}
        actions={[
          { label: "Забанить выбранных", tone: "danger", onClick: () => setBulkKind("ban") },
          { label: "Отклонить выбранные", onClick: () => setBulkKind("dismiss") },
        ]}
      />

      <ConfirmDialog
        open={bulkKind !== null}
        title={bulkKind === "ban" ? "Забанить по выбранным жалобам?" : "Отклонить выбранные жалобы?"}
        message={
          bulkKind === "ban"
            ? `Пользователи по ${pick.count} жалобам будут забанены. Действие попадёт в журнал.`
            : `Будет отклонено жалоб: ${pick.count}.`
        }
        confirmLabel={bulkKind === "ban" ? "Забанить" : "Отклонить"}
        tone={bulkKind === "ban" ? "danger" : "accent"}
        onClose={() => setBulkKind(null)}
        onConfirm={() => {
          const picked = rows.filter((r) => pick.has(r.id));
          if (bulkKind === "ban") {
            picked.forEach((r) => {
              update({ resource: "reports", id: r.id, values: { status: "resolved_banned" } });
              addAction({ type: "ban", target: `${r.targetNickname} #${r.targetPublicId}`, reason: "Массовый бан по жалобе" });
            });
            toast(`Забанено по жалобам: ${picked.length}`, "danger");
          } else {
            picked.forEach(dismiss);
          }
          pick.clear();
          setBulkKind(null);
        }}
      />

      <BanDialog
        target={banFor?.target ?? null}
        onClose={() => setBanFor(null)}
        onConfirm={(res) => {
          if (!banFor) return;
          update({ resource: "reports", id: banFor.id, values: { status: "resolved_banned" } });
          addAction({ type: "ban", target: `${banFor.target.nickname} #${banFor.target.publicId}`, reason: `${res.reason} · ${res.durationLabel}` });
          toast(`Забанен: ${banFor.target.nickname}`, "danger");
          setBanFor(null);
        }}
      />
    </div>
  );
}
