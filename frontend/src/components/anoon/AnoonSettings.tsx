"use client";

import { useEffect, useState } from "react";
import {
  BellIcon,
  BlockIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  CheckIcon,
  ShieldIcon,
  LockIcon,
  TrashIcon,
} from "@/components/icons";
import { AnoonAvatar } from "@/components/anoon/_shared";
import { useAnoonNav } from "@/components/anoon/anoonNav";
import { USE_TINODE, changePassword, deleteMyAccount } from "@/lib/tinode";
import { getCompanionClient, type BlockedFriend } from "@/lib/companion";
import { isNotifySoundEnabled, setNotifySoundEnabled } from "@/lib/notify";
import { pushSupported, subscribePush, unsubscribePush } from "@/lib/push";
import { useAnoonStore } from "@/store";

/* Local toggle switch — controlled. */
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
        checked ? "bg-primary" : "bg-muted"
      }`}
    >
      <span
        className={`inline-block size-5 rounded-full bg-white shadow transition-transform duration-200 ease-in-out ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

/** Deterministic avatar tone from a #ID, so blocked entries get a stable
 * color (same pattern as CallScreen/IncomingCall's `toneFor`) — the backend
 * doesn't send one. */
function toneFor(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return sum % 6;
}

/** Local push-preference toggle, persisted the same way notify.ts persists
 * the sound switch — mirrors the actual browser subscription state, checked
 * on mount, but survives a reload before that check completes. */
const PUSH_PREF_KEY = "anoon:notify:push";
function isPushPrefEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PUSH_PREF_KEY) === "1";
}
function setPushPrefEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PUSH_PREF_KEY, enabled ? "1" : "0");
}

