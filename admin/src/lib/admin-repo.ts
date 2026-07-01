/* eslint-disable @typescript-eslint/no-explicit-any -- граница нетипизированного Supabase query builder */
import type { BanRow, MediaAssetRow, ProfileRow, ReportRow } from "@/data/fixtures";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Чтение/мутации admin-данных через Supabase (secret, bypass RLS). Джойны делаем явно в JS
// (без PostgREST embed) — надёжнее и не зависит от имён FK-констрейнтов.

export type ListParams = {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: "asc" | "desc";
  filters?: Record<string, string>;
  ids?: string[];
};

type Q = { page?: number; pageSize?: number; sort?: string; order?: "asc" | "desc" };

function paginate(q: any, { page, pageSize, sort, order }: Q) {
  if (sort) q = q.order(sort, { ascending: order !== "desc" });
  if (page && pageSize) q = q.range((page - 1) * pageSize, page * pageSize - 1);
  return q;
}

async function profileMap(ids: string[]): Promise<Map<string, { nickname: string; publicId: string }>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (uniq.length === 0) return new Map();
  const { data } = await supabaseAdmin().from("Profile").select("id,nickname,publicId").in("id", uniq);
  return new Map((data ?? []).map((p: any) => [p.id, { nickname: p.nickname, publicId: p.publicId }]));
}

export async function listReports(p: ListParams): Promise<{ data: ReportRow[]; total: number }> {
  const admin = supabaseAdmin();
  let q = admin.from("Report").select("id,reporterId,targetProfileId,reason,note,status,createdAt", { count: "exact" });
  if (p.filters?.status) q = q.eq("status", p.filters.status);
  if (p.ids) q = q.in("id", p.ids);
  q = paginate(q, p);
  const { data, count } = await q;
  const rows = (data ?? []) as any[];
  const map = await profileMap(rows.map((r) => r.targetProfileId));
  const mapped: ReportRow[] = rows.map((r) => ({
    id: r.id,
    reporterId: r.reporterId,
    targetProfileId: r.targetProfileId,
    targetNickname: map.get(r.targetProfileId)?.nickname ?? "—",
    targetPublicId: map.get(r.targetProfileId)?.publicId ?? "",
    reason: r.reason,
    note: r.note ?? undefined,
    status: r.status,
    createdAt: r.createdAt,
  }));
  return { data: mapped, total: count ?? mapped.length };
}

export async function listProfiles(p: ListParams): Promise<{ data: ProfileRow[]; total: number }> {
  const admin = supabaseAdmin();
  let q = admin.from("Profile").select("id,publicId,nickname,emoji,online,reportCount,createdAt", { count: "exact" });
  if (p.ids) q = q.in("id", p.ids);
  q = paginate(q, p);
  const { data, count } = await q;
  const rows = (data ?? []) as any[];
  const { data: activeBans } = await admin.from("Ban").select("profileId").eq("state", "active");
  const banned = new Set((activeBans ?? []).map((b: any) => b.profileId));
  const mapped: ProfileRow[] = rows.map((r) => ({
    id: r.id,
    publicId: r.publicId,
    nickname: r.nickname,
    emoji: r.emoji,
    online: r.online,
    reportCount: r.reportCount,
    banned: banned.has(r.id),
    createdAt: r.createdAt,
  }));
  return { data: mapped, total: count ?? mapped.length };
}

export async function listBans(p: ListParams): Promise<{ data: BanRow[]; total: number }> {
  const admin = supabaseAdmin();
  let q = admin.from("Ban").select("id,profileId,reason,expiresAt,state,createdAt", { count: "exact" });
  if (p.ids) q = q.in("id", p.ids);
  q = paginate(q, p);
  const { data, count } = await q;
  const rows = (data ?? []) as any[];
  const map = await profileMap(rows.map((r) => r.profileId));
  const mapped: BanRow[] = rows.map((r) => ({
    id: r.id,
    profileId: r.profileId,
    nickname: map.get(r.profileId)?.nickname ?? "—",
    publicId: map.get(r.profileId)?.publicId ?? "",
    reason: r.reason,
    expiresAt: r.expiresAt ?? null,
    state: r.state,
    createdAt: r.createdAt,
  }));
  return { data: mapped, total: count ?? mapped.length };
}

export async function listMedia(p: ListParams): Promise<{ data: MediaAssetRow[]; total: number }> {
  const admin = supabaseAdmin();
  let q = admin
    .from("MediaAsset")
    .select("id,ownerProfileId,kind,mime,ephemeral,expiresAt,deletedAt,retainedForReport,createdAt", { count: "exact" });
  if (p.ids) q = q.in("id", p.ids);
  q = paginate(q, p);
  const { data, count } = await q;
  const rows = (data ?? []) as any[];
  // url — реальный файл появится с R2 (Фаза E); пока пусто → UI покажет «медиа недоступно».
  const mapped: MediaAssetRow[] = rows.map((r) => ({
    id: r.id,
    ownerProfileId: r.ownerProfileId,
    kind: r.kind === "video" ? "video" : "image",
    url: "",
    ephemeral: r.ephemeral,
    expiresAt: r.expiresAt ?? null,
    deletedAt: r.deletedAt ?? null,
    escalated: r.retainedForReport ?? false,
    createdAt: r.createdAt,
  }));
  return { data: mapped, total: count ?? mapped.length };
}

const RESOURCE_LIST: Record<string, (p: ListParams) => Promise<{ data: unknown[]; total: number }>> = {
  reports: listReports,
  users: listProfiles,
  profiles: listProfiles,
  bans: listBans,
  media: listMedia,
};

export async function listResource(resource: string, p: ListParams) {
  const fn = RESOURCE_LIST[resource];
  if (!fn) throw new Error(`unknown resource: ${resource}`);
  return fn(p);
}

export async function getOne(resource: string, id: string) {
  const { data } = await listResource(resource, { ids: [id] });
  return data[0] ?? null;
}

// Обновление жалобы: смена статуса + каскад (Ban + аудит) при бане/отклонении.
export async function updateReport(id: string, values: { status?: string }, adminId: string) {
  const admin = supabaseAdmin();
  const status = values.status;
  const now = new Date().toISOString();
  if (!status) return getOne("reports", id);

  await admin.from("Report").update({ status, resolvedById: adminId, resolvedAt: now }).eq("id", id);

  if (status === "resolved_banned") {
    const { data: rep } = await admin.from("Report").select("targetProfileId").eq("id", id).single();
    const targetProfileId = (rep as { targetProfileId?: string } | null)?.targetProfileId;
    if (targetProfileId) {
      await admin.from("Ban").insert({ profileId: targetProfileId, reason: "По жалобе", state: "active", issuedById: adminId });
      await admin.from("ModeratorAction").insert({ adminId, type: "ban", targetProfileId, targetReportId: id });
    }
  } else if (status === "resolved_dismissed") {
    await admin.from("ModeratorAction").insert({ adminId, type: "dismiss_report", targetReportId: id });
  }
  return getOne("reports", id);
}

export async function updateResource(resource: string, id: string, values: Record<string, unknown>, adminId: string) {
  if (resource === "reports") return updateReport(id, values as { status?: string }, adminId);
  // Прочие ресурсы: прямое обновление (минимум). Таблица = PascalCase.
  const table = resource === "users" || resource === "profiles" ? "Profile" : resource === "bans" ? "Ban" : null;
  if (!table) throw new Error(`update not supported: ${resource}`);
  await supabaseAdmin().from(table).update(values).eq("id", id);
  return getOne(resource, id);
}
