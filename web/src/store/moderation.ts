"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { sendBlock, sendReport } from "@/lib/api";
import { supabase, supabaseConfigured } from "@/lib/supabase";

// Отправить модерацию на backend, если есть авторизованная сессия (иначе только локально).
async function withToken(fn: (token: string) => Promise<void>): Promise<void> {
  if (!supabaseConfigured) return;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) await fn(token).catch(() => {});
}

// Мок-стор модерации (блок/жалоба). Persist в localStorage.
// TODO(backend): при подключении WS/API отправлять block/report на сервер и
// синхронизировать со схемой `packages/db` (Block/Report), которую шарим с админкой.
export type ReportReason = "spam" | "harassment" | "explicit" | "underage" | "scam" | "other";

export type Report = {
  id: string;
  peer: string;
  reason: ReportReason;
  comment?: string;
  at: number;
};

type ModerationState = {
  blocked: Record<string, true>;
  reports: Report[];
  isBlocked: (peer: string) => boolean;
  blockPeer: (peer: string) => void;
  unblockPeer: (peer: string) => void;
  reportPeer: (peer: string, reason: ReportReason, comment?: string) => void;
};

export const useModeration = create<ModerationState>()(
  persist(
    (set, get) => ({
      blocked: {},
      reports: [],

      isBlocked: (peer) => !!get().blocked[peer],

      blockPeer: (peer) => {
        set((s) => ({ blocked: { ...s.blocked, [peer]: true } }));
        void withToken((t) => sendBlock(peer, t)); // при авторизации → в БД (Block)
      },

      unblockPeer: (peer) => {
        // TODO(backend): DELETE /api/moderation/block { peer }
        set((s) => {
          const next = { ...s.blocked };
          delete next[peer];
          return { blocked: next };
        });
      },

      reportPeer: (peer, reason, comment) => {
        const report: Report = {
          id: `r${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
          peer,
          reason,
          comment,
          at: Date.now(),
        };
        set((s) => ({ reports: [...s.reports, report] }));
        void withToken((t) => sendReport(peer, reason, comment, t)); // при авторизации → в БД (Report)
      },
    }),
    { name: "anoon-moderation" },
  ),
);
