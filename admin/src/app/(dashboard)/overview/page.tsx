"use client";

import { useList } from "@refinedev/core";
import { motion } from "framer-motion";
import { Ban, Flag, TrendingUp, Users, Wifi } from "lucide-react";

import type { BanRow, ProfileRow, ReportRow } from "@/data/fixtures";
import { useCanHover } from "@/lib/use-can-hover";

type StatDef = {
  label: string;
  value: number;
  icon: typeof Users;
  trend?: string; // мок мини-тренд (в проде — из агрегатов)
  tone?: "accent" | "success" | "danger";
};

function StatCard({ stat, index, canHover }: { stat: StatDef; index: number; canHover: boolean }) {
  const toneText = stat.tone === "danger" ? "text-danger" : stat.tone === "success" ? "text-success" : "text-accent";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut", delay: index * 0.05 }}
      whileHover={canHover ? { scale: 1.02 } : undefined}
      className="rounded-xl border border-border bg-surface-1 p-5 transition-colors hover:border-accent/40"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-muted">{stat.label}</p>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 ${toneText}`}>
          <stat.icon size={16} />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{stat.value.toLocaleString("ru-RU")}</p>
      {stat.trend && (
        <p className="mt-1 flex items-center gap-1 text-xs text-fg-muted">
          <TrendingUp size={12} className="text-success" /> {stat.trend}
        </p>
      )}
    </motion.div>
  );
}

export default function OverviewPage() {
  const canHover = useCanHover();
  const users = useList<ProfileRow>({ resource: "users", pagination: { mode: "off" } });
  const reports = useList<ReportRow>({ resource: "reports", pagination: { mode: "off" } });
  const bans = useList<BanRow>({ resource: "bans", pagination: { mode: "off" } });

  const u = users.result?.data ?? [];
  const r = reports.result?.data ?? [];
  const b = bans.result?.data ?? [];

  const stats: StatDef[] = [
    { label: "Всего пользователей", value: u.length, icon: Users, trend: "+12 за 24ч", tone: "accent" },
    { label: "Онлайн сейчас", value: u.filter((x) => x.online).length, icon: Wifi, tone: "success" },
    { label: "Жалоб открыто", value: r.filter((x) => x.status === "open").length, icon: Flag, trend: "+3 за 24ч", tone: "danger" },
    { label: "Активных банов", value: b.filter((x) => x.state === "active").length, icon: Ban, tone: "danger" },
  ];

  return (
    <div>
      <h1 className="mb-5 text-xl font-semibold">Обзор</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s, i) => (
          <StatCard key={s.label} stat={s} index={i} canHover={canHover} />
        ))}
      </div>
    </div>
  );
}
