"use client";

import { cn } from "@/lib/utils";
import { ChevronLeftIcon, PlayIcon } from "@/components/icons";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import {
  useMediaViewerStore,
  type MediaViewerItem,
} from "@/store/mediaViewerStore";

/** Inline SVG gradient as a data URI, so the showcase items are real <img> src. */
function gradientSrc(from: string, to: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='720' height='960'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${from}'/><stop offset='1' stop-color='${to}'/>` +
    `</linearGradient></defs><rect width='720' height='960' fill='url(#g)'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

type DemoThumb = { label: string; kind: "photo" | "video"; from: string; to: string };

const DEMO_THUMBS: DemoThumb[] = [
  { label: "Фото 1", kind: "photo", from: "#8E9BC0", to: "#5F6F9E" },
  { label: "Видео", kind: "video", from: "#93BEA0", to: "#64977B" },
  { label: "Фото 2", kind: "photo", from: "#CE93A6", to: "#AC6C86" },
];

/** Real MediaViewerItems for the showcase — gradient data-URIs stand in for photos. */
const DEMO_ITEMS: MediaViewerItem[] = DEMO_THUMBS.map((t) => ({
  src: gradientSrc(t.from, t.to),
  type: "image",
  caption: t.label,
}));

/**
 * Standalone preview screen: a couple of tappable thumbnails that open the
 * global fullscreen {@link AnoonMediaViewer} (mounted once in AnoonApp) starting
 * at the tapped item. Drives the same store the real chat screens use, via
 * `openViewer` — no direct viewer render, no demo-only prop path (BUG-10).
 */
export default function AnoonMediaViewerDemo() {
  const nav = useAnoonNav();
  const openViewer = useMediaViewerStore((s) => s.openViewer);

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-1 px-6 pb-3 pt-6">
        <button
          type="button"
          onClick={() => nav.back()}
          aria-label="Назад"
          className="-ml-3 grid size-9 shrink-0 place-items-center rounded-full text-foreground transition-transform active:scale-95"
        >
          <ChevronLeftIcon className="size-6" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Медиа</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Тап по фото или видео — открыть на весь экран. Щипок — зум, двойной тап —
            приблизить, свайп в сторону — листать, свайп вниз — закрыть.
          </p>
        </div>
      </div>

      {/* Thumbnail grid */}
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        <div className="grid grid-cols-2 gap-3">
          {DEMO_THUMBS.map((item, i) => (
            <button
              key={i}
              type="button"
              onClick={() => openViewer(DEMO_ITEMS, i)}
              aria-label={`Открыть ${item.label}`}
              className={cn(
                "relative aspect-square overflow-hidden rounded-2xl",
                "cursor-pointer transition-transform active:scale-95",
                i === 0 && "col-span-2 aspect-[16/10]",
              )}
              style={{ background: `linear-gradient(135deg,${item.from},${item.to})` }}
            >
              <div className="absolute inset-0 bg-black/10" />
              {item.kind === "video" && (
                <span className="absolute inset-0 grid place-items-center">
                  <span className="grid size-12 place-items-center rounded-full bg-black/40 text-white ring-1 ring-white/40 backdrop-blur-sm">
                    <PlayIcon className="size-5 translate-x-0.5" />
                  </span>
                </span>
              )}
              <span className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                {item.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
