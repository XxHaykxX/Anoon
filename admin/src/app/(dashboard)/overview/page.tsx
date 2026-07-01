"use client";

import { useList } from "@refinedev/core";
import { motion } from "framer-motion";
import { Ban, Flag, TrendingUp, Users, Wifi } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

import type { BanRow, ProfileRow, ReportRow } from "@/data/fixtures";
import { useCanHover } from "@/lib/use-can-hover";
import { cn } from "@/lib/utils";

type Overview = {
  total: number;
  online: number;
  onlineFemale: number;
  onlineMale: number;
  onlineOther: number;
  reportsOpen: number;
  bansActive: number;
};

type StatDef = {
  label: string;
  value: number;
  icon: typeof Users;
  sub?: ReactNode; // подпись под числом (напр. разбивка по полу)
  href?: string; // кликабельная карточка → переход
  tone?: "accent" | "success" | "danger";
};

function StatCard({ stat, index, canHover }: { stat: StatDef; index: number; canHover: boolean }) {
  const toneText = stat.tone === "danger" ? "text-danger" : stat.tone === "success" ? "text-success" : "text-accent";
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-muted">{stat.label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2", toneText)}>
          <stat.icon size={16} />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{stat.value.toLocaleString("ru-RU")}</p>
      {stat.sub && (
        <div className="mt-1.5 flex items-center gap-1 text-sm text-fg-muted">
          {stat.tone === "accent" && <TrendingUp size={12} className="text-success" />}
          {stat.sub}
        </div>
      )}
    </>
  );

  const cls = cn(
    "block rounded-xl border border-border bg-surface-1 p-5 transition-colors hover:border-accent/40",
    stat.href && "cursor-pointer",
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut", delay: index * 0.05 }}
      whileHover={canHover ? { scale: 1.02 } : undefined}
    >
      {stat.href ? (
        <Link href={stat.href} className={cls}>
          {inner}
        </Link>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </motion.div>
  );
}

export default function OverviewPage() {
  const canHover = useCanHover();
  const [ov, setOv] = useState<Overview | null>(null);

  // Реальная сводка (api-режим). Обновляем каждые 20с (near-live онлайн).
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/admin/overview")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && !d.error && setOv(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Фолбэк на refine-данные (mock-режим или пока грузится api).
  const users = useList<ProfileRow>({ resource: "users", pagination: { mode: "off" } });
  const reports = useList<ReportRow>({ resource: "reports", pagination: { mode: "off" } });
  const bans = useList<BanRow>({ resource: "bans", pagination: { mode: "off" } });
  const u = users.result?.data ?? [];
  const r = reports.result?.data ?? [];
  const b = bans.result?.data ?? [];

  const total = ov?.total ?? u.length;
  const online = ov?.online ?? u.filter((x) => x.online).length;
  const reportsOpen = ov?.reportsOpen ?? r.filter((x) => x.status === "open").length;
  const bansActive = ov?.bansActive ?? b.filter((x) => x.state === "active").length;
  // Разбивка онлайн по полу — крупнее, иконка + число (ж/м) прямо на карте «Онлайн сейчас».
  const onlineSub = ov ? (
    <span className="flex items-center gap-3">
      <span className="flex items-center gap-1">
        <span className="text-base leading-none">👧</span>
        <b className="tabular-nums text-fg">{ov.onlineFemale}</b>
      </span>
      <span className="flex items-center gap-1">
        <span className="text-base leading-none">👦</span>
        <b className="tabular-nums text-fg">{ov.onlineMale}</b>
      </span>
    </span>
  ) : undefined;

  const stats: StatDef[] = [
    { label: "Всего пользователей", value: total, icon: Users, tone: "accent", href: "/users" },
    { label: "Онлайн сейчас", value: online, icon: Wifi, tone: "success", sub: onlineSub, href: "/online" },
    { label: "Жалоб открыто", value: reportsOpen, icon: Flag, tone: "danger", href: "/reports" },
    { label: "Активных банов", value: bansActive, icon: Ban, tone: "danger", href: "/bans" },
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
