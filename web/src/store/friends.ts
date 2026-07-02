"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { FriendDTO, PendingDTO } from "@/lib/api";

// Лёгкий кэш списка друзей/заявок — чтобы /friends рендерился МГНОВЕННО из localStorage при
// возврате на страницу, а сеть освежала данные фоном (не блокируя рендер). Скелет — только на
// самой первой загрузке (loaded=false), дальше всегда есть что показать.
type FriendsState = {
  friends: FriendDTO[];
  incoming: PendingDTO[];
  outgoing: PendingDTO[];
  loaded: boolean; // была ли хоть одна успешная загрузка
  setAll: (data: { friends: FriendDTO[]; incoming: PendingDTO[]; outgoing: PendingDTO[] }) => void;
  removeFriendLocal: (publicId: string) => void;
  removeIncomingLocal: (publicId: string) => void;
};

export const useFriendsCache = create<FriendsState>()(
  persist(
    (set) => ({
      friends: [],
      incoming: [],
      outgoing: [],
      loaded: false,
      setAll: (data) => set({ ...data, loaded: true }),
      removeFriendLocal: (publicId) => set((s) => ({ friends: s.friends.filter((f) => f.publicId !== publicId) })),
      removeIncomingLocal: (publicId) => set((s) => ({ incoming: s.incoming.filter((p) => p.publicId !== publicId) })),
    }),
    { name: "anoon-friends-cache" },
  ),
);
