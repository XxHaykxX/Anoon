"use client";

import { Images, ImageIcon, Video } from "lucide-react";
import { useEffect, useState } from "react";

import { MediaGallery } from "@/components/media-gallery";
import { Pager } from "@/components/pager";
import type { MediaAssetRow } from "@/data/fixtures";
import { cn } from "@/lib/utils";

type Filter = "all" | "image" | "video";
const PAGE_SIZE = 60;

// Общая галерея: все медиа всех пользователей. Серверная пагинация + фильтр по дате/типу.
export default function GalleryPage() {
  const [items, setItems] = useState<MediaAssetRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  // Сброс на первую страницу при смене фильтров.
  const [prevKey, setPrevKey] = useState("");
  const key = `${filter}|${from}|${to}`;
  if (key !== prevKey) {
    setPrevKey(key);
    setItems(null); // показать загрузку при смене фильтра (render-phase, не в effect)
    if (page !== 1) setPage(1);
  }

  useEffect(() => {
    const p = new URLSearchParams({ all: "1", page: String(page), pageSize: String(PAGE_SIZE) });
    if (filter !== "all") p.set("kind", filter);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    fetch(`/api/admin/media?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setItems(d.files ?? []);
        setTotal(d.total ?? 0);
      })
      .catch((e) => setErr(String(e)));
  }, [filter, from, to, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tabs: { key: Filter; label: string; icon: typeof Images }[] = [
    { key: "all", label: "Все", icon: Images },
    { key: "image", label: "Фото", icon: ImageIcon },
    { key: "video", label: "Видео", icon: Video },
  ];

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Галерея</h1>
        <p className="text-sm text-fg-muted">Все медиа всех пользователей. #ID — на каждом тайле. Всего: {total}.</p>
      </div>

      {/* Панель фильтров */}
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-surface-1 p-1">
          {tabs.map(({ key: k, label, icon: Icon }) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                filter === k ? "bg-surface-2 text-accent" : "text-fg-secondary hover:text-fg",
              )}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
        <label className="flex flex-col text-xs text-fg-muted">
          С даты
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col text-xs text-fg-muted">
          По дату
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 rounded-lg border border-border bg-surface-1 px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
          />
        </label>
        {(from || to) && (
          <button
            onClick={() => {
              setFrom("");
              setTo("");
            }}
            className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-fg-secondary transition hover:text-fg"
          >
            Сбросить даты
          </button>
        )}
      </div>

      {err ? (
        <div className="rounded-xl border border-border bg-surface-1 p-6 text-sm text-fg-muted">
          Нет доступа к медиа (нужен api-режим + Storage). {err}
        </div>
      ) : items === null ? (
        <div className="text-sm text-fg-muted">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-1 p-16 text-center text-fg-muted">Медиа нет</div>
      ) : (
        <>
          <MediaGallery media={items} ownerLabel="Общая галерея" noBlur />
          <Pager page={page} pages={pages} onPage={setPage} />
        </>
      )}
    </div>
  );
}
