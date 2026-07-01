"use client";

import { Copy, Folder, ImageIcon, Video } from "lucide-react";
import { useEffect, useState } from "react";

import { MediaGallery } from "@/components/media-gallery";
import { Pager } from "@/components/pager";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import type { MediaAssetRow } from "@/data/fixtures";
import { cn } from "@/lib/utils";

type FolderRow = { profileId: string; nickname: string; publicId: string; images: number; videos: number; count: number };

// Файл-менеджер медиа: папки по юзерам (слева) + галерея выбранного (справа).
// Данные — из Supabase Storage/MediaAsset через /api/admin/media (api-режим).
export default function MediaPage() {
  const [folders, setFolders] = useState<FolderRow[] | null>(null);
  const [sel, setSel] = useState<FolderRow | null>(null);
  const [filesState, setFilesState] = useState<{ profileId: string; items: MediaAssetRow[] } | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 60;

  // Сброс на первую страницу при смене папки/дат.
  const [prevKey, setPrevKey] = useState("");
  const key = `${sel?.profileId ?? ""}|${from}|${to}`;
  if (key !== prevKey) {
    setPrevKey(key);
    if (page !== 1) setPage(1);
  }

  useEffect(() => {
    fetch("/api/admin/media")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setFolders(d.folders ?? []))
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!sel) return;
    const pid = sel.profileId;
    const p = new URLSearchParams({ profileId: pid, page: String(page), pageSize: String(PAGE_SIZE) });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    fetch(`/api/admin/media?${p.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setFilesState({ profileId: pid, items: d.files ?? [] });
        setTotal(d.total ?? 0);
      })
      .catch(() => setFilesState({ profileId: pid, items: [] }));
  }, [sel, from, to, page]);

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
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Копировать #${f.publicId}`}
                    title="Копировать #ID"
                    onClick={(e) => {
                      e.stopPropagation();
                      void navigator.clipboard?.writeText(`#${f.publicId}`).then(() => toast(`Скопировано: #${f.publicId}`));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        void navigator.clipboard?.writeText(`#${f.publicId}`).then(() => toast(`Скопировано: #${f.publicId}`));
                      }
                    }}
                    className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                  >
                    <Copy size={14} />
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
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <h2 className="text-sm font-medium text-fg-secondary">
                    {sel.nickname} #{sel.publicId} · {total}
                  </h2>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col text-xs text-fg-muted">
                      С даты
                      <input
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        className="mt-1 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
                      />
                    </label>
                    <label className="flex flex-col text-xs text-fg-muted">
                      По дату
                      <input
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        className="mt-1 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-fg outline-none focus:border-accent"
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
                        Сброс
                      </button>
                    )}
                  </div>
                </div>
                {files === null ? (
                  <div className="text-sm text-fg-muted">Загрузка галереи…</div>
                ) : files.length === 0 ? (
                  <div className="py-16 text-center text-fg-muted">Нет медиа за выбранный период</div>
                ) : (
                  <>
                    <MediaGallery media={files} ownerLabel={`${sel.nickname} #${sel.publicId}`} ownerBadge={`#${sel.publicId}`} noBlur />
                    <Pager page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} onPage={setPage} />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
