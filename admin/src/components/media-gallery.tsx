"use client";

import { usePermissions, useUpdate } from "@refinedev/core";
import { motion } from "framer-motion";
import { Eye, Film, ImageOff, Lock, Mic, Play, ShieldAlert, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import Lightbox, { type GenericSlide, type Slide } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

import "yet-another-react-lightbox/styles.css";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import type { MediaAssetRow } from "@/data/fixtures";
import { addAction } from "@/lib/audit";
import { cn } from "@/lib/utils";

// Видеоплеер (vidstack) — только на клиенте: web-components + window.
const VideoPlayer = dynamic(() => import("./video-player"), { ssr: false });

// Кастомные типы слайдов лайтбокса: vidstack-видео и голосовые.
declare module "yet-another-react-lightbox" {
  interface SlideTypes {
    "vidstack-video": SlideVidstackVideo;
    "audio-file": SlideAudioFile;
  }
  interface SlideVidstackVideo extends GenericSlide {
    type: "vidstack-video";
    src: string;
    poster?: string;
  }
  interface SlideAudioFile extends GenericSlide {
    type: "audio-file";
    src: string;
  }
}

function isBlocked(m: MediaAssetRow, escalatedIds: Set<string>, deletedIds: Set<string>) {
  return m.deletedAt != null || m.escalated || escalatedIds.has(m.id) || deletedIds.has(m.id);
}

export function MediaGallery({
  media,
  ownerLabel,
  ownerBadge,
  noBlur,
}: {
  media: MediaAssetRow[];
  ownerLabel: string;
  ownerBadge?: string; // #ID владельца — показываем на каждом тайле
  noBlur?: boolean; // показывать сразу, без blur/«Показать» (файл-менеджер)
}) {
  // blur-by-default: показанные тайлы — по клику «Показать», индивидуально.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  // Локально эскалированные в этой сессии (в проде — ModeratorAction на сервере).
  const [escalatedIds, setEscalatedIds] = useState<Set<string>>(new Set());
  // Удалённые прямо сейчас: ответ PATCH уже пришёл, а список (Refine или свой fetch
  // страницы) мог ещё не перечитаться — тайл гасим сразу, не дожидаясь его.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<MediaAssetRow | null>(null);
  const [lightboxAt, setLightboxAt] = useState<number>(-1);

  const { mutate: update } = useUpdate();
  const { data: role } = usePermissions<string>({});
  const canDelete = role === "super_admin";

  // Просматриваемые медиа (не удалённые, не эскалированные) → слайды лайтбокса.
  const viewable = useMemo(
    () => media.filter((m) => !isBlocked(m, escalatedIds, deletedIds)),
    [media, escalatedIds, deletedIds],
  );

  // Слайды строго 1:1 с viewable — индекс из openLightbox ищется по этому же массиву.
  // Поэтому audio тоже даёт слайд (со своим рендером), а не выпадает из списка:
  // иначе стрелки в лайтбоксе открывали бы соседний файл.
  const slides: Slide[] = useMemo(
    () =>
      viewable.map((m) =>
        m.kind === "video"
          ? { type: "vidstack-video" as const, src: m.url, poster: m.poster }
          : m.kind === "audio"
            ? { type: "audio-file" as const, src: m.url }
            : { type: "image" as const, src: m.url, width: m.width, height: m.height },
      ),
    [viewable],
  );

  function reveal(id: string) {
    setRevealed((s) => new Set(s).add(id));
  }

  function escalate(m: MediaAssetRow) {
    setEscalatedIds((s) => new Set(s).add(m.id));
    addAction({
      type: "escalate",
      target: ownerLabel,
      reason: `Медиа ${m.id} передано на эскалацию (противоправный контент)`,
    });
    toast("Передано на эскалацию — элемент заблокирован", "danger");
  }

  // Мягкое удаление: PATCH /api/admin/media/{id} {deleted:true} → companion помечает
  // deleted_at и пишет moderator_actions. Refine инвалидирует ресурс "media", поэтому
  // списки на карточке пользователя и в жалобе перечитываются сами.
  function remove(m: MediaAssetRow) {
    setConfirmDelete(null);
    update(
      { resource: "media", id: m.id, values: { deleted: true } },
      {
        onSuccess: () => {
          setDeletedIds((s) => new Set(s).add(m.id));
          addAction({ type: "escalate", target: ownerLabel, reason: `Медиа ${m.id} удалено модератором` });
          toast("Медиа удалено", "danger");
        },
        // Роль проверяет роут — отказ (403) показываем как есть, а не молча.
        onError: (e: unknown) => toast(e instanceof Error && /403/.test(e.message) ? "Удаление доступно только super_admin" : "Не удалось удалить медиа", "danger"),
      },
    );
  }

  function openLightbox(m: MediaAssetRow) {
    const idx = viewable.findIndex((v) => v.id === m.id);
    if (idx >= 0) setLightboxAt(idx);
  }

  if (media.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-1 p-8 text-center text-sm text-fg-muted">
        Медиа нет
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {media.map((m, i) => {
          const deleted = m.deletedAt != null || deletedIds.has(m.id);
          const escalated = m.escalated || escalatedIds.has(m.id);
          const shown = (noBlur || revealed.has(m.id)) && !deleted && !escalated;

          return (
            <motion.div
              key={m.id}
              data-media-id={m.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut", delay: i * 0.03 }}
              className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-border bg-surface-2"
            >
              {/* #ID владельца — всегда поверх тайла (per-item для общей галереи, иначе общий) */}
              {(m.ownerBadge ?? ownerBadge) ? (
                <span className="pointer-events-none absolute left-1.5 top-1.5 z-20 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[10px] text-white">
                  {m.ownerBadge ?? ownerBadge}
                </span>
              ) : null}

              {/* Плашка: медиа удалено/истекло */}
              {deleted ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-fg-muted">
                  <ImageOff size={22} />
                  <span className="text-xs">Медиа удалено или истекло</span>
                </div>
              ) : escalated ? (
                // Заблокировано эскалацией — НИКАКОГО свободного просмотра.
                <div className="flex h-full flex-col items-center justify-center gap-2 bg-danger/10 p-3 text-center text-danger">
                  <Lock size={22} />
                  <span className="text-xs font-medium">Заблокировано — передано на эскалацию</span>
                </div>
              ) : (
                <>
                  {/* Превью: blur-by-default */}
                  {m.kind === "audio" ? (
                    // У голосового нет кадра — глиф + плеер прямо в тайле (в <img> оно давало битую картинку).
                    <div className="flex h-full flex-col items-center justify-center gap-2 bg-surface-2 px-2 text-fg-muted">
                      <Mic size={22} className="text-accent" />
                      {shown && (
                        <audio src={m.url} controls preload="none" className="w-full max-w-full" />
                      )}
                    </div>
                  ) : m.kind === "video" && m.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.poster}
                      alt=""
                      className={cn("h-full w-full object-cover transition", shown ? "blur-0" : "blur-xl scale-110")}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.url}
                      alt=""
                      className={cn("h-full w-full object-cover transition", shown ? "blur-0" : "blur-xl scale-110")}
                    />
                  )}

                  {/* Оверлей «Показать» пока не раскрыт */}
                  {!shown && (
                    <button
                      onClick={() => reveal(m.id)}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/40 text-fg backdrop-blur-[2px] transition hover:bg-black/30"
                      aria-label="Показать медиа"
                    >
                      <Eye size={20} />
                      <span className="text-xs font-medium">Показать</span>
                    </button>
                  )}

                  {/* Раскрыто — клик открывает лайтбокс. У audio оверлея нет: он перекрыл бы
                      controls плеера, а слушать можно прямо в тайле. */}
                  {shown && m.kind !== "audio" && (
                    <button
                      onClick={() => openLightbox(m)}
                      className="absolute inset-0 flex items-center justify-center bg-black/0 transition hover:bg-black/20"
                      aria-label={m.kind === "video" ? "Открыть видео" : "Открыть фото"}
                    >
                      {m.kind === "video" && (
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-fg">
                          <Play size={20} />
                        </span>
                      )}
                    </button>
                  )}

                  {/* Бейдж типа/CW — сдвинут ниже, если на тайле уже есть бейдж #ID владельца (иначе перекрываются). */}
                  <div
                    className={cn(
                      "pointer-events-none absolute left-2 flex items-center gap-1",
                      (m.ownerBadge ?? ownerBadge) ? "top-8" : "top-2",
                    )}
                  >

                    {m.kind === "video" && (
                      <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-fg">
                        <Film size={11} /> видео
                      </span>
                    )}
                    {m.kind === "audio" && (
                      <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-fg">
                        <Mic size={11} /> голос
                      </span>
                    )}
                    {m.reportReason && (
                      <span className="rounded-full bg-danger/80 px-2 py-0.5 text-[10px] font-medium text-white">
                        по жалобе
                      </span>
                    )}
                  </div>

                  {/* Удаление (мягкое) — деструктивно, поэтому только super_admin и через confirm.
                      Роут проверяет роль сам; здесь кнопку просто не показываем модератору. */}
                  {canDelete && (
                    <button
                      onClick={() => setConfirmDelete(m)}
                      aria-label="Удалить медиа"
                      className="absolute bottom-2 left-2 flex items-center gap-1 rounded-lg bg-black/70 px-2 py-1 text-[10px] font-semibold text-white opacity-0 transition hover:bg-danger/85 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 size={12} /> Удалить
                    </button>
                  )}

                  {/* Кнопка эскалации (CSAM/illegal) — только в режиме модерации (blur). */}
                  <button
                    onClick={() => escalate(m)}
                    className={cn(
                      "absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-danger/85 px-2 py-1 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100",
                      noBlur && "hidden",
                    )}
                    aria-label="Эскалировать элемент"
                  >
                    <ShieldAlert size={12} /> Эскалировать
                  </button>
                </>
              )}
            </motion.div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Удалить медиа?"
        message={`Файл будет помечен удалённым и перестанет открываться (${ownerLabel}). Действие попадёт в журнал модерации.`}
        confirmLabel="Удалить"
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && remove(confirmDelete)}
      />

      <Lightbox
        open={lightboxAt >= 0}
        close={() => setLightboxAt(-1)}
        index={Math.max(0, lightboxAt)}
        slides={slides}
        plugins={[Zoom]}
        controller={{ closeOnBackdropClick: true }}
        styles={{ container: { backgroundColor: "rgba(0,0,0,.92)" } }}
        render={{
          slide: ({ slide }) =>
            slide.type === "vidstack-video" ? (
              <div className="mx-auto w-full max-w-3xl px-4">
                <VideoPlayer src={slide.src} poster={slide.poster} />
              </div>
            ) : slide.type === "audio-file" ? (
              <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-4 text-white">
                <Mic size={40} />
                <audio src={slide.src} controls autoPlay className="w-full" />
              </div>
            ) : undefined,
        }}
      />
    </>
  );
}
