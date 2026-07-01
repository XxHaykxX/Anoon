"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Фильтры подбора собеседника. Приложение 18+ (бэнда «до 17» нет).
export type SelfGender = "nobody" | "m" | "f"; // Некто / М / Ж
export type PeerGender = "any" | "m" | "f"; // Не важно / М / Ж
export type AgeBand = "18-21" | "22-25" | "26-35" | "36+";

export const AGE_BANDS: { value: AgeBand; label: string }[] = [
  { value: "18-21", label: "18–21" },
  { value: "22-25", label: "22–25" },
  { value: "26-35", label: "26–35" },
  { value: "36+", label: "36+" },
];

export type MatchCriteria = {
  gender: SelfGender;
  age: AgeBand | null;
  wantGender: PeerGender;
  wantAges: AgeBand[];
};

type MatchPrefsState = MatchCriteria & {
  setGender: (g: SelfGender) => void;
  setAge: (a: AgeBand) => void;
  setWantGender: (g: PeerGender) => void;
  toggleWantAge: (a: AgeBand) => void;
  ready: () => boolean; // возраст обязателен
};

export const useMatchPrefs = create<MatchPrefsState>()(
  persist(
    (set, get) => ({
      gender: "nobody",
      age: null,
      wantGender: "any",
      wantAges: [],

      // Пол собеседника выбирается автоматически: мужчина ищет женщину и наоборот.
      setGender: (g) => set({ gender: g, wantGender: g === "m" ? "f" : g === "f" ? "m" : "any" }),
      setAge: (a) => set({ age: a }),
      setWantGender: (g) => set({ wantGender: g }),
      toggleWantAge: (a) =>
        set((s) => ({ wantAges: s.wantAges.includes(a) ? s.wantAges.filter((x) => x !== a) : [...s.wantAges, a] })),

      ready: () => get().age !== null && get().gender !== "nobody", // нужен свой пол (для авто-подбора противоположного)
    }),
    {
      name: "anoon-match",
      partialize: (s) => ({ gender: s.gender, age: s.age, wantGender: s.wantGender, wantAges: s.wantAges }),
    },
  ),
);
