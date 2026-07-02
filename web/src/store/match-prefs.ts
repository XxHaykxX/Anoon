"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { accountsEnabled } from "@/lib/supabase";

// Фильтры подбора собеседника. Приложение 18+.
export type SelfGender = "nobody" | "m" | "f"; // Некто / М / Ж
export type PeerGender = "any" | "m" | "f"; // Не важно / М / Ж
export type AgeBand = "18-21" | "22-25" | "26-35" | "36+";

export const AGE_BANDS: { value: AgeBand; label: string }[] = [
  { value: "18-21", label: "18–21" },
  { value: "22-25", label: "22–25" },
  { value: "26-35", label: "26–35" },
  { value: "36+", label: "36+" },
];

// Возраст (число) → бэнд (для миграции старого числового формата).
function bandOf(age: number): AgeBand {
  if (age <= 21) return "18-21";
  if (age <= 25) return "22-25";
  if (age <= 35) return "26-35";
  return "36+";
}
const isBand = (v: unknown): v is AgeBand => AGE_BANDS.some((b) => b.value === v);

export type MatchCriteria = {
  gender: SelfGender;
  age: AgeBand | null; // свой возраст — один бэнд
  wantGender: PeerGender;
  wantAges: AgeBand[]; // возраст собеседника — бэнды (можно несколько)
};

type MatchPrefsState = MatchCriteria & {
  setGender: (g: SelfGender) => void;
  setAge: (a: AgeBand) => void;
  setWantGender: (g: PeerGender) => void;
  toggleWantAge: (a: AgeBand) => void;
  ready: () => boolean; // нужен свой пол + свой возраст
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

      // За NEXT_PUBLIC_ACCOUNTS_ENABLED пол приходит из аккаунта (залочен на /register/confirm) —
      // здесь достаточно возраста. В старом анон-флоу (флаг выключен) требуем и пол тоже.
      ready: () => (accountsEnabled ? get().age !== null : get().gender !== "nobody" && get().age !== null),
    }),
    {
      name: "anoon-match",
      version: 4, // назад к бэндам: age=один бэнд, wantAges=бэнды
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const age = isBand(p.age) ? p.age : typeof p.age === "number" ? bandOf(p.age) : null;
        const wantAges = Array.isArray(p.wantAges) ? (p.wantAges.filter(isBand) as AgeBand[]) : [];
        return {
          gender: p.gender === "m" || p.gender === "f" ? p.gender : "nobody",
          age,
          wantGender: p.wantGender === "m" || p.wantGender === "f" ? p.wantGender : "any",
          wantAges,
        } as MatchCriteria;
      },
      partialize: (s) => ({ gender: s.gender, age: s.age, wantGender: s.wantGender, wantAges: s.wantAges }),
    },
  ),
);
