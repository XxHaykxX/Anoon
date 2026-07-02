"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AvatarPicker } from "@/components/avatar-picker";
import { accountsEnabled } from "@/lib/supabase";
import { useMounted } from "@/lib/use-mounted";
import { cn } from "@/lib/utils";
import { AGE_BANDS, type AgeBand } from "@/store/match-prefs";
import { type Gender, useSession } from "@/store/session";

// Многошаговое дозаполнение профиля после регистрации.
// Шаг 1 (только если пол ещё не выбран — email-флоу его уже спрашивал): блокировка пола.
// Шаг 2: имя/фамилия/фото/возраст-бэнд → completeAccountProfile (лочит пол на сервере).
export default function RegisterConfirmPage() {
  const router = useRouter();
  const mounted = useMounted();
  const session = useSession();
  const completeAccountProfile = useSession((s) => s.completeAccountProfile);

  const [phase, setPhase] = useState<"gender" | "details">(session.gender ? "details" : "gender");
  const [pendingGender, setPendingGender] = useState<Gender | null>(session.gender ?? null);
  const [agree, setAgree] = useState(false);

  const [firstName, setFirstName] = useState(session.firstName ?? "");
  const [lastName, setLastName] = useState(session.lastName ?? "");
  const [avatarPath, setAvatarPath] = useState<string | undefined>(session.avatarUrl);
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = mounted && (!accountsEnabled || session.genderLocked);
  useEffect(() => {
    if (blocked) router.replace("/");
  }, [blocked, router]);

  if (!mounted || blocked) return null;

  const detailsOk = firstName.trim().length >= 1;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailsOk || loading) return;
    const gender = pendingGender ?? session.gender;
    if (!gender) {
      setPhase("gender");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await completeAccountProfile({
      firstName: firstName.trim(),
      lastName: lastName.trim() || undefined,
      avatarUrl: avatarPath,
      gender,
      ageBand: ageBand ?? undefined,
    });
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? "Не удалось сохранить профиль");
      return;
    }
    router.replace("/");
  };

  return (
    <div className="flex min-h-dvh flex-col justify-center px-6">
      <AnimatePresence mode="wait">
        {phase === "gender" ? (
          <motion.div
            key="gender"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="mx-auto w-full max-w-sm"
          >
            <h1 className="text-xl font-bold">Выбери свой пол</h1>
            <p className="mt-2 text-sm text-fg-muted">Пол нельзя изменить после регистрации</p>

            <div role="radiogroup" aria-label="Пол" className="mt-5 flex gap-2">
              {([{ v: "male", label: "Мужчина" }, { v: "female", label: "Женщина" }] as const).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={pendingGender === o.v}
                  onClick={() => setPendingGender(o.v)}
                  className={cn(
                    "min-h-11 flex-1 rounded-xl border px-3 text-base font-medium transition",
                    pendingGender === o.v ? "border-accent bg-accent/15 text-fg" : "border-white/10 bg-white/5 text-fg-secondary hover:text-fg",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <label className="mt-5 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-fg-secondary">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="h-5 w-5 shrink-0 accent-accent"
              />
              Понимаю
            </label>

            <button
              type="button"
              disabled={!pendingGender || !agree}
              onClick={() => setPhase("details")}
              className="mt-6 min-h-11 w-full rounded-xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-fg transition disabled:opacity-40"
            >
              Далее
            </button>
          </motion.div>
        ) : (
          <motion.form
            key="details"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onSubmit={submit}
            className="mx-auto w-full max-w-sm space-y-5"
          >
            <h1 className="text-xl font-bold">Расскажи о себе</h1>

            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}

            <AvatarPicker avatarUrl={avatarPath} name={firstName} publicId={session.publicId} onChange={setAvatarPath} />

            <div>
              <label htmlFor="firstName" className="mb-2 block text-xs font-medium text-fg-secondary">
                Имя
              </label>
              <input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                maxLength={40}
                required
                className="w-full rounded-xl border border-border bg-surface-1 px-4 py-3.5 text-base outline-none focus:border-accent"
              />
            </div>

            <div>
              <label htmlFor="lastName" className="mb-2 block text-xs font-medium text-fg-secondary">
                Фамилия (необязательно)
              </label>
              <input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                maxLength={40}
                className="w-full rounded-xl border border-border bg-surface-1 px-4 py-3.5 text-base outline-none focus:border-accent"
              />
            </div>

            <div>
              <span className="mb-2 block text-xs font-medium text-fg-secondary">Возраст (необязательно)</span>
              <div className="grid grid-cols-2 gap-2">
                {AGE_BANDS.map((b) => (
                  <button
                    key={b.value}
                    type="button"
                    role="radio"
                    aria-checked={ageBand === b.value}
                    onClick={() => setAgeBand(ageBand === b.value ? null : b.value)}
                    className={cn(
                      "flex min-h-11 items-center justify-between rounded-xl border px-4 py-3 text-sm transition-colors",
                      ageBand === b.value ? "border-accent bg-accent/15 text-fg" : "border-white/10 bg-white/5 text-fg-secondary hover:text-fg",
                    )}
                  >
                    <span>{b.label}</span>
                    {ageBand === b.value && <Check size={16} className="text-accent" />}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={!detailsOk || loading}
              className="min-h-11 w-full rounded-xl bg-accent px-4 py-3.5 text-base font-semibold text-accent-fg transition disabled:opacity-40"
            >
              {loading ? "Сохраняем…" : "Готово"}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
