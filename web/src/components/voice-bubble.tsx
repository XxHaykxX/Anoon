"use client";

import { Loader2, MicOff, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const BAR_COUNT = 28;
// Фолбэк-паттерн, если реальный аудио декодировать нельзя (входящее без файла).
const FALLBACK = Array.from({ length: BAR_COUNT }, (_, i) => 0.35 + 0.5 * Math.abs(Math.sin(i * 1.1)));
const SPEEDS = [1, 1.5, 2] as const;

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

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

// Голосовое в стиле Telegram: круглая amber-кнопка play/pause, waveform с amber-прогрессом,
// drag/tap-seek, таймер справа (идёт от 0:00 при игре → полная длительность в покое),
// точка «не прослушано» для входящих, переключатель скорости 1x/1.5x/2x.
export function VoiceBubble({ url, durationSec, mine, stale }: { url?: string; durationSec?: number; mine: boolean; stale?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barsRef = useRef<HTMLButtonElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [curSec, setCurSec] = useState(0);
  const [peaks, setPeaks] = useState<number[]>(FALLBACK);
  const [heard, setHeard] = useState(false); // локально: прослушано ли (снимает точку «не прослушано»)
  const [speedIdx, setSpeedIdx] = useState(0);

  useEffect(() => {
    if (!url) return;
    const a = new Audio(url);
    audioRef.current = a;
    const onTime = () => {
      setCurSec(a.currentTime);
      setProgress(a.duration && isFinite(a.duration) ? a.currentTime / a.duration : 0);
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
      setCurSec(0);
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
      a.playbackRate = SPEEDS[speedIdx];
      void a.play();
      setPlaying(true);
      setHeard(true);
    }
  };

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  };

  // Seek по позиции X (tap + drag): доля дорожки → currentTime.
  const seekTo = (clientX: number) => {
    const a = audioRef.current;
    const el = barsRef.current;
    if (!a || !el || !a.duration || !isFinite(a.duration)) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    a.currentTime = ratio * a.duration;
    setProgress(ratio);
    setCurSec(a.currentTime);
  };

  const dur = durationSec ?? 0;
  const activeBar = progress * BAR_COUNT;
  const showElapsed = playing || progress > 0;

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
        "flex max-w-[78%] items-center gap-2.5 rounded-2xl px-2.5 py-2 text-sm",
        mine ? "rounded-br-md bg-accent text-accent-fg" : "rounded-bl-md bg-surface-2 text-fg",
      )}
    >
      {/* Круглая кнопка play/pause — амбер-акцент. На своём (amber) пузыре — тёмный круг с amber-иконкой. */}
      <button
        onClick={toggle}
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95",
          mine ? "bg-accent-fg text-accent" : "bg-accent text-accent-fg",
        )}
        aria-label={playing ? "Пауза" : "Воспроизвести"}
      >
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="translate-x-[1px]" />}
      </button>

      {/* Waveform + seek. Кнопка h-11 (тач-цель ≥44px), столбики визуально ниже и центрированы. */}
      <button
        ref={barsRef}
        onPointerDown={(e) => {
          barsRef.current?.setPointerCapture(e.pointerId);
          seekTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seekTo(e.clientX);
        }}
        className="flex h-11 flex-1 items-center gap-0.5 touch-none"
        aria-label="Перемотать"
      >
        {peaks.map((h, i) => (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-full transition-colors",
              i <= activeBar
                ? mine ? "bg-accent-fg" : "bg-accent"
                : mine ? "bg-accent-fg/30" : "bg-fg/25",
            )}
            style={{ height: `${Math.round(h * 60)}%` }}
          />
        ))}
      </button>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="flex items-center gap-1.5 font-mono text-xs tabular-nums opacity-80">
          {/* Точка «не прослушано» — только для входящих, пока не запустили. */}
          {!mine && !heard ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="не прослушано" /> : null}
          {fmt(showElapsed ? curSec : dur)}
        </span>
        {/* Скорость появляется во время/после проигрывания (как в TG). */}
        {showElapsed ? (
          <button
            onClick={cycleSpeed}
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums transition",
              mine ? "bg-accent-fg/15 text-accent-fg" : "bg-fg/10 text-fg-secondary",
            )}
            aria-label={`Скорость ${SPEEDS[speedIdx]}x`}
          >
            {SPEEDS[speedIdx]}x
          </button>
        ) : null}
      </div>
    </div>
  );
}
