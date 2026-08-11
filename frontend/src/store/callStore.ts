"use client";

/**
 * FROZEN CONTRACT (Wave-2 #81). Standalone zustand store for the WebRTC call
 * lifecycle, kept OUT of the main anoon store slices so the chat-features agent
 * (owns slices.ts) and the calls agent (owns this file + the overlay) never
 * touch the same file.
 *
 * - Chat screens call `useCallStore.getState().startCall(peerHashId, peerName, media)`
 *   from the header call buttons. That is the ONLY coupling the chat side needs.
 * - The global overlay (AnoonApp) subscribes to `call` and renders CallScreen /
 *   IncomingCall, driving the RTCPeerConnection + callSignaling frames.
 *
 * The one dependency on the main store is one-way and lives in `endCall`: a
 * finished call is recorded in the conversation via `logCall` (slices.ts).
 * Nothing in the main store imports this file, so there is no cycle.
 *
 * Teardown of the actual RTCPeerConnection/media tracks lives in CallScreen's
 * own unmount cleanup (see its effect) — `endCall` just clears the state that
 * keeps CallScreen mounted, which is what triggers that cleanup from the overlay.
 */
import { create } from "zustand";
import { useAnoonStore } from "@/store";
import type { CallLogRecord } from "./types";

export type CallMedia = "audio" | "video";
export type CallStatus = "idle" | "outgoing" | "incoming" | "active" | "ended";

/**
 * Why a call ended, when it never reached "connected". Passed to
 * {@link CallStore.endCall} by whoever observed the end: the ringing screen
 * (AnoonApp) or the in-call screen (CallScreen, which reads it off the peer's
 * `call:hangup`/`call:unavailable` frame). `undefined` = we ended it ourselves.
 */
export type CallEndReason = "declined" | "unavailable" | "missed" | "busy";

export interface CallState {
  status: CallStatus;
  /**
   * Signaling handle of the other party — whatever companion will resolve back
   * to them. A real #ID ("#00012") in a friend or revealed chat, a per-match
   * anon alias ("~K7X2QM") inside a roulette chat, which is all the client has
   * before a mutual reveal. Opaque here: it is echoed into `to` on outbound
   * frames and rendered as-is; nothing may treat it as an account id.
   */
  peerHashId: string;
  peerName: string;
  callId: string;
  media: CallMedia;
  /** Present only for an incoming call: the caller's SDP offer. */
  incomingOffer?: RTCSessionDescriptionInit;
  /**
   * Unix ms when the RTCPeerConnection actually reached "connected", else null.
   * This — not "the callee tapped accept" — is what makes a call *состоявшимся*
   * and is the only source for its duration (see {@link CallStore.markConnected}).
   */
  connectedAt: number | null;
}

export interface CallStore {
  call: CallState | null;
  /** Start an outgoing call to a peer (from a chat header button). */
  startCall: (peerHashId: string, peerName: string, media: CallMedia) => void;
  /** Register an inbound offer (driven by the onCall listener). */
  receiveIncoming: (call: Omit<CallState, "connectedAt">) => void;
  /** Move the current call to active (offer/answer exchanged). */
  setActive: () => void;
  /** Media is flowing — starts the duration clock (CallScreen). */
  markConnected: () => void;
  /**
   * Tear down / clear the current call AND record it in the conversation with
   * the peer (see {@link CallLogRecord}). Pass `reason` when the call never
   * connected and the end wasn't ours.
   */
  endCall: (reason?: CallEndReason) => void;
}

/**
 * The facts `logCall` needs about the call that just ended. Deliberately NOT a
 * rendered string any more: the record is written into the conversation's topic
 * and read back by BOTH sides, so «Исходящий»/«Входящий» has to be decided by
 * each reader, not baked in here by whoever happened to hang up.
 *
 * `incoming` is read off `incomingOffer`, which is set only by
 * {@link CallStore.receiveIncoming} — the same signal the overlay already uses
 * to pick the caller/callee role.
 */
function callRecordOf(call: CallState, reason: CallEndReason | undefined): CallLogRecord {
  return {
    media: call.media,
    sec: call.connectedAt ? Math.floor((Date.now() - call.connectedAt) / 1000) : 0,
    // A connected call has a duration to show and needs no reason; an
    // unreasoned end before that is one we walked out of ourselves.
    outcome: call.connectedAt ? undefined : reason ?? "cancelled",
    incoming: Boolean(call.incomingOffer),
  };
}

export const useCallStore = create<CallStore>((set, get) => ({
  call: null,
  startCall: (peerHashId, peerName, media) => {
    set({
      call: {
        status: "outgoing",
        peerHashId,
        peerName,
        // Random, not derived. The previous `${peerHashId}:${Date.now()}:${seq}`
        // was guessable by anyone who had ever been matched with this user: the
        // #ID is sequential, the millisecond is a narrow window, and the counter
        // starts at 1 — so a former peer could spray `call:hangup` frames until
        // one matched and drop a call in progress. Collision-safety was the old
        // counter's only job, and a UUID covers that too.
        callId: crypto.randomUUID(),
        media,
        connectedAt: null,
      },
    });
  },
  receiveIncoming: (call) => set({ call: { ...call, connectedAt: null } }),
  setActive: () =>
    set((s) => (s.call ? { call: { ...s.call, status: "active" } } : s)),
  markConnected: () =>
    set((s) => (s.call && !s.call.connectedAt ? { call: { ...s.call, connectedAt: Date.now() } } : s)),
  endCall: (reason) => {
    const call = get().call;
    set({ call: null });
    // Leave the trace in the conversation the call belonged to. `logCall` puts
    // it in that conversation's topic, so it outlives this tab (#41).
    if (call) useAnoonStore.getState().logCall(call.peerHashId, callRecordOf(call, reason));
  },
}));
