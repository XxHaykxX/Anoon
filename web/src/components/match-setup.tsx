"use client";

import { motion } from "framer-motion";

import { Segmented } from "@/components/segmented";
import { AGE_MAX, AGE_MIN, useMatchPrefs } from "@/store/match-prefs";
import { cn } from "@/lib/utils";

const ACCENT = "#fdbf2d";
const ageLabel = (n: number) => `${n}${n >= AGE_MAX ? "+" : ""}`;

// Экран фильтров подбора (пол свой + возраст свой/искомого ползунками). Приложение 18+.
export function MatchSetup({ onStart, searching }: { onStart: () => void; searching: boolean }) {
  const { gender, age, wantMin, wantMax, setGender, setAge, setWantRange, ready } = useMatchPrefs();

  return (
    <div className="mx-auto w-full max-w-sm space-y-6 px-1 pb-8">
      <Field label="Ваш пол">
        <Segmented
          groupId="self-gender"
          ariaLabel="Ваш пол"
          value={gender}
          onChange={setGender}
          options={[
            { value: "m", label: "Мужчина" },
            { value: "f", label: "Женщина" },
          ]}
        />
      </Field>

      {/* Свой возраст — одиночный ползунок */}
      <Field label="Ваш возраст" hint={ageLabel(age)}>
        <input
          type="range"
          min={AGE_MIN}
          max={AGE_MAX}
          value={age}
          onChange={(e) => setAge(Number(e.target.value))}
          aria-label="Ваш возраст"
          className="w-full"
          style={{ accentColor: ACCENT }}
        />
      </Field>

      {/* Возраст собеседника — диапазон (От / До) */}
      <Field label="Возраст собеседника" hint={`${wantMin} – ${ageLabel(wantMax)}`}>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-fg-muted">От: {wantMin}</div>
            <input
              type="range"
              min={AGE_MIN}
              max={AGE_MAX}
              value={wantMin}
              onChange={(e) => setWantRange(Number(e.target.value), wantMax)}
              aria-label="Возраст собеседника: от"
              className="w-full"
              style={{ accentColor: ACCENT }}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-fg-muted">До: {ageLabel(wantMax)}</div>
            <input
              type="range"
              min={AGE_MIN}
              max={AGE_MAX}
              value={wantMax}
              onChange={(e) => setWantRange(wantMin, Number(e.target.value))}
              aria-label="Возраст собеседника: до"
              className="w-full"
              style={{ accentColor: ACCENT }}
            />
          </div>
        </div>
      </Field>

      {/* Старт */}
      <motion.button
        onClick={onStart}
        disabled={!ready() || searching}
        whileTap={{ scale: 0.97 }}
        className={cn(
          "mt-2 flex h-14 w-full items-center justify-center rounded-full text-lg font-semibold shadow-2xl transition disabled:opacity-40",
          "bg-accent text-accent-fg",
        )}
      >
        {searching ? "Ищем собеседника…" : "Начать чат"}
      </motion.button>
      {!ready() && <p className="text-center text-xs text-fg-muted">Выбери свой пол, чтобы начать</p>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-1.5">
        <span className="text-sm font-semibold">{label}</span>
        {hint && <span className="text-xs text-fg-muted">· {hint}</span>}
      </div>
      {children}
    </div>
  );
}
