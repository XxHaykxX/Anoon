"use client";

import { Folder, ImageIcon, Video } from "lucide-react";
import { useEffect, useState } from "react";

import { MediaGallery } from "@/components/media-gallery";
import { Badge } from "@/components/ui/badge";
import type { MediaAssetRow } from "@/data/fixtures";
import { cn } from "@/lib/utils";

type FolderRow = { profileId: string; nickname: string; publicId: string; images: number; videos: number; count: number };

// Файл-менеджер медиа: папки по юзерам (слева) + галерея выбранного (справа).
// Данные — из Supabase Storage/MediaAsset через /api/admin/media (api-режим).
export default function MediaPage() {
  const [folders, setFolders] = useState<FolderRow[] | null>(null);
  const [sel, setSel] = useState<FolderRow | null>(null);
  const [filesState, setFilesState] = useState<{ profileId: string; items: MediaAssetRow[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/media")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setFolders(d.folders ?? []))
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!sel) return;
    const pid = sel.profileId;
    fetch(`/api/admin/media?profileId=${encodeURIComponent(pid)}`)
      .then((r) => r.json())
      .then((d) => setFilesState({ profileId: pid, items: d.files ?? [] }))
      .catch(() => setFilesState({ profileId: pid, items: [] }));
  }, [sel]);

  // Файлы показываем только для текущей папки (иначе — состояние загрузки).
  const files = sel && filesState?.profileId === sel.profileId ? filesState.items : null;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Файлы</h1>
        <p className="text-sm text-fg-muted">Медиа пользователей — папки по профилям. Просмотр аудируется.</p>
      </div>

      {err ? (
        <div className="rounded-xl border border-border bg-surface-1 p-6 text-sm text-fg-muted">
          Нет доступа к медиа (нужен api-режим + Storage). {err}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          {/* Папки */}
          <div className="space-y-1.5">
            {folders === null ? (
              <div className="text-sm text-fg-muted">Загрузка…</div>
            ) : folders.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface-1 p-6 text-center text-fg-muted">Медиа нет</div>
            ) : (
              folders.map((f) => (
                <button
                  key={f.profileId}
                  onClick={() => setSel(f)}
                  aria-current={sel?.profileId === f.profileId}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border bg-surface-1 p-3 text-left transition-colors",
                    sel?.profileId === f.profileId ? "border-accent" : "border-border hover:border-white/20",
                  )}
                >
                  <Folder size={18} className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{f.nickname}</span>
                      <span className="font-mono text-xs text-fg-muted">#{f.publicId}</span>
                    </span>
                    <span className="flex items-center gap-3 text-xs text-fg-muted">
                      <span className="flex items-center gap-1"><ImageIcon size={12} />{f.images}</span>
                      <span className="flex items-center gap-1"><Video size={12} />{f.videos}</span>
                    </span>
                  </span>
                  <Badge tone="neutral">{f.count}</Badge>
                </button>
              ))
            )}
          </div>

          {/* Галерея */}
          <div className="rounded-xl border border-border bg-surface-1 p-5">
            {!sel ? (
              <div className="py-16 text-center text-fg-muted">Выбери папку слева</div>
            ) : files === null ? (
              <div className="text-sm text-fg-muted">Загрузка галереи…</div>
            ) : files.length === 0 ? (
              <div className="py-16 text-center text-fg-muted">У пользователя нет медиа</div>
            ) : (
              <>
                <h2 className="mb-3 text-sm font-medium text-fg-secondary">
                  {sel.nickname} #{sel.publicId} · {files.length}
                </h2>
                <MediaGallery media={files} ownerLabel={`${sel.nickname} #${sel.publicId}`} ownerBadge={`#${sel.publicId}`} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
