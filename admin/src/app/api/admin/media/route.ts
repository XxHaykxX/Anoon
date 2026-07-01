/* eslint-disable @typescript-eslint/no-explicit-any -- граница нетипизированного Supabase */
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const BUCKET = "media";

// GET /api/admin/media — папки (профили с медиа) + счётчики.
// GET /api/admin/media?profileId=... — файлы профиля со signed URL (галерея).
// GET /api/admin/media?all=1 — общая галерея: все медиа всех юзеров + #ID на тайлах (без папок).
// Защищено proxy (default-deny) при NEXT_PUBLIC_DATA_MODE=api.
// Границы диапазона дат из query (?from=YYYY-MM-DD&to=YYYY-MM-DD). `to` — включительно (до конца дня).
function dateRange(sp: URLSearchParams): { fromISO?: string; toISO?: string } {
  const from = sp.get("from");
  const to = sp.get("to");
  const out: { fromISO?: string; toISO?: string } = {};
  if (from) out.fromISO = new Date(`${from}T00:00:00.000Z`).toISOString();
  if (to) {
    const d = new Date(`${to}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1); // включительно: < следующего дня
    out.toISO = d.toISOString();
  }
  return out;
}

export async function GET(req: Request) {
  const admin = supabaseAdmin();
  const url = new URL(req.url);
  const sp = url.searchParams;
  const profileId = sp.get("profileId");
  const all = sp.get("all");
  const { fromISO, toISO } = dateRange(sp);
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(120, Math.max(1, Number(sp.get("pageSize")) || 60));
  const kind = sp.get("kind"); // image | video | (пусто = все)

  try {
    if (all) {
      // Все медиа (свежие сверху) + серверная пагинация/фильтр даты/типа. #ID владельца на тайле.
      let q = admin
        .from("MediaAsset")
        .select("id,ownerProfileId,r2Key,mime,kind,durationMs,ephemeral,expiresAt,deletedAt,createdAt", { count: "exact" })
        .order("createdAt", { ascending: false });
      if (fromISO) q = q.gte("createdAt", fromISO);
      if (toISO) q = q.lt("createdAt", toISO);
      if (kind === "image" || kind === "video") q = q.eq("kind", kind);
      q = q.range((page - 1) * pageSize, page * pageSize - 1);
      const { data: rows, count } = await q;
      const list = (rows ?? []) as Array<any>;
      const ownerIds = [...new Set(list.map((m) => m.ownerProfileId))];
      const { data: profs } = ownerIds.length
        ? await admin.from("Profile").select("id,publicId").in("id", ownerIds)
        : { data: [] };
      const pubById = new Map((profs ?? []).map((p: any) => [p.id, p.publicId]));

      const live = list.filter((m) => !m.deletedAt).map((m) => m.r2Key);
      const urlByKey = new Map<string, string>();
      await Promise.all(
        live.map(async (key) => {
          const { data } = await admin.storage.from(BUCKET).createSignedUrl(key, 3600);
          if (data?.signedUrl) urlByKey.set(key, data.signedUrl);
        }),
      );

      const files = list.map((m) => ({
        id: m.id,
        ownerProfileId: m.ownerProfileId,
        ownerBadge: `#${pubById.get(m.ownerProfileId) ?? "?????"}`,
        kind: m.kind === "video" ? "video" : "image",
        url: m.deletedAt ? "" : urlByKey.get(m.r2Key) ?? "",
        mime: m.mime,
        durationMs: m.durationMs ?? undefined,
        ephemeral: m.ephemeral,
        expiresAt: m.expiresAt ?? null,
        deletedAt: m.deletedAt ?? null,
        escalated: false,
        createdAt: m.createdAt,
      }));
      return NextResponse.json({ files, total: count ?? files.length, page, pageSize });
    }

    if (!profileId) {
      // Папки: группируем MediaAsset по владельцу.
      const { data: assets } = await admin.from("MediaAsset").select("ownerProfileId,kind");
      const rows = (assets ?? []) as Array<{ ownerProfileId: string; kind: string }>;
      const byOwner = new Map<string, { images: number; videos: number }>();
      for (const a of rows) {
        const e = byOwner.get(a.ownerProfileId) ?? { images: 0, videos: 0 };
        if (a.kind === "video") e.videos++;
        else e.images++;
        byOwner.set(a.ownerProfileId, e);
      }
      const ids = [...byOwner.keys()];
      const { data: profs } = ids.length
        ? await admin.from("Profile").select("id,nickname,publicId").in("id", ids)
        : { data: [] };
      const pmap = new Map((profs ?? []).map((p: any) => [p.id, p]));
      const folders = ids.map((id) => ({
        profileId: id,
        nickname: pmap.get(id)?.nickname ?? "—",
        publicId: pmap.get(id)?.publicId ?? "",
        images: byOwner.get(id)!.images,
        videos: byOwner.get(id)!.videos,
        count: byOwner.get(id)!.images + byOwner.get(id)!.videos,
      }));
      folders.sort((a, b) => b.count - a.count);
      return NextResponse.json({ folders });
    }

    // Файлы профиля (+ фильтр даты/типа + пагинация).
    let fq = admin
      .from("MediaAsset")
      .select("id,r2Key,mime,kind,durationMs,ephemeral,expiresAt,deletedAt,createdAt", { count: "exact" })
      .eq("ownerProfileId", profileId)
      .order("createdAt", { ascending: false });
    if (fromISO) fq = fq.gte("createdAt", fromISO);
    if (toISO) fq = fq.lt("createdAt", toISO);
    if (kind === "image" || kind === "video") fq = fq.eq("kind", kind);
    fq = fq.range((page - 1) * pageSize, page * pageSize - 1);
    const { data: rows, count } = await fq;
    const list = (rows ?? []) as Array<any>;

    // Signed URL для не-удалённых.
    const live = list.filter((m) => !m.deletedAt).map((m) => m.r2Key);
    const urlByKey = new Map<string, string>();
    await Promise.all(
      live.map(async (key) => {
        const { data } = await admin.storage.from(BUCKET).createSignedUrl(key, 3600);
        if (data?.signedUrl) urlByKey.set(key, data.signedUrl);
      }),
    );

    const files = list.map((m) => ({
      id: m.id,
      ownerProfileId: profileId,
      kind: m.kind === "video" ? "video" : "image",
      url: m.deletedAt ? "" : urlByKey.get(m.r2Key) ?? "",
      mime: m.mime,
      durationMs: m.durationMs ?? undefined,
      ephemeral: m.ephemeral,
      expiresAt: m.expiresAt ?? null,
      deletedAt: m.deletedAt ?? null,
      escalated: false,
      createdAt: m.createdAt,
    }));
    return NextResponse.json({ files, total: count ?? files.length, page, pageSize });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 400 });
  }
}
