/* eslint-disable @typescript-eslint/no-explicit-any -- граница нетипизированного Supabase */
import { NextResponse } from "next/server";

import { media as mediaFixtures, profiles } from "@/data/fixtures";
import { companionEnabled, companionMediaFiles, companionMediaFolders } from "@/lib/companion-client";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const BUCKET = "media";
// companion хранит media_assets (миграция 0007) и отдаёт GET /admin/media(/folders) — см.
// COMPANION-ADMIN-API.md §4. Когда ADMIN_BACKEND=companion, читаем оттуда (без подписанных
// URL — companion отдаёт url как есть); иначе (по умолчанию) остаёмся на Supabase Storage.
const MOCK = process.env.NEXT_PUBLIC_DATA_MODE !== "api";

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

type MediaFilter = { fromISO?: string; toISO?: string; kind: string | null; page: number; pageSize: number };

function filterMedia(rows: typeof mediaFixtures, f: MediaFilter) {
  let list = rows;
  if (f.fromISO) list = list.filter((m) => m.createdAt >= f.fromISO!);
  if (f.toISO) list = list.filter((m) => m.createdAt < f.toISO!);
  if (f.kind === "image" || f.kind === "video") list = list.filter((m) => m.kind === f.kind);
  list = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const total = list.length;
  const page = list.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
  return { page, total };
}

function mockFolders() {
  const byOwner = new Map<string, { images: number; videos: number }>();
  for (const m of mediaFixtures) {
    const e = byOwner.get(m.ownerProfileId) ?? { images: 0, videos: 0 };
    if (m.kind === "video") e.videos++;
    else e.images++;
    byOwner.set(m.ownerProfileId, e);
  }
  const folders = [...byOwner.entries()]
    .map(([profileId, counts]) => {
      const p = profiles.find((x) => x.id === profileId);
      return { profileId, nickname: p?.nickname ?? "—", publicId: p?.publicId ?? "", images: counts.images, videos: counts.videos, count: counts.images + counts.videos };
    })
    .sort((a, b) => b.count - a.count);
  return NextResponse.json({ folders });
}

function mockFiles(rows: typeof mediaFixtures, f: MediaFilter) {
  const { page, total } = filterMedia(rows, f);
  const files = page.map((m) => ({ ...m, ownerBadge: `#${profiles.find((p) => p.id === m.ownerProfileId)?.publicId ?? "?????"}` }));
  return NextResponse.json({ files, total, page: f.page, pageSize: f.pageSize });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  // Два разных вызывающих с двумя разными контрактами на одном URL:
  //
  //  - страницы «Файлы»/«Галерея» ходят сюда сами и ждут {folders} / {files,total};
  //  - Refine (`useList({resource:"media"})` на карточке пользователя и в
  //    жалобах) идёт через общий dataProvider, шлёт фильтр как `f_ownerProfileId`
  //    и ждёт {data,total}.
  //
  // Второго тут не было вовсе: Refine получал {folders}, читал из ответа
  // несуществующее `data`, и блок «Медиа пользователя» на карточке был ПУСТ у
  // любого пользователя — при 69 файлах в companion (проверено живьём).
  // `profileId` (свой формат) и `f_ownerProfileId` (формат dataProvider) — это
  // один и тот же фильтр, различается только тем, кто спрашивает.
  const refineStyle = sp.has("f_ownerProfileId") || sp.has("ids");
  const profileId = sp.get("profileId") ?? sp.get("f_ownerProfileId");
  const all = sp.get("all");
  const { fromISO, toISO } = dateRange(sp);
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(120, Math.max(1, Number(sp.get("pageSize")) || 60));
  const kind = sp.get("kind"); // image | video | (пусто = все)

  if (MOCK) {
    const f: MediaFilter = { fromISO, toISO, kind, page, pageSize };
    if (refineStyle) {
      const rows = profileId ? mediaFixtures.filter((m) => m.ownerProfileId === profileId) : mediaFixtures;
      const { page: rowsPage, total } = filterMedia(rows, f);
      return NextResponse.json({ data: rowsPage, total });
    }
    if (all) return mockFiles(mediaFixtures, f);
    if (!profileId) return mockFolders();
    return mockFiles(mediaFixtures.filter((m) => m.ownerProfileId === profileId), f);
  }

  if (companionEnabled()) {
    try {
      if (refineStyle) {
        const { data, total } = await companionMediaFiles({
          ownerId: profileId ?? undefined,
          kind,
          from: fromISO,
          to: toISO,
          page,
          pageSize,
        });
        return NextResponse.json({ data, total });
      }
      if (all) {
        const { data, total } = await companionMediaFiles({ kind, from: fromISO, to: toISO, page, pageSize });
        return NextResponse.json({ files: data, total, page, pageSize });
      }
      if (!profileId) {
        const { folders } = await companionMediaFolders();
        return NextResponse.json({ folders });
      }
      const { data, total } = await companionMediaFiles({ ownerId: profileId, kind, from: fromISO, to: toISO, page, pageSize });
      return NextResponse.json({ files: data, total, page, pageSize });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "companion недоступен" }, { status: 502 });
    }
  }

  const admin = supabaseAdmin();

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
    // Same two contracts as the companion branch above — Refine wants {data,total}.
    if (refineStyle) return NextResponse.json({ data: files, total: count ?? files.length });
    return NextResponse.json({ files, total: count ?? files.length, page, pageSize });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 400 });
  }
}
