"use client";

import { useList, usePermissions, useUpdate } from "@refinedev/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckSquare, Square } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { BanDialog, type BanTarget } from "@/components/ban-dialog";
import { BulkBar } from "@/components/bulk-bar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import type { ProfileRow } from "@/data/fixtures";
import { addAction } from "@/lib/audit";
import { useSelection } from "@/lib/use-selection";
import { cn } from "@/lib/utils";

const VIRTUAL_THRESHOLD = 50; // виртуализация только на больших списках (stagger не применяем)
const ROW_H = 49;

export default function UsersPage() {
  const { result, query } = useList<ProfileRow>({
    resource: "users",
    sorters: [{ field: "reportCount", order: "desc" }],
    pagination: { mode: "off" },
  });
  const { mutate: update } = useUpdate();
  const { data: role } = usePermissions<string>({});
  const isSuper = role === "super_admin";
  const [banFor, setBanFor] = useState<{ id: string; target: BanTarget } | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const sel = useSelection();
  const rows = result?.data ?? [];

  // Выбираемы только не забаненные.
  const selectable = rows.filter((u) => !u.banned);
  const allSelected = selectable.length > 0 && selectable.every((u) => sel.has(u.id));

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = rows.length > VIRTUAL_THRESHOLD;
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual API by design
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    enabled: virtual,
  });

  function banOne(u: ProfileRow) {
    update({ resource: "users", id: u.id, values: { banned: true } });
    addAction({ type: "ban", target: `${u.nickname} #${u.publicId}`, reason: "Массовый бан" });
  }

  function toggleAll() {
    if (allSelected) sel.clear();
    else sel.set(selectable.map((u) => u.id));
  }

  const Row = (u: ProfileRow) => (
    <tr key={u.id} className={cn("border-t border-border bg-surface-1/50", sel.has(u.id) && "bg-surface-2")} style={{ height: ROW_H }}>
      <td className="w-10 px-4 py-3">
        {!u.banned && isSuper && (
          <button onClick={() => sel.toggle(u.id)} aria-label={sel.has(u.id) ? "Снять выбор" : "Выбрать"} className="text-fg-secondary transition hover:text-accent">
            {sel.has(u.id) ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} />}
          </button>
        )}
      </td>
      <td className="px-4 py-3">
        <Link href={`/users/${u.id}`} className="transition hover:text-accent">
          <span className="mr-2">{u.emoji}</span>
          {u.nickname}
        </Link>
      </td>
      <td className="px-4 py-3 font-mono text-fg-muted">#{u.publicId}</td>
      <td className="px-4 py-3">
        {u.banned ? <Badge tone="danger">Забанен</Badge> : u.online ? <Badge tone="success">Онлайн</Badge> : <Badge>Оффлайн</Badge>}
      </td>
      <td className="px-4 py-3 tabular-nums">{u.reportCount}</td>
      <td className="px-4 py-3 text-right">
        {!u.banned && (
          <button
            onClick={() => setBanFor({ id: u.id, target: { nickname: u.nickname, publicId: u.publicId } })}
            className="rounded-lg bg-danger/15 px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/25"
          >
            Бан
          </button>
        )}
      </td>
    </tr>
  );

  const items = virtualizer.getVirtualItems();
  const padTop = virtual && items.length ? items[0].start : 0;
  const padBottom = virtual && items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  return (
    <div>
      <h1 className="mb-5 text-xl font-semibold">Пользователи</h1>
      {query.isLoading ? (
        <div className="text-sm text-fg-muted">Загрузка…</div>
      ) : (
        <div ref={scrollRef} className={cn("overflow-auto rounded-xl border border-border", virtual && "max-h-[70vh]")}>
          <table className="w-full min-w-[560px] whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 bg-surface-1 text-left text-fg-muted">
              <tr>
                <th className="w-10 px-4 py-3">
                  {isSuper && (
                    <button onClick={toggleAll} aria-label="Выбрать всех" className="text-fg-secondary transition hover:text-accent">
                      {allSelected ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} />}
                    </button>
                  )}
                </th>
                <th className="px-4 py-3 font-medium">Ник</th>
                <th className="px-4 py-3 font-medium">#ID</th>
                <th className="px-4 py-3 font-medium">Статус</th>
                <th className="px-4 py-3 font-medium">Жалобы</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {virtual ? (
                <>
                  {padTop > 0 && <tr style={{ height: padTop }} />}
                  {items.map((vi) => Row(rows[vi.index]))}
                  {padBottom > 0 && <tr style={{ height: padBottom }} />}
                </>
              ) : (
                rows.map((u) => Row(u))
              )}
            </tbody>
          </table>
        </div>
      )}

      <BulkBar
        count={isSuper ? sel.count : 0}
        onClear={sel.clear}
        actions={[{ label: "Забанить выбранных", tone: "danger", onClick: () => setBulkConfirm(true) }]}
      />

      <ConfirmDialog
        open={bulkConfirm}
        title="Забанить выбранных?"
        message={`Будет забанено пользователей: ${sel.count}. Действие попадёт в журнал модератора.`}
        confirmLabel="Забанить"
        onClose={() => setBulkConfirm(false)}
        onConfirm={() => {
          const targets = rows.filter((u) => sel.has(u.id));
          targets.forEach(banOne);
          toast(`Забанено: ${targets.length}`, "danger");
          sel.clear();
          setBulkConfirm(false);
        }}
      />

      <BanDialog
        target={banFor?.target ?? null}
        allowPermanent={isSuper}
        onClose={() => setBanFor(null)}
        onConfirm={(res) => {
          if (!banFor) return;
          const expiresAt = res.expiresDays ? new Date(Date.now() + res.expiresDays * 86400_000).toISOString() : null;
          update({ resource: "users", id: banFor.id, values: { banned: true, reason: res.reason || undefined, expiresAt } });
          addAction({ type: "ban", target: `${banFor.target.nickname} #${banFor.target.publicId}`, reason: `${res.reason} · ${res.durationLabel}` });
          toast(`Забанен: ${banFor.target.nickname}`, "danger");
          setBanFor(null);
        }}
      />
    </div>
  );
}
