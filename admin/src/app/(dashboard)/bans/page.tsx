"use client";

import { useList, useUpdate } from "@refinedev/core";
import { motion } from "framer-motion";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import type { BanRow } from "@/data/fixtures";
import { addAction } from "@/lib/audit";
import { cn } from "@/lib/utils";

type Filter = "active" | "expired" | "lifted";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "active", label: "Активные" },
  { key: "expired", label: "Истёкшие" },
  { key: "lifted", label: "Снятые" },
];

export default function BansPage() {
  const { result, query } = useList<BanRow>({
    resource: "bans",
    sorters: [{ field: "createdAt", order: "desc" }],
    pagination: { mode: "off" },
  });
  const { mutate: update } = useUpdate();
  const [filter, setFilter] = useState<Filter>("active");
  const all = result?.data ?? [];
  const rows = all.filter((b) => b.state === filter);
  const count = (f: Filter) => all.filter((b) => b.state === f).length;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Баны</h1>

      <div className="mb-4 flex gap-2" role="tablist" aria-label="Фильтр банов">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition",
              filter === f.key ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-secondary hover:text-fg",
            )}
          >
            {f.label} <span className="tabular-nums opacity-70">{count(f.key)}</span>
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="text-sm text-fg-muted">Загрузка…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-1 p-10 text-center text-fg-muted">
          {filter === "active" ? "Активных банов нет" : filter === "expired" ? "Истёкших банов нет" : "Снятых банов нет"}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((b, i) => (
            <motion.div
              key={b.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut", delay: i * 0.03 }}
              className="flex items-center gap-4 rounded-xl border border-border bg-surface-1 p-4"
            >
              <div className="min-w-0 flex-1">
                <span className="font-medium">{b.nickname}</span>{" "}
                <span className="font-mono text-xs text-fg-muted">#{b.publicId}</span>
                <p className="text-sm text-fg-secondary">{b.reason}</p>
              </div>
              {b.state === "lifted" ? (
                <Badge tone="neutral">Снят</Badge>
              ) : b.state === "expired" ? (
                <Badge tone="neutral">Истёк</Badge>
              ) : (
                <Badge tone={b.expiresAt ? "warning" : "danger"}>{b.expiresAt ? "Временный" : "Перманентный"}</Badge>
              )}
              {b.state === "active" && (
                <button
                  onClick={() => {
                    update({ resource: "bans", id: b.id, values: { state: "lifted" } });
                    addAction({ type: "unban", target: `${b.nickname} #${b.publicId}`, reason: "Бан снят" });
                    toast(`Бан снят: ${b.nickname}`);
                  }}
                  className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium text-fg-secondary transition hover:text-fg"
                >
                  Снять
                </button>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
