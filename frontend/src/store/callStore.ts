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

export const useCallStore = create<CallStore>((set) => ({
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
      },
    });
  },
  receiveIncoming: (call) => set({ call }),
  setActive: () =>
    set((s) => (s.call ? { call: { ...s.call, status: "active" } } : s)),
  endCall: () => set({ call: null }),
}));
