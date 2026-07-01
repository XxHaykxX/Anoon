"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type LightboxItem = { kind: "image" | "video"; url: string };

type Pt = { x: number; y: number };

// Полноэкранный просмотр медиа диалога.
// — pinch-zoom + pan для фото (touch + wheel + double-tap);
// — горизонтальный свайп / стрелки между медиа;
// — закрытие: X / Esc / свайп вниз / тап по фону.
export function MediaLightbox({
  items,
  index,
  onClose,
  onIndex,
}: {
  items: LightboxItem[];
  index: number | null;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const open = index !== null && index >= 0 && index < items.length;
  const item = open ? items[index] : null;

  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<Pt>({ x: 0, y: 0 });
  const pointers = useRef<Map<number, Pt>>(new Map());
  const start = useRef<{ dist: number; scale: number; pan: Pt; mid: Pt } | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);

  const reset = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Закрытие со сбросом зума (чтобы следующее открытие было в 1x).
  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const go = useCallback(
    (dir: -1 | 1) => {
      if (index === null) return;
      const next = index + dir;
      if (next < 0 || next >= items.length) return;
      reset();
      onIndex(next);
    },
    [index, items.length, onIndex, reset],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, go]);

  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      start.current = { dist: dist(pts[0], pts[1]), scale, pan, mid: mid(pts[0], pts[1]) };
      swipe.current = null;
    } else if (pts.length === 1) {
      swipe.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];

    if (pts.length === 2 && start.current) {
      // Пинч: масштаб от изменения расстояния между пальцами.
      const ratio = dist(pts[0], pts[1]) / (start.current.dist || 1);
      const next = Math.min(4, Math.max(1, start.current.scale * ratio));
      setScale(next);
      if (next === 1) setPan({ x: 0, y: 0 });
      return;
    }

    if (pts.length === 1 && swipe.current) {
      const dx = e.clientX - swipe.current.x;
      const dy = e.clientY - swipe.current.y;
      if (scale > 1) {
        // Панорама увеличенного фото.
        setPan((p) => ({ x: p.x + e.movementX, y: p.y + e.movementY }));
        void dx;
        void dy;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = swipe.current;
    pointers.current.delete(e.pointerId);
    if (start.current && pointers.current.size < 2) start.current = null;

    if (s && scale === 1 && pointers.current.size === 0) {
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dy) > 120 && Math.abs(dy) > Math.abs(dx)) {
        close();
      } else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        go(dx < 0 ? 1 : -1);
      }
    }
    swipe.current = null;
  };

  const onDoubleTap = () => {
    setScale((s) => (s > 1 ? 1 : 2.5));
    setPan({ x: 0, y: 0 });
  };
  const onTapMedia = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) onDoubleTap();
    lastTap.current = now;
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!item || item.kind !== "image") return;
    const next = Math.min(4, Math.max(1, scale - e.deltaY * 0.002));
    setScale(next);
    if (next === 1) setPan({ x: 0, y: 0 });
  };

  return (
    <AnimatePresence>
      {open && item && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={close}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр медиа"
        >
          <button
            onClick={close}
            className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-surface-2/80 text-fg backdrop-blur"
            aria-label="Закрыть"
          >
            <X size={22} />
          </button>

          {/* Навигация — только свайп (стрелки убраны). Внизу счётчик 1/N. */}
          {items.length > 1 && (
            <span className="absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-1/2 z-10 -translate-x-1/2 rounded-full bg-surface-2/70 px-3 py-1 font-mono text-xs text-fg backdrop-blur">
              {(index ?? 0) + 1} / {items.length}
            </span>
          )}

          <div
            onClick={(e) => {
              e.stopPropagation();
              onTapMedia();
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            className="flex max-h-full max-w-full touch-none select-none items-center justify-center"
          >
            {item.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.url}
                alt="фото"
                draggable={false}
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
                className="max-h-[85dvh] max-w-full rounded-lg object-contain transition-transform duration-75"
              />
            ) : (
              <video src={item.url} controls autoPlay playsInline className="max-h-[85dvh] max-w-full rounded-lg" />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
