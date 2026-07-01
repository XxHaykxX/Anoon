"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Фильтры подбора собеседника. Приложение 18+.
export type SelfGender = "nobody" | "m" | "f"; // Некто / М / Ж
export type PeerGender = "any" | "m" | "f"; // Не важно / М / Ж

export const AGE_MIN = 18;
export const AGE_MAX = 80; // верхняя граница ползунка (80 = «80+»)

export type MatchCriteria = {
  gender: SelfGender;
  age: number; // свой возраст (ползунок)
  wantGender: PeerGender;
  wantMin: number; // возраст собеседника: диапазон [wantMin, wantMax]
  wantMax: number;
};

type MatchPrefsState = MatchCriteria & {
  setGender: (g: SelfGender) => void;
  setAge: (a: number) => void;
  setWantGender: (g: PeerGender) => void;
  setWantRange: (min: number, max: number) => void;
  ready: () => boolean; // нужен свой пол (возраст всегда задан ползунком)
};

const clampAge = (n: number) => Math.min(AGE_MAX, Math.max(AGE_MIN, Math.round(n)));

export const useMatchPrefs = create<MatchPrefsState>()(
  persist(
    (set, get) => ({
      gender: "nobody",
      age: 25,
      wantGender: "any",
      wantMin: AGE_MIN,
      wantMax: AGE_MAX,

      // Пол собеседника выбирается автоматически: мужчина ищет женщину и наоборот.
      setGender: (g) => set({ gender: g, wantGender: g === "m" ? "f" : g === "f" ? "m" : "any" }),
      setAge: (a) => set({ age: clampAge(a) }),
      setWantGender: (g) => set({ wantGender: g }),
      setWantRange: (min, max) => {
        const lo = clampAge(min);
        const hi = clampAge(max);
        set({ wantMin: Math.min(lo, hi), wantMax: Math.max(lo, hi) });
      },

      ready: () => get().gender !== "nobody",
    }),
    {
      name: "anoon-match",
      version: 2, // v1 хранил возраст бэндами (age:string, wantAges:[]) — мигрируем в числа
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const num = (v: unknown, d: number) => (typeof v === "number" ? clampAge(v) : d);
        return {
          gender: p.gender === "m" || p.gender === "f" ? p.gender : "nobody",
          age: num(p.age, 25),
          wantGender: p.wantGender === "m" || p.wantGender === "f" ? p.wantGender : "any",
          wantMin: num(p.wantMin, AGE_MIN),
          wantMax: num(p.wantMax, AGE_MAX),
        } as MatchCriteria;
      },
      partialize: (s) => ({ gender: s.gender, age: s.age, wantGender: s.wantGender, wantMin: s.wantMin, wantMax: s.wantMax }),
    },
  ),
);
