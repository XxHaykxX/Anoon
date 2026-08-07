"use client";

import { useState } from "react";
import { CheckIcon } from "@/components/icons";
import { AnoonLogo } from "@/components/anoon/_shared";
import { useAnoonNav } from "@/components/anoon/anoonNav";

function MaleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="10" cy="14" r="6" />
      <path d="M15 9l5-5" />
      <path d="M15 4h5v5" />
    </svg>
  );
}

function FemaleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="6" />
      <path d="M12 14v8" />
      <path d="M9 19h6" />
    </svg>
  );
}

type Gender = "male" | "female" | null;

/**
 * Desktop (≥1024): this screen is a narrow form, so it becomes one centered
 * column of a readable width instead of stretching across the shell's 60rem
 * work area; the background stays full-bleed, only the content is capped.
 * Both halves of the variant are load-bearing — see docs/DESKTOP-LAYOUT.md,
 * «Как писать десктопные стили в файле экрана».
 */
const DESKTOP_FORM =
  "lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:w-full lg:[.anoon-desktop_&]:max-w-[26rem]";

export default function AnoonGenderSelect() {
  const nav = useAnoonNav();
  const [gender, setGender] = useState<Gender>(null);
  const [understood, setUnderstood] = useState(false);

  const canContinue = !!gender && understood;

  const options = [
    { id: "male" as const, label: "Мужчина", Icon: MaleIcon },
    { id: "female" as const, label: "Женщина", Icon: FemaleIcon },
  ];

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      <div className={`px-6 pt-6 ${DESKTOP_FORM}`}>
        <AnoonLogo className="text-xl" />
      </div>

      <div className={`flex-1 overflow-y-auto px-6 pb-6 ${DESKTOP_FORM}`}>
        <h1 className="mt-6 text-2xl font-bold">Выберите пол</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          По полу подбираются собеседники. Выберите свой.
        </p>

        {/* Large gender cards */}
        <div className="mt-7 grid grid-cols-2 gap-3">
          {options.map(({ id, label, Icon }) => {
            const active = gender === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setGender(id)}
                className={`flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl border transition-transform active:scale-95 cursor-pointer ${
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                <Icon className={active ? "text-primary" : ""} />
                <span
                  className={`text-base font-semibold ${
                    active ? "text-foreground" : "text-foreground"
                  }`}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Warning */}
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
          <span className="mt-0.5 text-lg leading-none">⚠️</span>
          <p className="text-sm text-foreground">
            Пол потом изменить нельзя. Убедитесь, что выбрали правильно.
          </p>
        </div>

        {/* Understand checkbox */}
        <button
          type="button"
          onClick={() => setUnderstood((v) => !v)}
          className="mt-4 flex w-full items-center gap-3 text-left transition-transform active:scale-95 cursor-pointer"
        >
          <span
            className={`grid size-6 shrink-0 place-items-center rounded-md border ${
              understood
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card"
            }`}
          >
            {understood && <CheckIcon className="size-4" />}
          </span>
          <span className="text-sm text-foreground">
            Понимаю, что пол изменить будет нельзя
          </span>
        </button>
      </div>

      {/* The hairline stays full-bleed; only the button inside rides the column. */}
      <div className="border-t border-border">
        <div className={`px-6 py-4 ${DESKTOP_FORM}`}>
          {/* `go`, not `push`: gender is confirmed irreversible on this screen, so
              there is nothing to come back to — don't leave an unreachable entry. */}
          <button
            type="button"
            disabled={!canContinue}
            onClick={() => nav.go("auth-profile-setup")}
            className={`w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-95 cursor-pointer ${
              canContinue ? "" : "cursor-not-allowed opacity-50"
            }`}
            style={
              canContinue
                ? { boxShadow: "0 8px 24px -6px rgba(253,191,45,0.4)" }
                : undefined
            }
          >
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
}
