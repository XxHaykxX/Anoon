"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { useEffect } from "react";

import { Segmented } from "@/components/segmented";
import { accountsEnabled } from "@/lib/supabase";
import { AGE_BANDS, useMatchPrefs } from "@/store/match-prefs";
import { useSession } from "@/store/session";
import { cn } from "@/lib/utils";

// Экран фильтров подбора. За NEXT_PUBLIC_ACCOUNTS_ENABLED пол приходит из аккаунта (залочен
// на регистрации) — свой пол здесь не спрашиваем, только возраст. В старом анон-флоу (флаг
// выключен) пол по-прежнему выбирается тут же. Приложение 18+.
export function MatchSetup({ onStart, searching }: { onStart: () => void; searching: boolean }) {
  const { gender, age, wantAges, setGender, setAge, toggleWantAge, ready } = useMatchPrefs();
  const accountGender = useSession((s) => s.gender); // "male" | "female" | undefined

  // Синк пола из аккаунта в фильтры подбора (та же побочка, что и у ручного выбора —
  // setGender сам выставляет wantGender=противоположный, иначе матчинг сломается).
  useEffect(() => {
    if (!accountsEnabled || !accountGender) return;
    const g = accountGender === "male" ? "m" : "f";
    if (useMatchPrefs.getState().gender !== g) setGender(g);
  }, [accountGender, setGender]);

  return (
    <div className="mx-auto w-full max-w-sm space-y-6 px-1 pb-8">
      {!accountsEnabled && (
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
      )}

      {/* Возраст — компактная сетка бэндов (2 колонки) */}
      <Field label="Ваш возраст" hint="обязательно">
        <div className="grid grid-cols-2 gap-2">
          {AGE_BANDS.map((b) => (
            <AgeRow key={b.value} label={b.label} active={age === b.value} onClick={() => setAge(b.value)} />
          ))}
        </div>
      </Field>
      <Field label="Возраст собеседника" hint="можно несколько">
        <div className="grid grid-cols-2 gap-2">
          {AGE_BANDS.map((b) => (
            <AgeRow key={b.value} label={b.label} active={wantAges.includes(b.value)} multi onClick={() => toggleWantAge(b.value)} />
          ))}
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
      {!ready() && (
        <p className="text-center text-xs text-fg-muted">
          {accountsEnabled ? "Выбери возраст, чтобы начать" : "Выбери свой пол и возраст, чтобы начать"}
        </p>
      )}
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

function AgeRow({ label, active, multi, onClick }: { label: string; active: boolean; multi?: boolean; onClick: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      role={multi ? "checkbox" : "radio"}
      aria-checked={active}
      className={cn(
        "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-sm transition-colors",
        active ? "border-accent bg-accent/15 text-fg" : "border-white/10 bg-white/5 text-fg-secondary hover:text-fg",
      )}
    >
      <span>{label}</span>
      {active && <Check size={16} className="text-accent" />}
    </motion.button>
  );
}
