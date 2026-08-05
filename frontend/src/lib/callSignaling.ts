/**
 * WebRTC call-signaling plumbing riding the same companion event WebSocket
 * as roulette/friend events (see `./companion.ts`). This module owns only the
 * signaling *frames* — offer/answer/ICE/hangup — not the RTCPeerConnection
 * itself (that's for the chat-UI/call-UI layer other agents build).
 *
 * Frames are sent with {@link CompanionClient.sendRaw} and observed with
 * {@link CompanionClient.onFrame}, which fans out every parsed WS frame
 * regardless of shape — `call:*` types simply aren't part of the fixed
 * `CompanionEvent` union that `onEvent` dispatches.
 */
import { getCompanionClient } from "./companion";

/** A WebRTC call-signaling frame exchanged over the companion event socket. */
export interface CallFrame {
  type: "call:offer" | "call:answer" | "call:ice" | "call:hangup" | "call:unavailable";
  /** Peer hashId (server-stamped on inbound). */
  from?: string;
  /** Peer hashId (set on outbound). */
  to?: string;
  callId: string;
  media?: "audio" | "video";
  /** RTCSessionDescriptionInit. */
  sdp?: unknown;
  /** RTCIceCandidateInit. */
  candidate?: unknown;
  reason?: string;
}

/** Send a call-signaling frame over the companion WS. No-op if not connected. */
export function sendCall(frame: CallFrame): void {
  getCompanionClient().sendRaw(frame);
}

/**
 * Bounded, short-lived buffer of recently-received ICE candidate frames, so a
 * CallScreen that mounts LATE still gets the candidates that arrived before it
 * was listening (BUG-16). This is the callee's problem: the caller trickles ICE
 * the instant it has an offer, but the callee's CallScreen — and its `onCall`
 * listener — only mounts AFTER the user taps accept. Those early candidates used
 * to be dropped, so the first call often failed to connect while a retry
 * "worked" by luck of timing. We replay buffered candidates to every new
 * subscriber; CallScreen filters by `callId`, so cross-call leakage can't occur,
 * and re-adding a duplicate candidate is a harmless no-op.
 *
 * Only `call:ice` is buffered — offer/answer/hangup/unavailable are handled by
 * the always-mounted AnoonApp overlay listener, so they never fall in this gap.
 */
interface BufferedIce {
  frame: CallFrame;
  at: number;
}
const iceBuffer: BufferedIce[] = [];
const ICE_BUFFER_TTL_MS = 20_000;
const ICE_BUFFER_MAX = 256;
let iceTapUnsub: (() => void) | null = null;

/** Drop buffered candidates older than the TTL (called on every buffer touch). */
function pruneIceBuffer(now: number): void {
  while (iceBuffer.length && now - iceBuffer[0]!.at > ICE_BUFFER_TTL_MS) iceBuffer.shift();
  while (iceBuffer.length > ICE_BUFFER_MAX) iceBuffer.shift();
}

/**
 * Attach a single always-on tap that records inbound `call:ice` frames into
 * {@link iceBuffer}. Lazily installed on the first {@link onCall} subscription
 * (AnoonApp's overlay listener, up from app start) so buffering is live before
 * any ringing begins.
 */
function ensureIceTap(): void {
  if (iceTapUnsub) return;
  iceTapUnsub = getCompanionClient().onFrame((frame) => {
    if (frame && typeof frame === "object" && frame.type === "call:ice") {
      const now = Date.now();
      iceBuffer.push({ frame: frame as CallFrame, at: now });
      pruneIceBuffer(now);
    }
  });
}

/**
 * Subscribe to inbound call-signaling frames (`call:*` only). Returns an
 * unsubscribe fn. On subscribe, recently-buffered ICE candidates are replayed
 * to the new listener (see {@link iceBuffer}) so a late-mounting CallScreen
 * doesn't miss candidates trickled during ringing.
 */
export function onCall(cb: (f: CallFrame) => void): () => void {
  ensureIceTap();
  const unsub = getCompanionClient().onFrame((frame) => {
    if (
      frame &&
      typeof frame === "object" &&
      typeof frame.type === "string" &&
      frame.type.startsWith("call:")
    ) {
      cb(frame as CallFrame);
    }
  });
  // Replay any still-fresh buffered candidates to this new subscriber. Live
  // frames continue to arrive via `unsub` above; a buffered frame was received
  // before this subscription existed, so it's delivered here exactly once.
  const now = Date.now();
  pruneIceBuffer(now);
  for (const b of iceBuffer) {
    if (now - b.at <= ICE_BUFFER_TTL_MS) cb(b.frame);
  }
  return unsub;
}
