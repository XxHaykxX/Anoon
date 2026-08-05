/**
 * Root anoon store — combines every slice into a single zustand store.
 *
 * Usage (once wired into UI):
 *   const user = useAnoonStore((s) => s.user);
 *   const joinQueue = useAnoonStore((s) => s.joinQueue);
 *
 * SCAFFOLD: created but not yet consumed by any screen (screens still use mocks).
 */
import { create } from "zustand";
import type { AnoonStore } from "./types";
import {
  createAnonChatSlice,
  createChatSlice,
  createFriendsSlice,
  createNotificationsSlice,
  createRouletteSlice,
  createSessionSlice,
  createWalletSlice,
} from "./slices";

export const useAnoonStore = create<AnoonStore>()((...a) => ({
  ...createSessionSlice(...a),
  ...createFriendsSlice(...a),
  ...createChatSlice(...a),
  ...createAnonChatSlice(...a),
  ...createRouletteSlice(...a),
  ...createNotificationsSlice(...a),
  ...createWalletSlice(...a),
}));

export type { AnoonStore } from "./types";
export * from "./sliceModels";
