"use client";

import { Loader2, MicOff, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const BAR_COUNT = 28;
// Фолбэк-паттерн, если реальный аудио декодировать нельзя (входящее без файла).
const FALLBACK = Array.from({ length: BAR_COUNT }, (_, i) => 0.35 + 0.5 * Math.abs(Math.sin(i * 1.1)));

// Декод blob → нормализованные пики (0..1) для waveform.
async function decodePeaks(url: string, buckets: number): Promise<number[] | null> {
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const size = Math.floor(data.length / buckets);
    const peaks: number[] = [];
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      for (let j = 0; j < size; j++) {
        const v = Math.abs(data[i * size + j] ?? 0);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    void ctx.close();
    const norm = Math.max(...peaks, 0.01);
    return peaks.map((p) => Math.max(0.12, p / norm));
  } catch {
    return null;
  }
}

// Голосовое: реальное воспроизведение blob + waveform по реальному аудио + seek по клику.
export function VoiceBubble({ url, durationSec, mine, stale }: { url?: string; durationSec?: number; mine: boolean; stale?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barsRef = useRef<HTMLButtonElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [peaks, setPeaks] = useState<number[]>(FALLBACK);

  useEffect(() => {
    if (!url) return;
    const a = new Audio(url);
    audioRef.current = a;
    const onTime = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);

    let alive = true;
    void decodePeaks(url, BAR_COUNT).then((p) => {
      if (alive) setPeaks(p ?? FALLBACK);
    });

    return () => {
      alive = false;
      a.pause();
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
      audioRef.current = null;
    };
  }, [url]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a.play();
      setPlaying(true);
    }
  };

  // Seek по клику/тапу на дорожку: доля X → currentTime.
  const seek = (clientX: number) => {
    const a = audioRef.current;
    const el = barsRef.current;
    if (!a || !el || !a.duration) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    a.currentTime = ratio * a.duration;
    setProgress(ratio);
  };

  const dur = durationSec ?? 0;
  const activeBar = progress * BAR_COUNT;

  // Нет url: грузится (спиннер) или не удалось (stale).
  if (!url) {
    return (
      <div
        className={cn(
          "flex max-w-[78%] items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm text-fg-muted",
          mine ? "rounded-br-md bg-accent/60 text-accent-fg/80" : "rounded-bl-md bg-surface-2",
        )}
      >
        {stale ? (
          <>
            <MicOff size={16} />
            <span className="text-xs">Голос недоступен</span>
          </>
        ) : (
          <>
            <Loader2 size={16} className="animate-spin" />
            <span className="text-xs">Загрузка…</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex max-w-[78%] items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm",
        mine ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md bg-surface-2 text-fg",
      )}
    >
      <button
        onClick={toggle}
        disabled={!url}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-current/15 disabled:opacity-50"
        aria-label={playing ? "Пауза" : "Воспроизвести"}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <button
        ref={barsRef}
        onClick={(e) => seek(e.clientX)}
        disabled={!url}
        className="flex h-6 flex-1 items-center gap-0.5 disabled:cursor-default"
        aria-label="Перемотать"
      >
        {peaks.map((h, i) => (
          <span
            key={i}
            className={cn("flex-1 rounded-full bg-current transition-opacity", i <= activeBar ? "opacity-100" : "opacity-40")}
            style={{ height: `${Math.round(h * 100)}%` }}
          />
        ))}
      </button>
      <span className="font-mono text-xs tabular-nums opacity-80">
        {Math.floor(dur / 60)}:{String(dur % 60).padStart(2, "0")}
      </span>
    </div>
  );
}
