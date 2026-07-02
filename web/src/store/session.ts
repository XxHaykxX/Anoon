"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  completeProfile,
  fetchMyProfile,
  ProfileConflictError,
  upsertProfile,
  type CompleteProfileFields,
} from "@/lib/api";
import { appleEnabled, supabase, supabaseConfigured } from "@/lib/supabase";

// Реальные аккаунты (Google OAuth / email+пароль) + legacy-анон. Действия под аккаунты
// добавлены аддитивно; createProfile-anon оставлен как есть. Профиль резолвится сервером.

// Результат гидрации → куда вести пользователя (gender-gate провайдер-агностичен).
//   "none"    — сессии нет (вести на /register)
//   "confirm" — сессия есть, но пол не залочен → дозаполнить профиль (/register/confirm)
//   "ready"   — полностью онбордён (пол залочен) → в приложение
export type HydrateResult = "none" | "confirm" | "ready";
export type AuthResult = { ok: boolean; error?: string; needsEmailConfirm?: boolean };
export type OAuthProvider = "google" | "apple" | "facebook";
export type Gender = "male" | "female";

type SessionState = {
  hasProfile: boolean;
  nickname: string;
  publicId: string; // напр. 00042
  authUserId?: string; // Supabase auth uuid, если вошли
  synced: boolean; // профиль подтверждён сервером (не мок)
  creating: boolean;
  error?: string;
  // Аккаунт (реальная регистрация) — персистятся, дефолтятся миграцией для старого стора.
  accountType?: string; // провайдер: "google" | "email" | "apple" | "anonymous"
  email?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  gender?: Gender;
  genderLocked: boolean; // пол выбран и зафиксирован навсегда
  banned: boolean; // забанен (сервер-авторитетно, из heartbeat) — не персистим
  banReason?: string;
  banUntil?: string | null;
  muted: boolean; // замьючен (не может писать, может читать) — из heartbeat, не персистим
  muteReason?: string;
  muteUntil?: string | null;
  createProfile: (nickname: string) => Promise<void>;
  ensureProfile: () => Promise<void>; // до-синхронизировать профиль, если синк не прошёл
  // Реальная авторизация:
  signInWithOAuth: (provider: OAuthProvider) => Promise<AuthResult>;
  signUpEmail: (args: { email: string; password: string; firstName?: string; lastName?: string; gender?: Gender }) => Promise<AuthResult>;
  signInEmail: (email: string, password: string) => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (newPassword: string) => Promise<AuthResult>;
  completeAccountProfile: (fields: CompleteProfileFields) => Promise<AuthResult>;
  hydrateFromSession: () => Promise<HydrateResult>;
  setBan: (banned: boolean, reason?: string | null, until?: string | null) => void;
  setMute: (muted: boolean, reason?: string | null, until?: string | null) => void;
  setNickname: (nickname: string) => void;
  reset: () => Promise<void>;
};

function origin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

// full_name из user_metadata → {first, last} для префилла /register/confirm.
function splitName(full: unknown): { first?: string; last?: string } {
  if (typeof full !== "string" || !full.trim()) return {};
  const parts = full.trim().split(/\s+/);
  return { first: parts[0], last: parts.length > 1 ? parts.slice(1).join(" ") : undefined };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "ошибка";
}

