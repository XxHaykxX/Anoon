"use client";

import { Copy, Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

type OnlineProfile = {
  id: string;
  publicId: string;
  nickname: string;
  emoji?: string;
  realGender: "male" | "female" | "any";
  lastSeen: string | null;
  reportCount?: number;
};

type Filter = "all" | "female" | "male";

// «Когда» в человекочитаемом виде.
function ago(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} сек назад`;
  const m = Math.round(s / 60);
  return `${m} мин назад`;
}

export default function OnlinePage() {
  const sp = useSearchParams();
  const initial = (sp.get("gender") as Filter) || "all";
  const [filter, setFilter] = useState<Filter>(initial === "female" || initial === "male" ? initial : "all");
  const [items, setItems] = useState<OnlineProfile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Загрузка списка онлайн по выбранному полу (near-live: обновляем каждые 15с).
  useEffect(() => {
    let alive = true;
    const gq = filter === "all" ? "" : `&gender=${filter}`;
    const load = () =>
      fetch(`/api/admin/overview?online=1${gq}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => alive && setItems(d.profiles ?? []))
        .catch((e) => alive && setErr(String(e)));
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [filter]);

  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: "Все" },
    { key: "female", label: "👧 Девочки" },
    { key: "male", label: "👦 Мальчики" },
  ];

  const count = useMemo(() => items?.length ?? 0, [items]);

  const copyId = (publicId: string) => {
    void navigator.clipboard?.writeText(`#${publicId}`).then(() => toast(`Скопировано: #${publicId}`));
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Онлайн сейчас</h1>
          <p className="text-sm text-fg-muted">Активность за последние 90 секунд · обновление live · {count}</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-surface-1 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                filter === t.key ? "bg-surface-2 text-accent" : "text-fg-secondary hover:text-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border border-border bg-surface-1 p-6 text-sm text-fg-muted">
          Нет доступа (нужен api-режим). {err}
        </div>
      ) : items === null ? (
        <div className="text-sm text-fg-muted">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface-1 p-16 text-center text-fg-muted">
          <Users size={26} />
          Сейчас никого нет онлайн
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-lg">
                {p.emoji ?? "🙂"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  <span className="font-medium">{p.nickname}</span>{" "}
                  <span className="font-mono text-xs text-fg-muted">#{p.publicId}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-fg-muted">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" /> {ago(p.lastSeen)}
                  </span>
                  <span>· {p.realGender === "female" ? "👧 Ж" : p.realGender === "male" ? "👦 М" : "· пол не указан"}</span>
                </div>
              </div>
              <button
                onClick={() => copyId(p.publicId)}
                aria-label={`Копировать #${p.publicId}`}
                title="Копировать #ID"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-2 hover:text-fg"
              >
                <Copy size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
