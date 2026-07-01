"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { getActions, subscribeActions, type ModActionType } from "@/lib/audit";

const typeLabel: Record<ModActionType, string> = {
  ban: "Бан",
  unban: "Разбан",
  mute: "Мут",
  dismiss_report: "Отклонение",
  escalate: "Эскалация",
  view_private: "Просмотр приватного",
};
const typeTone = (t: ModActionType) => (t === "ban" || t === "escalate" ? "danger" : t === "mute" ? "warning" : "neutral");

export default function AuditPage() {
  const [, force] = useState(0);
  useEffect(() => subscribeActions(() => force((n) => n + 1)), []);
  const actions = getActions();

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Журнал действий модератора</h1>
      <p className="mb-5 text-sm text-fg-muted">Каждый бан/мут/просмотр приватного/эскалация фиксируется (приватность и комплаенс).</p>

      {actions.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-1 p-10 text-center text-fg-muted">Действий пока нет</div>
      ) : (
        <div className="space-y-2">
          {actions.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-xl border border-border bg-surface-1 p-4 sm:gap-4">
              <Badge tone={typeTone(a.type)}>{typeLabel[a.type]}</Badge>
              <div className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.target}</span>
                <p className="truncate text-sm text-fg-secondary">{a.reason}</p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-fg-muted sm:text-xs">{new Date(a.at).toLocaleString("ru-RU")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
