"use client";

import { ArrowLeft, Check, Copy, Lock, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

import { AvatarPicker } from "@/components/avatar-picker";
import { fetchMyProfile } from "@/lib/api";
import { accountsEnabled, supabase } from "@/lib/supabase";
import { useMounted } from "@/lib/use-mounted";
import { useRequireAccount } from "@/lib/use-require-account";
import { AGE_BANDS, type AgeBand } from "@/store/match-prefs";
import { useSession } from "@/store/session";

const GENDER_LABEL: Record<string, string> = { male: "Мужчина", female: "Женщина" };

// Редактирование профиля аккаунта: имя/фамилия/фото/ник/возраст-бэнд; пол — read-only с замком.
export default function ProfilePage() {
  const router = useRouter();
  const mounted = useMounted();
  const gate = useRequireAccount();
  const session = useSession();
  const completeAccountProfile = useSession((s) => s.completeAccountProfile);
  const reset = useSession((s) => s.reset);

  // Инициализируем из persisted session → форма рисуется МГНОВЕННО (без ожидания сети).
  const [nickname, setNickname] = useState(session.nickname);
  const [firstName, setFirstName] = useState(session.firstName ?? "");
  const [lastName, setLastName] = useState(session.lastName ?? "");
  const [avatarPath, setAvatarPath] = useState<string | undefined>(session.avatarUrl);
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null); // единственное поле не из сессии
  const [gender, setGender] = useState<string | undefined>(session.gender);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Пользователь начал редактировать → фоновый refresh НЕ перезатирает его ввод.
  const dirtyRef = useRef(false);
  const markDirty = () => {
    dirtyRef.current = true;
  };

  // Скелет — ТОЛЬКО если сессии реально нечего показать (нет #ID). Обычно #ID есть → форма сразу.
  const showSkeleton = !session.publicId;

  useEffect(() => {
    if (!accountsEnabled) return;
    // Фоновое освежение (в основном ageBand — его нет в сессии). Не блокирует рендер, не клобберит ввод.
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const profile = await fetchMyProfile(token);
      if (!profile || dirtyRef.current) return;
      setNickname(profile.nickname);
      setFirstName(profile.firstName ?? "");
      setLastName(profile.lastName ?? "");
      setAvatarPath(profile.avatarUrl ?? undefined);
      setAgeBand((profile.ageBand as AgeBand | null) ?? null);
      setGender(profile.gender ?? undefined);
    })();
  }, []);

  useEffect(() => {
    if (mounted && !accountsEnabled) router.replace("/");
  }, [mounted, router]);

  if (!mounted || !accountsEnabled) return null;
  if (gate !== "ready") return null;

  const ok = firstName.trim().length >= 1 && Boolean(gender);

  const save = async () => {
    if (!ok || saving || !gender) return;
    setSaving(true);
    setError(null);
    const res = await completeAccountProfile({
      nickname: nickname.trim() || undefined,
      firstName: firstName.trim(),
      lastName: lastName.trim() || undefined,
      avatarUrl: avatarPath,
      gender: gender as "male" | "female",
      ageBand: ageBand ?? undefined,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Не удалось сохранить");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const logout = async () => {
    await reset();
    router.replace("/");
  };

  return (
    <div className="mx-auto flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <Link href="/settings" className="flex h-11 w-11 items-center justify-center rounded-full text-fg-secondary hover:bg-surface-2" aria-label="Назад">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-base font-semibold">Профиль</h1>
      </header>

      {showSkeleton ? (
        <div className="flex-1 space-y-4 p-5">
          <div className="mx-auto h-[88px] w-[88px] animate-pulse rounded-full bg-surface-2" />
          <div className="h-11 animate-pulse rounded-xl bg-surface-2" />
          <div className="h-11 animate-pulse rounded-xl bg-surface-2" />
        </div>
      ) : (
        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <p aria-live="polite" className="sr-only">
            {saved ? "Сохранено" : ""}
          </p>

          <AvatarPicker
            avatarUrl={avatarPath}
            name={firstName || nickname}
            publicId={session.publicId}
            onChange={(v) => {
              markDirty();
              setAvatarPath(v);
            }}
          />

          <section className="space-y-3">
            <div className="text-xs text-fg-muted">
              #ID: <span className="font-mono text-fg-secondary">#{session.publicId}</span> (не меняется)
            </div>

            <label className="block text-sm text-fg-secondary" htmlFor="nickname">
              Ник
            </label>
            <input
              id="nickname"
              value={nickname}
              onChange={(e) => {
                markDirty();
                setNickname(e.target.value);
              }}
              maxLength={24}
              className="w-full rounded-xl border border-border bg-surface-1 px-4 py-2.5 text-base outline-none focus:border-accent"
            />

            <label className="block text-sm text-fg-secondary" htmlFor="firstName">
              Имя
            </label>
            <input
              id="firstName"
              value={firstName}
              onChange={(e) => {
                markDirty();
                setFirstName(e.target.value);
              }}
              maxLength={40}
              className="w-full rounded-xl border border-border bg-surface-1 px-4 py-2.5 text-base outline-none focus:border-accent"
            />

            <label className="block text-sm text-fg-secondary" htmlFor="lastName">
              Фамилия
            </label>
            <input
              id="lastName"
              value={lastName}
              onChange={(e) => {
                markDirty();
                setLastName(e.target.value);
              }}
              maxLength={40}
              className="w-full rounded-xl border border-border bg-surface-1 px-4 py-2.5 text-base outline-none focus:border-accent"
            />

            <span className="block text-sm text-fg-secondary">Пол</span>
            <div className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface-1 px-4 text-base text-fg-muted">
              <Lock size={15} />
              {gender ? GENDER_LABEL[gender] ?? gender : "не выбран"}
              <span className="ml-auto text-xs">нельзя изменить</span>
            </div>

            <span className="block text-sm text-fg-secondary">Возраст</span>
            <div className="grid grid-cols-2 gap-2">
              {AGE_BANDS.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  role="radio"
                  aria-checked={ageBand === b.value}
                  onClick={() => {
                    markDirty();
                    setAgeBand(ageBand === b.value ? null : b.value);
                  }}
                  className={`flex min-h-11 items-center justify-between rounded-xl border px-4 py-3 text-sm transition-colors ${
                    ageBand === b.value ? "border-accent bg-accent/15 text-fg" : "border-white/10 bg-white/5 text-fg-secondary hover:text-fg"
                  }`}
                >
                  <span>{b.label}</span>
                  {ageBand === b.value && <Check size={16} className="text-accent" />}
                </button>
              ))}
            </div>

            <button
              onClick={() => void save()}
              disabled={!ok || saving}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg transition disabled:opacity-40"
            >
              {saved ? <Check size={16} /> : null}
              {saving ? "Сохраняем…" : saved ? "Готово" : "Сохранить"}
            </button>
          </section>

          {session.publicId ? <ShareQr publicId={session.publicId} /> : null}

          <section className="space-y-3 border-t border-border pt-6">
            <button
              onClick={() => void logout()}
              className="flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border border-danger/40 px-4 py-3 text-sm font-medium text-danger transition hover:bg-danger/10"
            >
              <LogOut size={18} /> Выйти
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

// Ссылка-приглашение + QR: friend-code = publicId, ведёт на /add/{publicId} (deep-link дружбы).
function ShareQr({ publicId }: { publicId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  const link = `${typeof window !== "undefined" ? window.location.origin : "https://anoon-web.vercel.app"}/add/${publicId}`;

  useEffect(() => {
    if (!canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, link, { width: 176, margin: 1, color: { dark: "#fafafa", light: "#00000000" } }).catch(() => {});
  }, [link]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Поделиться профилем</h2>
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface-1 p-5">
        <canvas ref={canvasRef} width={176} height={176} className="rounded-xl" aria-hidden="true" />
        <p className="break-all text-center font-mono text-xs text-fg-muted">{link}</p>
        <button
          onClick={() => void copy()}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-2 px-4 text-sm font-medium text-fg-secondary transition hover:text-fg"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? "Скопировано" : "Скопировать ссылку"}
        </button>
      </div>
    </section>
  );
}
