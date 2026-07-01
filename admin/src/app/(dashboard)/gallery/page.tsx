"use client";

import { Images, ImageIcon, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { MediaGallery } from "@/components/media-gallery";
import type { MediaAssetRow } from "@/data/fixtures";
import { cn } from "@/lib/utils";

type Filter = "all" | "image" | "video";

// Общая галерея: все фото/видео всех пользователей одним потоком (без папок).
// #ID владельца — на каждом тайле. Данные — /api/admin/media?all=1.
export default function GalleryPage() {
  const [items, setItems] = useState<MediaAssetRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    fetch("/api/admin/media?all=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setItems(d.files ?? []))
      .catch((e) => setErr(String(e)));
  }, []);

  const shown = useMemo(
    () => (items ?? []).filter((m) => (filter === "all" ? true : m.kind === filter)),
    [items, filter],
  );

  const counts = useMemo(() => {
    const list = items ?? [];
    return {
      all: list.length,
      image: list.filter((m) => m.kind === "image").length,
      video: list.filter((m) => m.kind === "video").length,
    };
  }, [items]);

  const tabs: { key: Filter; label: string; icon: typeof Images; n: number }[] = [
    { key: "all", label: "Все", icon: Images, n: counts.all },
    { key: "image", label: "Фото", icon: ImageIcon, n: counts.image },
    { key: "video", label: "Видео", icon: Video, n: counts.video },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Галерея</h1>
          <p className="text-sm text-fg-muted">Все медиа всех пользователей одним потоком. #ID — на каждом тайле.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-surface-1 p-1">
          {tabs.map(({ key, label, icon: Icon, n }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                filter === key ? "bg-surface-2 text-accent" : "text-fg-secondary hover:text-fg",
              )}
            >
              <Icon size={15} />
              {label}
              <span className="font-mono text-xs text-fg-muted">{n}</span>
            </button>
          ))}
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border border-border bg-surface-1 p-6 text-sm text-fg-muted">
          Нет доступа к медиа (нужен api-режим + Storage). {err}
        </div>
      ) : items === null ? (
        <div className="text-sm text-fg-muted">Загрузка…</div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-1 p-16 text-center text-fg-muted">Медиа нет</div>
      ) : (
        <MediaGallery media={shown} ownerLabel="Общая галерея" noBlur />
      )}
    </div>
  );
}
