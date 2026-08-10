"use client";

import { useRef, useState, type ChangeEvent } from "react";
import {
  LockIcon,
  CameraIcon,
  ChevronRightIcon,
  CheckIcon,
} from "@/components/icons";
import { AnoonAvatar, AnoonBottomNav } from "@/components/anoon/_shared";
import AnoonWallet from "@/components/anoon/AnoonWallet";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import { authedFileUrl, getTinodeClient, USE_TINODE } from "@/lib/tinode";
import { useAnoonStore } from "@/store";

/** The signed-in account's own Tinode topic — avatar/profile live on `me`. */
const MY_TOPIC = "me";

/** Two-letter avatar initials from a display name (1 word → first 2 letters). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function AnoonProfile() {
  const nav = useAnoonNav();

  // Surface the real #ID / profile from the signed-in store user; fall back to
  // stubs only in the showcase (no user / flag off).
  const user = useAnoonStore((s) => s.user);
  const signOut = useAnoonStore((s) => s.signOut);
  const setUser = useAnoonStore((s) => s.setUser);
  // Bell badge: real unread-notifications count when signed in; stub otherwise
  // (same pattern as AnoonHome/AnoonNotifications — never hardcode a phantom count).
  const unreadCount = useAnoonStore((s) => s.unreadCount);
  const real = USE_TINODE && !!user;
  const notifBadge = real ? unreadCount : 3;
  const hashId = real ? user!.hashId : "00001";
  const profileLink = `anoon.chat/u/${hashId}`;
  // Gender is chosen at registration and read-only here — show the real value.
  const genderLabel = real
    ? user!.gender === "female"
      ? "Женский"
      : "Мужской"
    : "Мужской";
  const avatarInitials = real ? initialsOf(user!.displayName) : "АК";
  const [nick, setNick] = useState(() => (real ? user!.displayName : "solar_fox"));
  const [firstName, setFirstName] = useState(() =>
    real ? user!.displayName.split(" ")[0] ?? "" : "Айк",
  );
  const [lastName, setLastName] = useState(() =>
    real ? user!.displayName.split(" ").slice(1).join(" ") : "Карапетян",
  );
  const [age, setAge] = useState(() => (real ? String(user!.age) : "24"));
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  // Persisted photo ref (`public.photo.ref`), read live off the Tinode client
  // on every render (not seeded once into state) — `user` arrives async, so a
  // one-time read at mount can permanently lock this to null even after the
  // me-topic (and its avatar) loads. Re-renders triggered by avatarUploading/
  // avatarPreview changes below also pick up a freshly-uploaded ref for free.
  const avatarRef = real ? getTinodeClient().avatarRefFor(MY_TOPIC) : null;
  // A stored photo ref whose blob 404s (a lost/GC'd upload) must fall back to
  // the initials avatar instead of a broken <img> (BUG-39/41). Tracked by the
  // specific ref that failed, so a fresh upload (new ref) isn't hidden.
  const [brokenAvatarRef, setBrokenAvatarRef] = useState<string | null>(null);
  const avatarBroken = !!avatarRef && brokenAvatarRef === avatarRef;
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    // Persist edits to the store so they survive navigation (real user only).
    if (real && user) {
      const displayName = `${firstName} ${lastName}`.trim() || user.displayName;
      setUser({ ...user, displayName, age: Number(age) || user.age });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(profileLink).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const openPhotoPicker = () => fileInputRef.current?.click();

  const onPhotoPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Show the pick instantly via a local blob URL while the real upload runs.
    setAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    if (!real) return; // showcase/mock: local preview only, nothing to persist.
    setAvatarError(null);
    setAvatarUploading(true);
    getTinodeClient()
      .setAvatar(file)
      .then(() => {
        // No need to stash the returned ref in state — avatarRef re-reads the
        // client live on the next render, which this preview-clear triggers.
        setAvatarPreview((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      })
      .catch(() => setAvatarError("Не удалось загрузить фото"))
      .finally(() => setAvatarUploading(false));
  };

  const handleLogout = () => {
    signOut();
    nav.go("onboarding");
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4 lg:[.anoon-desktop_&]:px-8">
        <h1 className="text-2xl font-bold">Профиль</h1>
      </header>

      {/*
        Desktop (≥1024) splits this screen into two columns WITHOUT reordering
        the DOM: the wrappers below follow the phone order exactly (form first,
        then share + links), so the phone branch keeps rendering one plain
        column. Every desktop utility here is `lg:[.anoon-desktop_&]:…`, and
        BOTH halves are load-bearing: the showcase draws this same screen in
        390px frames on a wide monitor (so a bare `lg:` would fire there), while
        `.anoon-desktop` sits on the AnoonApp root at every width (so the class
        alone would fire on the phone). See docs/DESKTOP-LAYOUT.md.
      */}
      <div className="flex-1 overflow-y-auto px-5 pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:[.anoon-desktop_&]:grid lg:[.anoon-desktop_&]:grid-cols-2 lg:[.anoon-desktop_&]:items-start lg:[.anoon-desktop_&]:gap-x-8 lg:[.anoon-desktop_&]:px-8 lg:[.anoon-desktop_&]:pt-2">
        {/* Column 1 on desktop: identity + editable fields + save. */}
        <div>
          {/* Avatar + change photo */}
          <div className="flex flex-col items-center gap-3 py-4 lg:[.anoon-desktop_&]:pt-0">
            <div className="relative">
              {avatarPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarPreview}
                  alt="Аватар"
                  className="rounded-full object-cover"
                  style={{ width: 92, height: 92 }}
                />
              ) : avatarRef && !avatarBroken ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={authedFileUrl(avatarRef)}
                  alt="Аватар"
                  onError={() => setBrokenAvatarRef(avatarRef)}
                  className="rounded-full object-cover"
                  style={{ width: 92, height: 92 }}
                />
              ) : (
                <AnoonAvatar
                  initials={avatarInitials}
                  tone={real ? user!.avatarTone : 3}
                  size={92}
                />
              )}
              {avatarUploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-xs font-medium text-white">
                  Загрузка…
                </div>
              )}
              <button
                type="button"
                onClick={openPhotoPicker}
                className="absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-background transition-transform active:scale-95"
                aria-label="Сменить фото"
              >
                <CameraIcon className="size-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={openPhotoPicker}
              className="text-sm font-medium text-primary transition-transform active:scale-95"
            >
              Сменить фото
            </button>
            {avatarError && <p className="text-xs text-destructive">{avatarError}</p>}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onPhotoPicked}
            />
          </div>

          {/* Fields */}
          <div className="space-y-3">
            {/* ID — read only, locked */}
            <div className="rounded-2xl border border-border bg-card px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">#ID</span>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <LockIcon className="size-3.5" />
                  не меняется
                </span>
              </div>
              <p className="mt-0.5 font-mono text-lg font-semibold tracking-wide">
                #{hashId}
              </p>
            </div>

            <Field label="Ник" value={nick} onChange={setNick} placeholder="Придумайте ник" />
            <Field label="Имя" value={firstName} onChange={setFirstName} placeholder="Имя" />
            <Field label="Фамилия" value={lastName} onChange={setLastName} placeholder="Фамилия" />
            <Field
              label="Возраст"
              value={age}
              onChange={(v) => setAge(v.replace(/\D/g, "").slice(0, 3))}
              placeholder="Возраст"
              inputMode="numeric"
            />

            {/* Gender — read only, locked */}
            <div className="rounded-2xl border border-border bg-card px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Пол</span>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <LockIcon className="size-3.5" />
                  нельзя изменить
                </span>
              </div>
              <p className="mt-0.5 text-foreground">{genderLabel}</p>
            </div>
          </div>

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-semibold text-primary-foreground transition-transform active:scale-95"
          >
            {saved ? (
              <>
                <CheckIcon className="size-5" />
                Сохранено
              </>
            ) : (
              "Сохранить"
            )}
          </button>
        </div>

        {/* Column 2 on desktop: sharing + the links out of this screen. */}
        <div>
          {/* Share profile */}
          <section className="mt-6 rounded-2xl border border-border bg-card p-4 lg:[.anoon-desktop_&]:mt-0">
            <h2 className="text-sm font-semibold">Поделиться профилем</h2>
            {/* Link only — no QR here (the invite screen owns the real, scannable
                QR code for #ID invites; this was previously a fake decorative
                grid, not an actual encoding of the link, so it's gone). */}
            <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-muted px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Ваша ссылка</p>
                {/* The link is the point of this card, and «Скопировать» is the
                    only way to get it — so it wraps rather than truncating.
                    On 390 it was cut at 108px of 147px. */}
                <p className="break-all font-medium">{profileLink}</p>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 rounded-full bg-card px-3 py-1.5 text-sm font-medium transition-transform active:scale-95"
              >
                {copied ? "Скопировано ✓" : "Скопировать ссылку"}
              </button>
            </div>
          </section>

          {/* Links */}
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
            {/* Desktop brings a keyboard, so every `hover:` here carries the
                matching `focus-visible:` (docs/DESKTOP-LAYOUT.md, rule 5). */}
            <button
              type="button"
              onClick={() => setWalletOpen(true)}
              className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none active:scale-[0.99]"
            >
              <span>Монеты и подписка</span>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </button>
            <div className="border-t border-border" />
            <button
              type="button"
              onClick={() => nav.push("settings")}
              className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none active:scale-[0.99]"
            >
              <span>Настройки</span>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </button>
            <div className="border-t border-border" />
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center justify-between px-4 py-3.5 text-left text-destructive transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none active:scale-[0.99]"
            >
              <span className="font-medium">Выйти</span>
              <ChevronRightIcon className="size-4 text-destructive/70" />
            </button>
          </div>
        </div>
      </div>

      <AnoonBottomNav active="profile" badges={{ notifications: notifBadge }} />

      {walletOpen && <AnoonWallet onClose={() => setWalletOpen(false)} />}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "text";
}) {
  return (
    <label className="block rounded-2xl border border-border bg-card px-4 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground/60"
      />
    </label>
  );
}