export default function AnoonSettings() {
  const nav = useAnoonNav();
  const user = useAnoonStore((s) => s.user);
  const setUser = useAnoonStore((s) => s.setUser);
  const signOut = useAnoonStore((s) => s.signOut);
  const real = USE_TINODE && !!user;
  const [nick, setNick] = useState(() => (real ? user!.displayName : "solar_fox"));
  const [savedNick, setSavedNick] = useState(false);
  // Whether this browser can do Web Push at all — gates the toggle below.
  const [pushCapable] = useState(pushSupported);
  // Lazy init reads localStorage — SSR-safe (defaults to off until the mount
  // effect below confirms the actual browser subscription state).
  const [push, setPush] = useState(() => pushSupported() && isPushPrefEnabled());
  const [pushBusy, setPushBusy] = useState(false);
  // Lazy init reads localStorage — SSR-safe (isNotifySoundEnabled defaults to
  // true when `window` isn't there yet, then the client re-render picks up
  // whatever was actually persisted).
  const [soundOn, setSoundOn] = useState(isNotifySoundEnabled);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blocked, setBlocked] = useState<BlockedFriend[]>([]);
  /** The block list could not be read — distinct from "there is nobody in it". */
  const [blocksFailed, setBlocksFailed] = useState(false);

  // Change password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSavePassword =
    currentPassword.length > 0 && newPassword.length >= 6 && newPassword === confirmPassword;

  // Delete account
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Real mode: load the block list from companion (same fire-and-forget
  // pattern AnoonFriends uses for startContacts).
  //
  // A refused read is NOT an empty blacklist. listBlocks used to answer both
  // with [], so a failure rendered «Список пуст» — the one screen where a
  // wrong "nobody is blocked" is likely to be acted on. Track the failure
  // separately and say so instead.
  useEffect(() => {
    if (!real) return;
    let alive = true;
    void getCompanionClient()
      .listBlocks()
      .then((rows) => {
        if (!alive) return;
        setBlocked(rows);
        setBlocksFailed(false);
      })
      .catch(() => {
        if (alive) setBlocksFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [real]);

  // Reconcile the push toggle with the actual browser subscription — the
  // localStorage preference is only a best-guess until this confirms it
  // (permission may have been revoked, or granted from another device).
  useEffect(() => {
    if (!pushCapable) return;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.getSubscription();
        setPush(!!sub);
      } catch {
        /* best-effort — keep whatever the persisted preference said */
      }
    })();
  }, [pushCapable]);

  const saveNick = () => {
    // Persist nick as the user's display name (real user only).
    if (real && user) setUser({ ...user, displayName: nick });
    setSavedNick(true);
    setTimeout(() => setSavedNick(false), 1600);
  };

  const handleChangePassword = async () => {
    if (!canSavePassword || passwordBusy) return;
    setPasswordBusy(true);
    setPasswordError(null);
    try {
      if (real) await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 1600);
    } catch {
      setPasswordError("Не удалось сменить пароль — проверьте текущий пароль.");
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      if (real) {
        // Best-effort companion purge first (may 404 — not implemented yet),
        // then the real Tinode-side deletion.
        await getCompanionClient().deleteMe();
        await deleteMyAccount();
      }
      signOut();
      nav.go("onboarding");
    } catch {
      setDeleteError("Не удалось удалить аккаунт. Попробуйте ещё раз.");
      setDeleteBusy(false);
    }
  };

  const togglePush = async (next: boolean) => {
    if (pushBusy || !pushCapable) return;
    setPushBusy(true);
    try {
      if (next) {
        // subscribePush requests notification permission itself (via
        // pushManager.subscribe) and registers the VAPID subscription with
        // companion; it never throws, just resolves false on any failure.
        const ok = await subscribePush();
        setPush(ok);
        setPushPrefEnabled(ok);
      } else {
        await unsubscribePush();
        setPush(false);
        setPushPrefEnabled(false);
      }
    } finally {
      setPushBusy(false);
    }
  };

  const toggleSound = (next: boolean) => {
    setSoundOn(next);
    setNotifySoundEnabled(next);
  };

  const handleLogout = () => {
    signOut();
    nav.go("onboarding");
  };

  const unblock = async (hashId: string) => {
    // Optimistic — unblockFriend() rethrows on failure (unlike most of this
    // client's softer mock-fallback calls), so restore the entry if it does.
    const prev = blocked;
    setBlocked((cur) => cur.filter((b) => b.hashId !== hashId));
    if (!real) return;
    try {
      await getCompanionClient().unblockFriend(hashId);
    } catch {
      setBlocked(prev);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-1 px-3 pb-2 pt-4">
        <button
          type="button"
          onClick={() => nav.back()}
          aria-label="Назад"
          className="grid size-9 place-items-center rounded-full text-foreground transition-transform active:scale-95"
        >
          <ChevronLeftIcon className="size-6" />
        </button>
        <h1 className="text-2xl font-bold">Настройки</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {/* Change nick */}
        <section className="mt-2 rounded-2xl border border-border bg-card p-4">
          <label className="block">
            <span className="text-xs text-muted-foreground">Сменить ник</span>
            <input
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              placeholder="Новый ник"
              className="mt-1 w-full rounded-xl border border-transparent bg-muted px-3 py-2.5 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2"
            />
          </label>
          <button
            type="button"
            onClick={saveNick}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2.5 font-semibold text-primary-foreground transition-transform active:scale-95"
          >
            {savedNick ? (
              <>
                <CheckIcon className="size-5" />
                Сохранено
              </>
            ) : (
              "Сохранить"
            )}
          </button>
        </section>

        {/* Change password */}
        <section className="mt-4 rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold">Сменить пароль</p>
          <div className="mt-2 flex flex-col gap-2">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Текущий пароль"
              autoComplete="current-password"
              className="w-full rounded-xl border border-transparent bg-muted px-3 py-2.5 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Новый пароль (мин. 6 символов)"
              autoComplete="new-password"
              className="w-full rounded-xl border border-transparent bg-muted px-3 py-2.5 text-foreground outline-none ring-primary/40 transition-shadow placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Повторите новый пароль"
              autoComplete="new-password"
              className={`w-full rounded-xl border border-transparent bg-muted px-3 py-2.5 text-foreground outline-none transition-shadow placeholder:text-muted-foreground/60 ${
                passwordMismatch
                  ? "ring-1 ring-destructive"
                  : "ring-primary/40 focus:border-primary focus:ring-2"
              }`}
            />
            {passwordMismatch && (
              <p className="px-1 text-xs text-destructive">Пароли не совпадают</p>
            )}
            {passwordError && <p className="px-1 text-xs text-destructive">{passwordError}</p>}
          </div>
          <button
            type="button"
            disabled={!canSavePassword || passwordBusy}
            onClick={handleChangePassword}
            className={`mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2.5 font-semibold text-primary-foreground transition-transform active:scale-95 ${
              !canSavePassword || passwordBusy ? "cursor-not-allowed opacity-50" : ""
            }`}
          >
            {passwordSaved ? (
              <>
                <CheckIcon className="size-5" />
                Сохранено
              </>
            ) : passwordBusy ? (
              "Сохраняем…"
            ) : (
              "Сменить пароль"
            )}
          </button>
        </section>

        {/* Notifications toggle */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <BellIcon className="size-5 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p>Уведомления</p>
              <p className="text-xs text-muted-foreground">
                {!pushCapable
                  ? "Не поддерживается этим браузером"
                  : pushBusy
                    ? "Подключаем…"
                    : push
                      ? "Пуши включены"
                      : "Пуши выключены"}
              </p>
            </div>
            {pushCapable && (
              <Switch checked={push} onChange={(v) => void togglePush(v)} label="Уведомления" />
            )}
          </div>
          <div className="border-t border-border" />
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <BellIcon className="size-5 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p>Звук и вибрация</p>
              <p className="text-xs text-muted-foreground">
                Новые сообщения, совпадения, заявки в друзья
              </p>
            </div>
            <Switch checked={soundOn} onChange={toggleSound} label="Звук и вибрация" />
          </div>
        </div>

        {/* Blocked — expandable */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          {/* `active:` matters more than `hover:` here — the app is mobile-first
              and a touch screen has no hover at all, so without it a tap gets no
              feedback at all. Same pair as AnoonNotifications' feed rows. */}
          <button
            type="button"
            onClick={() => setBlockedOpen((o) => !o)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted active:bg-muted"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <BlockIcon className="size-5 text-primary-foreground" />
            </div>
            <span className="min-w-0 flex-1">Заблокированные</span>
            <span className="text-sm text-muted-foreground">
              {blocksFailed ? "—" : blocked.length}
            </span>
            <ChevronRightIcon
              className={`size-4 text-muted-foreground transition-transform ${
                blockedOpen ? "rotate-90" : ""
              }`}
            />
          </button>

          {blockedOpen && (
            <div className="border-t border-border animate-in slide-in-from-top-2 fade-in-0 duration-200 motion-reduce:animate-none">
              {blocksFailed ? (
                <p className="px-4 py-4 text-center text-sm text-destructive">
                  Не удалось загрузить список. Откройте экран заново
                </p>
              ) : blocked.length === 0 ? (
                <p className="px-4 py-4 text-center text-sm text-muted-foreground">
                  Список пуст
                </p>
              ) : (
                blocked.map((b) => (
                  <div
                    key={b.hashId}
                    className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
                  >
                    <AnoonAvatar initials="?" tone={toneFor(b.hashId)} size={32} />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm">
                      {b.displayName || `Собеседник #${b.hashId}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => void unblock(b.hashId)}
                      className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium transition-transform active:scale-95"
                    >
                      Разблокировать
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/*
          Moderation states — demo entries. There's no companion ban/mute
          event yet, so these screens have no real trigger; kept reachable
          here for QA until that lands.
        */}
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <Row
            icon={<ShieldIcon className="size-5 text-primary-foreground" />}
            label="Экран блокировки (демо)"
            onClick={() => nav.push("banned")}
          />
          <div className="border-t border-border" />
          <Row
            icon={<LockIcon className="size-5 text-primary-foreground" />}
            label="Экран мьюта (демо)"
            onClick={() => nav.push("muted")}
          />
        </div>

        {/* Exit — reset profile */}
        <button
          type="button"
          onClick={handleLogout}
          className="mt-4 flex w-full items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10 py-3 font-semibold text-destructive transition-transform active:scale-95"
        >
          Выход
        </button>
        <p className="mt-2 px-2 text-center text-xs text-muted-foreground">
          Профиль будет сброшен на этом устройстве.
        </p>

        {/* Delete account */}
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 py-3 font-semibold text-destructive transition-transform active:scale-95"
        >
          <TrashIcon className="size-5" />
          Удалить аккаунт
        </button>
        <p className="mt-2 px-2 text-center text-xs text-muted-foreground">
          Аккаунт и все данные будут удалены без возможности восстановления.
        </p>
      </div>

      {deleteOpen && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/50 p-5 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
          <div className="w-full max-w-[320px] rounded-2xl border border-border bg-card p-4 shadow-lg animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none">
            <p className="text-sm font-semibold text-foreground">Удалить аккаунт?</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Это необратимо: профиль, друзья и сообщения будут удалены без возможности
              восстановления.
            </p>
            {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setDeleteOpen(false)}
                className="flex-1 rounded-full bg-muted py-2.5 text-sm font-medium text-foreground transition-transform active:scale-95"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={handleDeleteAccount}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-destructive py-2.5 text-sm font-semibold text-white transition-transform active:scale-95"
              >
                {deleteBusy ? "Удаляем…" : "Удалить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    // `active:bg-muted` alongside the hover: on a touch screen there is no
    // hover, so the hover-only version gave a tapped row no feedback at all.
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted active:bg-muted"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary">
        {icon}
      </div>
      <span className="flex-1">{label}</span>
      <ChevronRightIcon className="size-4 text-muted-foreground" />
    </button>
  );
}
