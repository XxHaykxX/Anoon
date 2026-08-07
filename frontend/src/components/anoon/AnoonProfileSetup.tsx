"use client";

import { useState } from "react";
import { PlusIcon } from "@/components/icons";
import { AnoonAvatar, AnoonLogo } from "@/components/anoon/_shared";
import { useAnoonNav } from "@/components/anoon/anoonNav";

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

const AGE_RANGES = ["18–21", "22–25", "26–35", "36+"] as const;

/**
 * Desktop (≥1024): this screen is a narrow form, so it becomes one centered
 * column of a readable width instead of stretching across the shell's 60rem
 * work area; the background stays full-bleed, only the content is capped.
 * Both halves of the variant are load-bearing — see docs/DESKTOP-LAYOUT.md,
 * «Как писать десктопные стили в файле экрана».
 */
const DESKTOP_FORM =
  "lg:[.anoon-desktop_&]:mx-auto lg:[.anoon-desktop_&]:w-full lg:[.anoon-desktop_&]:max-w-[26rem]";

export default function AnoonProfileSetup() {
  const nav = useAnoonNav();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [ageRange, setAgeRange] = useState<string | null>(null);
  const [hasPhoto, setHasPhoto] = useState(false);

  const canFinish = firstName.trim().length > 0;

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      <div className={`px-6 pt-6 ${DESKTOP_FORM}`}>
        <AnoonLogo className="text-xl" />
      </div>

      <div className={`flex-1 overflow-y-auto px-6 pb-6 ${DESKTOP_FORM}`}>
        <h1 className="mt-5 text-2xl font-bold">Заполните профиль</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Всё, кроме имени, можно пропустить.
        </p>

        {/* Avatar */}
        <div className="mt-7 flex flex-col items-center">
          <button
            type="button"
            onClick={() => setHasPhoto((v) => !v)}
            aria-label={hasPhoto ? "Убрать фото" : "Добавить фото"}
            className="relative transition-transform active:scale-95 cursor-pointer"
          >
            {hasPhoto ? (
              <AnoonAvatar
                initials={(firstName.trim()[0] ?? "A").toUpperCase()}
                tone={3}
                size={96}
              />
            ) : (
              <div className="grid size-24 place-items-center rounded-full border-2 border-dashed border-border bg-card text-muted-foreground">
                <CameraIcon className="size-8" />
              </div>
            )}
            <span className="absolute bottom-0 right-0 grid size-8 place-items-center rounded-full bg-primary text-primary-foreground ring-4 ring-background">
              <PlusIcon className="size-4" />
            </span>
          </button>
          <span className="mt-2 text-xs text-muted-foreground">
            {hasPhoto ? "Фото добавлено" : "Добавить фото · необязательно"}
          </span>
        </div>

        <div className="mt-8 flex flex-col gap-3">
          {/* First name */}
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Имя
            </label>
            <input
              type="text"
              placeholder="Ваше имя"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2"
            />
          </div>

          {/* Last name */}
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Фамилия{" "}
              <span className="text-muted-foreground/70">· необязательно</span>
            </label>
            <input
              type="text"
              placeholder="Ваша фамилия"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-2"
            />
          </div>

          {/* Age range */}
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Возраст{" "}
              <span className="text-muted-foreground/70">· необязательно</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {AGE_RANGES.map((r) => {
                const active = ageRange === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAgeRange(active ? null : r)}
                    className={`rounded-xl py-2.5 text-sm font-medium transition-transform active:scale-95 cursor-pointer ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* The hairline stays full-bleed; only the button inside rides the column. */}
      <div className="border-t border-border">
        <div className={`px-6 py-4 ${DESKTOP_FORM}`}>
          <button
            type="button"
            disabled={!canFinish}
            onClick={() => nav.go("home")}
            className={`w-full rounded-xl bg-primary py-3.5 font-semibold text-primary-foreground transition-transform active:scale-95 cursor-pointer ${
              canFinish ? "" : "cursor-not-allowed opacity-50"
            }`}
            style={
              canFinish
                ? { boxShadow: "0 8px 24px -6px rgba(253,191,45,0.4)" }
                : undefined
            }
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
