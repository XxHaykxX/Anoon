"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AnoonAvatar } from "@/components/anoon/_shared";
import { createPeerConnection } from "@/lib/tinode";
import { sendCall, onCall } from "@/lib/callSignaling";
import { MicIcon, VideoIcon, PhoneIcon } from "@/components/icons";

export interface CallScreenProps {
  callId: string;
  peerId: string;
  peerName: string;
  media: "audio" | "video";
  role: "caller" | "callee";
  /** Callee only: the SDP offer that arrived alongside the incoming-call frame. */
  initialOffer?: unknown;
  onEnded: () => void;
}

type IconProps = React.SVGProps<SVGSVGElement>;
const iconBase = (p: IconProps) => ({
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

/** Mic-off glyph (icons.tsx has no "off" state variant). */
const MicOffIcon = (p: IconProps) => (
  <svg {...iconBase(p)}>
    <path d="M9 9V5a3 3 0 0 1 6 0v4" />
    <path d="M6 11a6 6 0 0 0 8.6 5.4M18 11a6 6 0 0 1-1.2 3.6" />
    <path d="M12 17v4M3 3l18 18" />
  </svg>
);

/** Camera-off glyph (icons.tsx has no "off" state variant). */
const VideoOffIcon = (p: IconProps) => (
  <svg {...iconBase(p)}>
    <path d="M15 10V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h5" />
    <path d="m15 10 6-3v10l-6-3" />
    <path d="M3 3l18 18" />
  </svg>
);

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const m = Math.floor(safe / 60).toString().padStart(2, "0");
  const s = Math.floor(safe % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

/** Deterministic avatar tone from the peer id, so it doesn't shift on re-render. */
function toneFor(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return sum % 6;
}

function CallControlButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          "grid size-14 place-items-center rounded-full transition-transform active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
          active ? "bg-primary text-primary-foreground" : "bg-white/10 text-white",
        )}
      >
        {children}
      </button>
      <span className="text-xs text-white/70">{label}</span>
    </div>
  );
}

/**
 * Full-screen in-call overlay for both caller and callee, once a call has been
 * initiated (ringing → connected). Owns the whole RTCPeerConnection lifecycle.
 *
 * Usage:
 *   Caller:  <CallScreen callId={id} peerId={peer} peerName={name} media="video" role="caller" onEnded={close} />
 *   Callee:  <CallScreen callId={id} peerId={peer} peerName={name} media={media} role="callee" initialOffer={offer} onEnded={close} />
 */
