"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import { useSession } from "@/store/session";

export function Onboarding() {
  const createProfile = useSession((s) => s.createProfile);
  const creating = useSession((s) => s.creating);
  const [nick, setNick] = useState("");
  const ok = nick.trim().length >= 2 && !creating;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex min-h-dvh flex-col justify-center px-6"
    >
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-3xl font-bold text-accent-fg">a</div>
      <h1 className="mt-6 text-center text-2xl font-bold">anoon</h1>
      <p className="mt-2 text-center text-sm text-fg-secondary">
        Анонимный чат. Только ник и #ID — никаких фото, возраста и города.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) void createProfile(nick);
        }}
        className="mx-auto mt-8 w-full max-w-sm"
      >
        <label htmlFor="nick" className="mb-2 block text-xs font-medium text-fg-secondary">Твой ник</label>
        <input
          id="nick"
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          placeholder="Например: Синий Кот"
          maxLength={24}
          autoComplete="off"
          className="w-full rounded-xl border border-border bg-surface-1 px-4 py-3.5 text-base outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!ok}
          className="mt-4 w-full rounded-xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-fg transition hover:bg-accent-hover disabled:opacity-40"
        >
          {creating ? "Входим…" : "Начать общение"}
        </button>
        <p className="mt-3 text-center text-xs text-fg-muted">#ID выдаётся автоматически и не меняется.</p>
      </form>
    </motion.div>
  );
}
