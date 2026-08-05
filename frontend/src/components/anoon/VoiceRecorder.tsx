"use client";

import * as React from "react";
import { MicIcon, CloseIcon, SendIcon } from "@/components/icons";

export interface VoiceRecorderProps {
  /** Called once recording is stopped (not cancelled) with the recorded file and its duration in seconds. */
  onRecorded: (file: File, durationSec: number) => void;
  /** Called when the recording is discarded (explicit cancel, or a getUserMedia failure). */
  onCancel?: () => void;
  /** Fired whenever recording starts/stops so the parent composer can hide its other
   *  controls and give this bar the full row while recording (BUG-37). */
  onRecordingChange?: (recording: boolean) => void;
  disabled?: boolean;
}

/** Preferred container/codec combos, checked in order via `MediaRecorder.isTypeSupported`. */
const CANDIDATE_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"] as const;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  return CANDIDATE_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("mp4")) return "mp4";
  return "webm";
}

function formatElapsed(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Push-to-record voice-message control built on the browser `MediaRecorder`
 * API. Tap the mic to start; while recording, a live M:SS timer and pulsing
 * dot show, with a send button (finish → `onRecorded`) and a cancel button
 * (discard → `onCancel`). No external libs.
 *
 * Usage:
 * ```tsx
 * <VoiceRecorder onRecorded={(file, dur) => sendVoice(file, dur)} onCancel={() => {}} />
 * ```
 */
export default function VoiceRecorder({
  onRecorded,
  onCancel,
  onRecordingChange,
  disabled,
}: VoiceRecorderProps) {
  const [recording, setRecording] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  // Let the parent composer react to record start/stop (hide siblings, BUG-37).
  React.useEffect(() => {
    onRecordingChange?.(recording);
  }, [recording, onRecordingChange]);

  const streamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const startedAtRef = React.useRef(0);
  const timerRef = React.useRef<number | null>(null);

  const stopTimer = React.useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const releaseStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Belt-and-braces: never leave the mic open if the component unmounts mid-recording.
  React.useEffect(() => {
    return () => {
      stopTimer();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      releaseStream();
    };
  }, [stopTimer, releaseStream]);

  const start = React.useCallback(async () => {
    if (disabled || recording) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      recorderRef.current = recorder;

      startedAtRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      stopTimer();
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
    } catch {
      setError("Нет доступа к микрофону");
      releaseStream();
      onCancel?.();
    }
  }, [disabled, recording, onCancel, releaseStream, stopTimer]);

  const finish = React.useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    const mimeType = recorder.mimeType || "audio/webm";
    const durationSec = Math.max(0, (Date.now() - startedAtRef.current) / 1000);

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const file = new File([blob], `voice-${Date.now()}.${extensionFor(mimeType)}`, {
        type: mimeType,
      });
      releaseStream();
      stopTimer();
      setRecording(false);
      chunksRef.current = [];
      onRecorded(file, Math.round(durationSec));
    };
    recorder.stop();
  }, [onRecorded, releaseStream, stopTimer]);

  const cancel = React.useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    releaseStream();
    stopTimer();
    setRecording(false);
    chunksRef.current = [];
    onCancel?.();
  }, [onCancel, releaseStream, stopTimer]);

  if (!recording) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          aria-label="Записать голосовое сообщение"
          className={
            disabled
              ? "grid size-6 shrink-0 cursor-not-allowed place-items-center text-muted-foreground/40"
              : "grid size-6 shrink-0 cursor-pointer place-items-center text-muted-foreground transition-transform active:scale-95"
          }
        >
          <MicIcon className="size-6" />
        </button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-muted px-2 py-1.5">
      <button
        type="button"
        onClick={cancel}
        aria-label="Отменить запись"
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-transform active:scale-95"
      >
        <CloseIcon className="size-4" />
      </button>

      <span className="flex flex-1 items-center gap-1.5 px-0.5 text-xs text-foreground">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-destructive motion-safe:animate-pulse"
        />
        <span className="tabular-nums">{formatElapsed(elapsed)}</span>
      </span>

      <button
        type="button"
        onClick={finish}
        aria-label="Отправить голосовое сообщение"
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
      >
        <SendIcon className="size-4" />
      </button>
    </div>
  );
}
