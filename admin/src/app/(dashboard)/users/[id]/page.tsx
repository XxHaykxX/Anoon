"use client";

import { useList, useOne, usePermissions, useUpdate } from "@refinedev/core";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { BanDialog, type BanTarget } from "@/components/ban-dialog";
import { MuteDialog, type MuteTarget } from "@/components/mute-dialog";
import { MediaGallery } from "@/components/media-gallery";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import type { MediaAssetRow, ProfileRow } from "@/data/fixtures";
import { addAction } from "@/lib/audit";

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const { result: user, query } = useOne<ProfileRow>({ resource: "users", id });
  const { result: mediaRes } = useList<MediaAssetRow>({
    resource: "media",
    filters: [{ field: "ownerProfileId", operator: "eq", value: id }],
    pagination: { mode: "off" },
  });
  const { mutate: update } = useUpdate();
  const { data: role } = usePermissions<string>({});
  const isSuper = role === "super_admin";
  const [banOpen, setBanOpen] = useState<BanTarget | null>(null);
  const [muteOpen, setMuteOpen] = useState<MuteTarget | null>(null);

  const u = user;
  const media = mediaRes?.data ?? [];

  if (query.isLoading) return <div className="text-sm text-fg-muted">Загрузка…</div>;
  if (!u) return <div className="text-sm text-fg-muted">Пользователь не найден</div>;

  const ownerLabel = `${u.nickname} #${u.publicId}`;

  return (
    <div>
      <Link href="/users" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-secondary transition hover:text-fg">
        <ArrowLeft size={16} /> К списку
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-3xl">{u.emoji}</span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{u.nickname}</h1>
          <span className="font-mono text-xs text-fg-muted">#{u.publicId}</span>
        </div>
        <div className="ml-1 flex items-center gap-2">
          {u.banned ? <Badge tone="danger">Забанен</Badge> : u.online ? <Badge tone="success">Онлайн</Badge> : <Badge>Оффлайн</Badge>}
          {u.reportCount > 0 && <Badge tone="warning">{u.reportCount} жалоб</Badge>}
        </div>
        {!u.banned && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setMuteOpen({ nickname: u.nickname, publicId: u.publicId })}
              className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium text-fg-secondary transition hover:text-fg"
            >
              Замьютить
            </button>
            <button
              onClick={() => setBanOpen({ nickname: u.nickname, publicId: u.publicId })}
              className="rounded-lg bg-danger/15 px-3 py-1.5 text-sm font-medium text-danger transition hover:bg-danger/25"
            >
              Забанить
            </button>
          </div>
        )}
      </div>

      {/* Приватность: переписка НЕ показывается (безопасный дефолт для анонимного чата). */}
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-border bg-surface-1 p-3 text-xs text-fg-muted">
        <Lock size={14} className="mt-0.5 shrink-0" />
        <span>
          Личная переписка доступна в разделе «Чаты». Здесь — медиа пользователя для ревью.
        </span>
      </div>

      <h2 className="mb-3 text-sm font-semibold text-fg-secondary">Медиа пользователя</h2>
      <MediaGallery media={media} ownerLabel={ownerLabel} ownerBadge={`#${u.publicId}`} noBlur />

      <BanDialog
        target={banOpen}
        allowPermanent={isSuper}
        onClose={() => setBanOpen(null)}
        onConfirm={(res) => {
          const expiresAt = res.expiresDays ? new Date(Date.now() + res.expiresDays * 86400_000).toISOString() : null;
          update({ resource: "users", id: u.id, values: { banned: true, reason: res.reason || undefined, expiresAt } });
          addAction({ type: "ban", target: ownerLabel, reason: `${res.reason} · ${res.durationLabel}` });
          toast(`Забанен: ${u.nickname}`, "danger");
          setBanOpen(null);
        }}
      />

      <MuteDialog
        target={muteOpen}
        onClose={() => setMuteOpen(null)}
        onConfirm={(res) => {
          const mutedUntil = new Date(Date.now() + res.hours * 3600_000).toISOString();
          update({ resource: "users", id: u.id, values: { muted: true, muteReason: res.reason || undefined, mutedUntil } });
          addAction({ type: "ban", target: ownerLabel, reason: `Мут ${res.durationLabel}: ${res.reason}` });
          toast(`Замьючен: ${u.nickname} (${res.durationLabel})`);
          setMuteOpen(null);
        }}
      />
    </div>
  );
}
