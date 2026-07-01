"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderStatus = "idle" | "recording" | "denied" | "unsupported";

export type RecordedVoice = { url: string; durationSec: number };

// Запись голосового через MediaRecorder. Возвращает object URL + длительность.
// Данные локальные (blob URL) — на сервер не грузим (WS/R2 позже).
export function useVoiceRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsed, setElapsed] = useState(0);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((v: RecordedVoice | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    recRef.current = null;
    chunksRef.current = [];
  }, []);

  // Нормализация громкости в реальном времени: компрессор (выравнивает динамику) + makeup-gain.
  // Выход остаётся opus/webm (MediaRecorder на обработанном стриме) — без пост-транскода,
  // размер маленький. Если Web Audio недоступен — возвращаем сырой стрим (fallback).
  const normalizedStream = useCallback((raw: MediaStream): MediaStream => {
    const Ctx = typeof window !== "undefined" ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!Ctx || typeof (Ctx.prototype as AudioContext).createMediaStreamDestination !== "function") return raw;
    try {
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(raw);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24;
      comp.knee.value = 30;
      comp.ratio.value = 12;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      const makeup = ctx.createGain();
      makeup.gain.value = 1.8; // компенсация после компрессии
      const dest = ctx.createMediaStreamDestination();
      source.connect(comp);
      comp.connect(makeup);
      makeup.connect(dest);
      return dest.stream;
    } catch {
      void audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      return raw;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setStatus("unsupported");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream; // сырой стрим — для остановки треков в cleanup
      chunksRef.current = [];
      const rec = new MediaRecorder(normalizedStream(stream));
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        resolveRef.current?.({ url, durationSec });
        resolveRef.current = null;
        cleanup();
        setStatus("idle");
        setElapsed(0);
      };
      recRef.current = rec;
      startedAtRef.current = Date.now();
      rec.start();
      setStatus("recording");
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      return true;
    } catch {
      setStatus("denied");
      cleanup();
      return false;
    }
  }, [cleanup, normalizedStream]);

  // Стоп записи → Promise с результатом (или null если ничего не записано / отмена).
  const stop = useCallback((): Promise<RecordedVoice | null> => {
    return new Promise((resolve) => {
      const rec = recRef.current;
      if (!rec || rec.state === "inactive") {
        resolve(null);
        return;
      }
      resolveRef.current = resolve;
      rec.stop();
    });
  }, []);

  // Отмена без сохранения.
  const cancel = useCallback(() => {
    const rec = recRef.current;
    resolveRef.current = null;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
    }
    cleanup();
    setStatus("idle");
    setElapsed(0);
  }, [cleanup]);

  return { status, elapsed, start, stop, cancel };
}