export default function CallScreen({
  callId,
  peerId,
  peerName,
  media,
  role,
  initialOffer,
  onEnded,
}: CallScreenProps) {
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [connected, setConnected] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);
  /** Non-fatal media notice (camera denied/missing → fell back to audio-only). */
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  /** Whether a local video track actually exists (false after an audio-only fallback). */
  const [hasVideo, setHasVideo] = useState(media === "video");

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerIdRef = useRef<number | null>(null);
  const pendingCandidatesRef = useRef<unknown[]>([]);
  const cleanupRef = useRef<() => void>(() => {});
  // Ends the call, optionally relaying a hangup to the peer first. Set from the
  // effect; used by the hang-up button too. Routing every local end (failure,
  // ICE loss, manual hangup) through here is what keeps BOTH sides in sync —
  // previously a failed/dropped call tore down locally without telling the peer,
  // so the peer's call kept ringing/running (BUG-16 desync).
  const finishRef = useRef<(notifyPeer: boolean) => void>(() => {});

  // Latest onEnded, read from long-lived callbacks (effect intentionally runs
  // once per call so it never re-subscribes mid-call on a prop identity churn).
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  // Auto-dismiss the one-off media-fallback notice after a few seconds.
  useEffect(() => {
    if (!mediaNotice) return;
    const t = window.setTimeout(() => setMediaNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [mediaNotice]);

  useEffect(() => {
    // Guard rail — this effect only touches browser APIs, but keep it explicit
    // in case something renders this server-side.
    if (typeof window === "undefined") return;

    let disposed = false;
    const pc = createPeerConnection();
    pcRef.current = pc;
    const remoteStream = new MediaStream();

    const attachRemoteStream = () => {
      if (media === "video" && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendCall({ type: "call:ice", to: peerId, callId, candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
      attachRemoteStream();
    };

    pc.onconnectionstatechange = () => {
      if (disposed) return;
      if (pc.connectionState === "connected") {
        setConnected(true);
        if (timerIdRef.current == null) {
          timerIdRef.current = window.setInterval(() => {
            setElapsed((s) => s + 1);
          }, 1000);
        }
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        // "disconnected" is deliberately NOT terminal — it's frequently a
        // transient ICE blip that recovers on its own; tearing down on it was a
        // cause of the flaky first call (BUG-16). Only "failed"/"closed" end it.
        setFailed(true);
        finish(true);
      }
    };

    const flushPendingCandidates = async () => {
      const queue = pendingCandidatesRef.current;
      pendingCandidatesRef.current = [];
      for (const c of queue) {
        try {
          await pc.addIceCandidate(c as RTCIceCandidateInit);
        } catch {
          // Best-effort — a stale/duplicate candidate is not fatal.
        }
      }
    };

    const unsub = onCall((frame) => {
      if (frame.callId !== callId) return;
      if (frame.type === "call:answer" && role === "caller" && frame.sdp) {
        void pc
          .setRemoteDescription(frame.sdp as RTCSessionDescriptionInit)
          .then(flushPendingCandidates);
      } else if (frame.type === "call:ice" && frame.candidate) {
        if (pc.remoteDescription) {
          void pc.addIceCandidate(frame.candidate as RTCIceCandidateInit).catch(() => {});
        } else {
          pendingCandidatesRef.current.push(frame.candidate);
        }
      } else if (frame.type === "call:hangup" || frame.type === "call:unavailable") {
        // Peer ended it — tear down locally WITHOUT echoing a hangup back
        // (that would ping-pong).
        setFailed(true);
        finish(false);
      }
    });

    // Pending "show why the call died, then end" timer (see failWithNotice).
    let noticeTimer: number | null = null;

    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      if (noticeTimer != null) {
        window.clearTimeout(noticeTimer);
        noticeTimer = null;
      }
      if (timerIdRef.current != null) {
        window.clearInterval(timerIdRef.current);
        timerIdRef.current = null;
      }
      unsub();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      try {
        pc.close();
      } catch {
        // Already closed.
      }
      if (pcRef.current === pc) pcRef.current = null;
    };
    cleanupRef.current = cleanup;

    // Single end path for the whole call. `notifyPeer` relays a hangup so the
    // OTHER side tears down too (BUG-16) — pass false only when we're reacting
    // to the peer's own hangup (else we'd bounce it straight back).
    const finish = (notifyPeer: boolean) => {
      if (disposed) return;
      if (notifyPeer) sendCall({ type: "call:hangup", to: peerId, callId });
      cleanup();
      onEndedRef.current();
    };
    finishRef.current = finish;

    // Media acquisition fails for reasons the user has to SEE — mic/camera
    // permission denied, or no device at all. Tearing the overlay down the
    // instant getUserMedia rejects (what we used to do) is indistinguishable
    // from "calls are broken": the caller's screen blinks away, and since no
    // offer was ever sent the peer never rings either. Show the reason, then
    // end. The peer is told regardless — finish(true) relays the hangup.
    const failWithNotice = (text: string) => {
      if (disposed) return;
      setFailed(true);
      setMediaNotice(text);
      noticeTimer = window.setTimeout(() => {
        noticeTimer = null;
        finish(true);
      }, 2500);
    };

    const start = async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: media === "video",
        });
      } catch {
        // Camera denied/missing — degrade to audio-only instead of failing the
        // whole call outright. A plain audio call with no camera to fall back
        // to still can't proceed.
        if (media !== "video") {
          failWithNotice("Нет доступа к микрофону — разрешите его в настройках браузера");
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          setCameraOff(true);
          setHasVideo(false);
          setMediaNotice("Камера недоступна — звонок продолжится без видео");
        } catch {
          failWithNotice("Нет доступа к камере и микрофону — разрешите их в настройках браузера");
          return;
        }
      }
      try {
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        if (media === "video" && localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        if (role === "caller") {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendCall({ type: "call:offer", to: peerId, callId, media, sdp: offer });
        } else if (initialOffer) {
          await pc.setRemoteDescription(initialOffer as RTCSessionDescriptionInit);
          await flushPendingCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendCall({ type: "call:answer", to: peerId, callId, media, sdp: answer });
        }
      } catch {
        setFailed(true);
        finish(true);
      }
    };
    void start();

    return () => {
      cleanup();
    };
    // Intentionally run once per mounted call — callId identifies the call for
    // this component's whole lifetime; the parent should key on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, peerId, media, role, initialOffer]);

  const hangUp = useCallback(() => {
    // Route through the effect's finish() so the peer gets a hangup and both
    // sides tear down together (BUG-16). Fall back to a direct teardown if the
    // effect hasn't wired finish yet (shouldn't happen — button renders after).
    if (finishRef.current) finishRef.current(true);
    else {
      sendCall({ type: "call:hangup", to: peerId, callId });
      cleanupRef.current();
      onEndedRef.current();
    }
  }, [peerId, callId]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStreamRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
      return next;
    });
  }, []);

  const toggleCamera = useCallback(() => {
    setCameraOff((prev) => {
      const next = !prev;
      localStreamRef.current?.getVideoTracks().forEach((t) => {
        t.enabled = !next;
      });
      return next;
    });
  }, []);

  const initials = useMemo(() => getInitials(peerName), [peerName]);
  const tone = useMemo(() => toneFor(peerId), [peerId]);
  const statusLabel = failed
    ? "Звонок завершён"
    : connected
      ? formatDuration(elapsed)
      : role === "caller"
        ? "Вызов…"
        : "Соединение…";

  return (
    // `absolute`, not `fixed`: the whole app renders inside a fixed-size phone
    // frame (see AnoonApp), so a viewport-fixed overlay would break out of it.
    <div className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-neutral-950 text-white animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      {mediaNotice && (
        <div className="absolute left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-10 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-center text-xs text-white/90 shadow-lg">
          {mediaNotice}
        </div>
      )}
      <div className="relative flex-1 overflow-hidden">
        {media === "video" ? (
          <>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="absolute inset-0 h-full w-full bg-neutral-900 object-cover"
            />
            {!connected && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/70">
                <AnoonAvatar initials={initials} tone={tone} size={96} className="shadow-xl" />
                <p className="text-lg font-semibold">{peerName}</p>
                <p className="text-sm text-white/60">{statusLabel}</p>
              </div>
            )}

            {/* Local self-view PIP — muted (own audio must not echo back) and mirrored. */}
            <div className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] h-32 w-24 overflow-hidden rounded-2xl border border-white/15 bg-neutral-800 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className={cn("h-full w-full scale-x-[-1] object-cover", cameraOff && "opacity-0")}
              />
              {cameraOff && (
                <div className="absolute inset-0 grid place-items-center text-center text-[11px] leading-tight text-white/60">
                  Камера
                  <br />
                  выкл.
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6">
            <span className="relative flex items-center justify-center">
              {!connected && (
                <span className="absolute size-40 rounded-full bg-primary/15 [animation-duration:2s] animate-ping motion-reduce:animate-none" />
              )}
              <AnoonAvatar initials={initials} tone={tone} size={128} className="relative shadow-xl" />
            </span>
            <div className="flex flex-col items-center gap-1">
              <p className="text-xl font-semibold">{peerName}</p>
              <p className="text-sm text-white/60">{statusLabel}</p>
            </div>
            {/* Remote audio sink — no visual, the avatar above is the UI. */}
            <audio ref={remoteAudioRef} autoPlay />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-end justify-center gap-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-6">
        <CallControlButton label={muted ? "Микрофон выкл." : "Микрофон"} active={muted} onClick={toggleMute}>
          {muted ? <MicOffIcon className="size-6" /> : <MicIcon className="size-6" />}
        </CallControlButton>

        {media === "video" && hasVideo && (
          <CallControlButton
            label={cameraOff ? "Камера выкл." : "Камера"}
            active={cameraOff}
            onClick={toggleCamera}
          >
            {cameraOff ? <VideoOffIcon className="size-6" /> : <VideoIcon className="size-6" />}
          </CallControlButton>
        )}

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            aria-label="Завершить звонок"
            onClick={hangUp}
            className="grid size-14 place-items-center rounded-full bg-destructive text-white transition-transform active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <PhoneIcon className="size-6 rotate-[135deg]" />
          </button>
          <span className="text-xs text-white/70">Завершить</span>
        </div>
      </div>
    </div>
  );
}
