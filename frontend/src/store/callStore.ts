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
 * Teardown of the actual RTCPeerConnection/media tracks lives in CallScreen's
 * own unmount cleanup (see its effect) — `endCall` just clears the state that
 * keeps CallScreen mounted, which is what triggers that cleanup from the overlay.
 */
import { create } from "zustand";

export type CallMedia = "audio" | "video";
export type CallStatus = "idle" | "outgoing" | "incoming" | "active" | "ended";

export interface CallState {
  status: CallStatus;
  /** hashId of the other party, e.g. "#00012". */
  peerHashId: string;
  peerName: string;
  callId: string;
  media: CallMedia;
  /** Present only for an incoming call: the caller's SDP offer. */
  incomingOffer?: RTCSessionDescriptionInit;
}

export interface CallStore {
  call: CallState | null;
  /** Start an outgoing call to a peer (from a chat header button). */
  startCall: (peerHashId: string, peerName: string, media: CallMedia) => void;
  /** Register an inbound offer (driven by the onCall listener). */
  receiveIncoming: (call: CallState) => void;
  /** Move the current call to active (offer/answer exchanged). */
  setActive: () => void;
  /** Tear down / clear the current call. */
  endCall: () => void;
}

/**
 * Monotonic counter mixed into every generated callId, alongside the peer and
 * a timestamp — belt-and-braces so two calls placed to the same peer within
 * the same millisecond (fast retry after a declined call, etc.) never collide.
 */
let callSeq = 0;

export const useCallStore = create<CallStore>((set) => ({
  call: null,
  startCall: (peerHashId, peerName, media) => {
    callSeq += 1;
    set({
      call: {
        status: "outgoing",
        peerHashId,
        peerName,
        callId: `${peerHashId}:${Date.now()}:${callSeq}`,
        media,
      },
    });
  },
  receiveIncoming: (call) => set({ call }),
  setActive: () =>
    set((s) => (s.call ? { call: { ...s.call, status: "active" } } : s)),
  endCall: () => set({ call: null }),
}));
