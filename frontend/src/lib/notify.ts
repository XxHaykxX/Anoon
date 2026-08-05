"use client";

/**
 * Local notification feedback — a short sound + vibration pulse for new
 * messages / incoming calls / friend requests (Wave-2 #103). Browser-only.
 *
 * No external asset: the "sound" is a couple of WebAudio beeps synthesized on
 * the fly, so there's nothing to fetch/cache and no autoplay-blocked <audio>
 * element to babysit. Everything is best-effort and never throws — a missing
 * WebAudio/Vibration API (unsupported browser, autoplay policy, etc.) just
 * means silently no feedback, not a broken app.
 *
 * Respects a single persisted on/off toggle (localStorage `anoon:notify:sound`)
 * — the canonical MVP shape: one combined "Звук и вибрация" switch in
 * Settings (`AnoonSettings.tsx`), read/written via {@link isNotifySoundEnabled}
 * / {@link setNotifySoundEnabled}. Sound and vibration both follow this one
 * flag; there's no separate per-channel toggle.
 */

const STORAGE_KEY = "anoon:notify:sound";

/** Whether sound/vibration feedback is enabled. Defaults to on. */
export function isNotifySoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === null ? true : v === "1";
}

/** Persist the on/off toggle (the Settings "Звук и вибрация" switch). */
export function setNotifySoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

export type NotifKind = "message" | "call" | "request";

/** Distinct vibration patterns (ms on/off) so the kind is felt, not just heard. */
const VIBRATE_PATTERNS: Record<NotifKind, number[]> = {
  message: [30],
  call: [300, 200, 300, 200],
  request: [20, 40, 20, 40, 20],
};

/** Distinct beep frequencies (Hz) per kind — short, unobtrusive, synthesized. */
const TONES: Record<NotifKind, number> = {
  message: 720,
  call: 880,
  request: 600,
};

let audioCtx: AudioContext | null = null;

/** Lazily create (and reuse) the one AudioContext, browser-only. */
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  return audioCtx;
}

/** Play one synthesized beep at `freq`, `startAt` seconds from now. */
function beep(freq: number, startAt = 0, durationSec = 0.18): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  // Browsers suspend a freshly-created context until a user gesture; resume
  // is a no-op if it's already running.
  if (ctx.state === "suspended") void ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + startAt;
  // Short attack/decay envelope so it reads as a soft "ping", not a click.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durationSec + 0.02);
}

/**
 * Play a short notification sound for `kind`. Respects
 * {@link isNotifySoundEnabled}; best-effort — never throws (unsupported
 * browser, blocked autoplay, etc.).
 */
export function playNotifSound(kind: NotifKind): void {
  if (typeof window === "undefined" || !isNotifySoundEnabled()) return;
  try {
    if (kind === "call") {
      // Two quick pips, closer to an actual ringtone than a single ping.
      beep(TONES.call, 0);
      beep(TONES.call, 0.28);
    } else {
      beep(TONES[kind]);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Vibrate with a pattern (ms on/off, or a single duration). Respects
 * {@link isNotifySoundEnabled}; guarded for unsupported browsers, never throws.
 */
export function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined" || !isNotifySoundEnabled()) return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* best-effort */
  }
}

/** Cancel any in-flight vibration (e.g. when stopping a call ring). */
function stopVibrate(): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(0);
    } catch {
      /* best-effort */
    }
  }
}

/** One-shot sound + vibrate for a new message or friend request. */
export function notifyOnce(kind: Exclude<NotifKind, "call">): void {
  playNotifSound(kind);
  vibrate(VIBRATE_PATTERNS[kind]);
}

/* ------------------------------ call ring ------------------------------ */
/* An incoming call rings until answered/declined/hung up — a single beep    */
/* isn't enough, so this repeats the "call" sound+vibrate on an interval     */
/* until explicitly stopped.                                                 */

let ringTimer: ReturnType<typeof setInterval> | null = null;

const RING_PERIOD_MS = 2200;

/** Start the repeating incoming-call ring. Idempotent — a no-op while already ringing. */
export function startRing(): void {
  if (ringTimer) return;
  const ringOnce = () => {
    playNotifSound("call");
    vibrate(VIBRATE_PATTERNS.call);
  };
  ringOnce();
  ringTimer = setInterval(ringOnce, RING_PERIOD_MS);
}

/** Stop the ring. Safe to call unconditionally on every call-teardown path. */
export function stopRing(): void {
  if (ringTimer) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
  stopVibrate();
}
