import { create } from "zustand";

/**
 * Frozen contract for the fullscreen media viewer (lightbox).
 *
 * Replaces the old broken flow where a chat photo tap did
 * `nav.push("media-viewer")` and always landed on the hardcoded
 * DEMO_ITEMS gradient placeholders (BUG-10 / BUG-11 / BUG-12).
 *
 * Producers (chat screens) call `openViewer(items, index)` with the REAL
 * media of the conversation. The consumer (AnoonMediaViewer, mounted once in
 * AnoonApp) renders `items[index]` with a proper backdrop overlay.
 */
export type MediaViewerItem = {
  /** Fully-resolved, authed URL ready for <img>/<video> src. */
  src: string;
  type: "image" | "video";
  /** View-once media is purged from history after this open. */
  viewOnce?: boolean;
  /** Optional caption/sender label. */
  caption?: string;
};

interface MediaViewerState {
  items: MediaViewerItem[];
  index: number;
  open: boolean;
  openViewer: (items: MediaViewerItem[], index: number) => void;
  setIndex: (index: number) => void;
  close: () => void;
}

export const useMediaViewerStore = create<MediaViewerState>((set) => ({
  items: [],
  index: 0,
  open: false,
  openViewer: (items, index) =>
    set({ items, index: Math.max(0, Math.min(index, items.length - 1)), open: true }),
  setIndex: (index) => set((s) => ({ index: Math.max(0, Math.min(index, s.items.length - 1)) })),
  close: () => set({ open: false }),
}));