function genPublicId(): string {
  // 5-значный #ID (mock-фолбэк). В проде выдаёт сервер.
  const n = Math.floor(Math.random() * 99999) + 1;
  return String(n).padStart(5, "0");
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      hasProfile: false,
      nickname: "",
      publicId: "",
      synced: false,
      creating: false,
      genderLocked: false,
      banned: false,
      muted: false,

      setBan: (banned, reason, until) => set({ banned, banReason: reason ?? undefined, banUntil: until ?? null }),
      setMute: (muted, reason, until) => set({ muted, muteReason: reason ?? undefined, muteUntil: until ?? null }),

      createProfile: async (nickname) => {
        const nick = nickname.trim();
        // Оптимистично: локальный профиль сразу — приложение работает и без бэкенда.
        set({ creating: true, error: undefined, hasProfile: true, nickname: nick, publicId: get().publicId || genPublicId() });
        try {
          if (!supabaseConfigured) throw new Error("supabase not configured");
          const { data, error } = await supabase.auth.signInAnonymously();
          if (error) throw error;
          const token = data.session?.access_token;
          if (!token) throw new Error("no access token");
          const profile = await upsertProfile(nick, token);
          set({ authUserId: data.user?.id, publicId: profile.publicId, nickname: profile.nickname, synced: true });
        } catch (e) {
          // Фолбэк на локальный мок (например, anonymous sign-ins выключен в Supabase).
          set({ synced: false, error: e instanceof Error ? e.message : "auth failed" });
        } finally {
          set({ creating: false });
        }
      },

      // Профиль мог не создаться в БД (сеть/навигация оборвала POST /profile) → synced=false.
      // Тогда бэкенд не резолвит профиль и медиа падает («недоступно»). Досинхронизируем.
      ensureProfile: async () => {
        const s = get();
        if (s.synced || !supabaseConfigured || s.nickname.trim().length < 2) return;
        try {
          let { data } = await supabase.auth.getSession();
          if (!data.session) {
            const res = await supabase.auth.signInAnonymously();
            if (res.error) return;
            data = { session: res.data.session, user: res.data.user } as typeof data;
          }
          const token = data.session?.access_token;
          if (!token) return;
          const profile = await upsertProfile(s.nickname.trim(), token);
          set({ authUserId: data.session?.user?.id, publicId: profile.publicId, nickname: profile.nickname, synced: true });
        } catch {
          // молча — останемся в несинхр. состоянии, повторим позже
        }
      },

      // --- Реальная авторизация ---

      // OAuth-редирект: Supabase уводит на провайдера и возвращает на /auth/callback
      // (PKCE авто-обмен по detectSessionInUrl). Apple — только при NEXT_PUBLIC_APPLE_ENABLED.
      signInWithOAuth: async (provider) => {
        if (!supabaseConfigured) return { ok: false, error: "supabase not configured" };
        if (provider === "apple" && !appleEnabled) return { ok: false, error: "apple disabled" };
        set({ error: undefined });
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: `${origin()}/auth/callback` },
        });
        if (error) {
          set({ error: error.message });
          return { ok: false, error: error.message };
        }
        return { ok: true }; // дальше браузер уходит на редирект
      },

      // Регистрация по email. Подтверждение email включено → session обычно null до клика в письме.
      signUpEmail: async ({ email, password, firstName, lastName, gender }) => {
        if (!supabaseConfigured) return { ok: false, error: "supabase not configured" };
        set({ error: undefined });
        try {
          const full = [firstName, lastName].filter(Boolean).join(" ").trim();
          const { data, error } = await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
              emailRedirectTo: `${origin()}/auth/callback`,
              data: { full_name: full || undefined, gender: gender || undefined },
            },
          });
          if (error) throw error;
          set({ email: email.trim(), accountType: "email", firstName, lastName, gender });
          // Нет session → нужно подтвердить email (identities заполнены, но пользователь ещё не верифицирован).
          const needsEmailConfirm = !data.session;
          return { ok: true, needsEmailConfirm };
        } catch (e) {
          const error = errMsg(e);
          set({ error });
          return { ok: false, error };
        }
      },

      signInEmail: async (email, password) => {
        if (!supabaseConfigured) return { ok: false, error: "supabase not configured" };
        set({ error: undefined });
        try {
          const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
          if (error) throw error;
          await get().hydrateFromSession();
          return { ok: true };
        } catch (e) {
          const error = errMsg(e);
          set({ error });
          return { ok: false, error };
        }
      },

      requestPasswordReset: async (email) => {
        if (!supabaseConfigured) return { ok: false, error: "supabase not configured" };
        set({ error: undefined });
        try {
          const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: `${origin()}/recover/reset`,
          });
          if (error) throw error;
          return { ok: true };
        } catch (e) {
          const error = errMsg(e);
          set({ error });
          return { ok: false, error };
        }
      },

      // Вызывается на /recover/reset — сессия восстановлена из recovery-ссылки (PKCE).
      updatePassword: async (newPassword) => {
        if (!supabaseConfigured) return { ok: false, error: "supabase not configured" };
        set({ error: undefined });
        try {
          const { error } = await supabase.auth.updateUser({ password: newPassword });
          if (error) throw error;
          return { ok: true };
        } catch (e) {
          const error = errMsg(e);
          set({ error });
          return { ok: false, error };
        }
      },

      // Дозаполнить профиль (пол лочится на сервере). POST /api/profile → 409 при смене залоченного пола.
      completeAccountProfile: async (fields) => {
        if (!supabaseConfigured) return { ok: false, error: "supabase not configured" };
        set({ error: undefined });
        try {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (!token) throw new Error("нет активной сессии");
          const saved = await completeProfile(fields, token);
          set({
            hasProfile: true,
            synced: true,
            publicId: saved.publicId,
            nickname: saved.nickname,
            firstName: fields.firstName || get().firstName,
            lastName: fields.lastName ?? get().lastName,
            avatarUrl: fields.avatarUrl ?? get().avatarUrl,
            gender: fields.gender,
            genderLocked: true,
          });
          return { ok: true };
        } catch (e) {
          const error = e instanceof ProfileConflictError ? "Пол уже зафиксирован и не меняется" : errMsg(e);
          set({ error });
          return { ok: false, error };
        }
      },

      // Гидрация из Supabase-сессии: getSession → GET /api/profile/me → state.
      // Провайдер-агностичный gender-gate: genderLocked=false → "confirm" (для ЛЮБОГО провайдера,
      // т.к. OAuth не даёт пол). Возвращает целевой маршрут; редирект делает вызывающий (callback/gate).
      hydrateFromSession: async () => {
        if (!supabaseConfigured) return "none";
        try {
          const { data } = await supabase.auth.getSession();
          const session = data.session;
          if (!session) return "none";
          const user = session.user;
          const token = session.access_token;
          const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
          const provider = (user.app_metadata?.provider as string | undefined) ?? "email";
          const nameFromMeta = splitName(meta.full_name ?? meta.name);
          const avatarFromMeta =
            typeof meta.avatar_url === "string" ? meta.avatar_url
            : typeof meta.picture === "string" ? meta.picture
            : undefined;

          const profile = await fetchMyProfile(token); // null → профиля ещё нет
          const genderLocked = Boolean(profile?.genderLocked);

          set({
            authUserId: user.id,
            email: user.email ?? get().email,
            accountType: provider,
            publicId: profile?.publicId ?? get().publicId,
            nickname: profile?.nickname ?? get().nickname,
            // Префилл: реальные поля профиля приоритетнее, иначе метаданные провайдера.
            firstName: profile?.firstName ?? get().firstName ?? nameFromMeta.first,
            lastName: profile?.lastName ?? get().lastName ?? nameFromMeta.last,
            avatarUrl: profile?.avatarUrl ?? get().avatarUrl ?? avatarFromMeta,
            gender: (profile?.gender === "male" || profile?.gender === "female" ? profile.gender : get().gender),
            genderLocked,
            // Полностью онбордён только когда пол зафиксирован — иначе гейт ведёт на confirm.
            hasProfile: Boolean(profile) && genderLocked,
            synced: Boolean(profile),
          });
          return genderLocked ? "ready" : "confirm";
        } catch {
          return "none";
        }
      },

      setNickname: (nickname) => set({ nickname: nickname.trim() }),

      reset: async () => {
        try {
          if (supabaseConfigured) await supabase.auth.signOut();
        } catch {
          // игнор — локальный сброс важнее
        }
        set({
          hasProfile: false, nickname: "", publicId: "", authUserId: undefined, synced: false, error: undefined,
          accountType: undefined, email: undefined, firstName: undefined, lastName: undefined,
          avatarUrl: undefined, gender: undefined, genderLocked: false,
        });
      },
    }),
    {
      name: "anoon-session",
      version: 1,
      // Старый persist (v0) не знал полей аккаунта — дефолтим их, ничего не ломая.
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<SessionState>;
        return {
          hasProfile: s.hasProfile ?? false,
          nickname: s.nickname ?? "",
          publicId: s.publicId ?? "",
          authUserId: s.authUserId,
          synced: s.synced ?? false,
          accountType: version < 1 ? s.accountType ?? "anonymous" : s.accountType,
          email: s.email,
          firstName: s.firstName,
          lastName: s.lastName,
          avatarUrl: s.avatarUrl,
          gender: s.gender,
          genderLocked: s.genderLocked ?? false,
        };
      },
      partialize: (s) => ({
        hasProfile: s.hasProfile,
        nickname: s.nickname,
        publicId: s.publicId,
        authUserId: s.authUserId,
        synced: s.synced,
        accountType: s.accountType,
        email: s.email,
        firstName: s.firstName,
        lastName: s.lastName,
        avatarUrl: s.avatarUrl,
        gender: s.gender,
        genderLocked: s.genderLocked,
      }),
    },
  ),
);
