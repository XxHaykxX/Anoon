"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

// Простой пагинатор: назад/вперёд + «стр N / M». Скрыт при одной странице.
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-5 flex items-center justify-center gap-3">
      <button
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="flex items-center gap-1 rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-fg-secondary transition hover:text-fg disabled:opacity-40"
      >
        <ChevronLeft size={16} /> Назад
      </button>
      <span className="text-sm tabular-nums text-fg-muted">
        {page} / {pages}
      </span>
      <button
        onClick={() => onPage(Math.min(pages, page + 1))}
        disabled={page >= pages}
        className="flex items-center gap-1 rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-fg-secondary transition hover:text-fg disabled:opacity-40"
      >
        Вперёд <ChevronRight size={16} />
      </button>
    </div>
  );
}
