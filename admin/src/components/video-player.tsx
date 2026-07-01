"use client";

import { MediaOutlet, MediaPlayer } from "@vidstack/react";

import "vidstack/styles/defaults.css";
import "vidstack/styles/community-skin/video.css";

// Видеоплеер ревью-медиа (Этап 3). Безопасный дефолт для модерации:
// БЕЗ автоплея (default paused) + muted (без звука) + preload только метаданных.
// Грузится через next/dynamic(ssr:false) из media-gallery — vidstack регистрирует
// web-components и обращается к window/customElements (несовместимо с SSR-prerender).
export default function VideoPlayer({ src, poster }: { src: string; poster?: string }) {
  return (
    <MediaPlayer
      src={src}
      poster={poster}
      muted
      load="visible"
      playsinline
      crossorigin="anonymous"
      aspectRatio={16 / 9}
      className="w-full overflow-hidden rounded-xl"
    >
      <MediaOutlet />
    </MediaPlayer>
  );
}
