/* eslint-disable @typescript-eslint/no-explicit-any -- граница нетипизированного companion REST-ответа */
import { cookies } from "next/headers";

import type { BanRow, MediaAssetRow, ProfileRow, ReportReason, ReportRow, ReportStatus } from "@/data/fixtures";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-session";

// ---------------------------------------------------------------------------
// Тонкий серверный fetch-клиент к companion admin-API (Go, dev :6062).
// Заменяет supabaseAdmin() как источник данных для админки, когда ADMIN_BACKEND=companion.
// Auth: shared-secret заголовок + личность админа берётся ТОЛЬКО из проверенной
// httpOnly-сессии (verifySession по cookie), а не из клиентского ввода. Плюс сырой
// JWT той же сессии в X-Admin-Token, чтобы companion мог проверить личность
// оператора сам, а не верить нам на слово — см. authHeaders. См.
// COMPANION-ADMIN-API.md §0/§6.
// ---------------------------------------------------------------------------

const DEFAULT_URL = "http://localhost:6062";
const TIMEOUT_MS = 5000;

export type CompanionListParams = {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: "asc" | "desc";
  filters?: Record<string, string>;
  ids?: string[];
};

// ADMIN_BACKEND=companion → ходим в companion; иначе (по умолчанию) остаёмся на Supabase.
// Дополнительно требуем NEXT_PUBLIC_DATA_MODE=api: «companion + не-api режим» — несвязная
// комбинация (UI рисует фикстуры через mockDataProvider и живых данных не показывает,
// а API при этом ходил бы в реальный companion), и раньше она тихо полуработала.
// Ровно это условие три роута — broadcast/overview/media — уже проверяют у себя MOCK-гардом;
// здесь оно переезжает в общий хелпер, а не заводится заново. В связных конфигурациях
// (api+companion, mock+фикстуры) значение не меняется.
export function companionEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_DATA_MODE !== "api") return false;
  return (process.env.ADMIN_BACKEND ?? "supabase").toLowerCase() === "companion";
}

function baseUrl(): string {
  return (process.env.COMPANION_ADMIN_URL ?? DEFAULT_URL).replace(/\/+$/, "");
}

// Заголовки авторизации на КАЖДЫЙ admin-запрос. adminId/role — из подписанной сессии
// (или явно переданные из уже-проверенного PATCH-роута), НИКОГДА из тела запроса.
//
// X-Admin-Token — сырой (непроверенный нами) JWT сессии оператора. Это личность,
// которую companion может проверить САМ: когда у него задан COMPANION_ADMIN_TOKEN_SECRET
// (= наш ADMIN_SESSION_SECRET), он сверяет подпись и срок и берёт оператора из клейма
// `sub`, а X-Admin-Id/X-Admin-Role полностью игнорирует. Тогда оператор не может ни
// повысить себе роль, ни записать чужое авторство в журнал модерации.
//
// Пока ключ у companion НЕ задан (сегодняшний дефолт) — заголовок просто не читается,
// личность по-прежнему берётся из X-Admin-Id/X-Admin-Role, поведение не меняется.
// Порядок включения важен: сначала админка начинает слать токен (этот код), и только
// потом на companion задаётся ключ — иначе каждый admin-запрос получит 401.
async function authHeaders(explicit?: { adminId: string; role: string }): Promise<Record<string, string>> {
  const secret = process.env.COMPANION_ADMIN_SECRET;
  if (!secret) throw new Error("COMPANION_ADMIN_SECRET не задан (admin/.env)");

  // Нужен всегда — в т.ч. на explicit-пути, где раньше cookie не читали: companion
  // ждёт токен на любом /admin/*, а не только на тех вызовах, где мы сами резолвим личность.
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;

  let adminId = explicit?.adminId;
  let role = explicit?.role;
  if (!adminId || !role) {
    const session = await verifySession(token);
    adminId = adminId ?? session?.sub ?? "";
    role = role ?? session?.role ?? "moderator";
  }
  return {
    "X-Companion-Admin-Secret": secret,
    "X-Admin-Id": adminId,
    "X-Admin-Role": role,
    // Пустой заголовок companion трактует ровно как отсутствующий, поэтому не шлём его вовсе.
    ...(token ? { "X-Admin-Token": token } : {}),
  };
}

async function companionFetch<T>(
  path: string,
  init?: RequestInit,
  explicit?: { adminId: string; role: string },
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(await authHeaders(explicit)), ...(init?.headers ?? {}) },
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as any) : null;
    if (!res.ok) throw new Error(body?.error ?? `companion ${res.status}`);
    return body as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("companion недоступен (timeout)");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// --- Query-маппинг Refine → companion (_page/_perPage/_sort/_order/f_<field>). ---
function listQuery(p: CompanionListParams): string {
  const qs = new URLSearchParams();
  if (p.page) qs.set("_page", String(p.page));
  if (p.pageSize) qs.set("_perPage", String(p.pageSize));
  if (p.sort) qs.set("_sort", p.sort);
  if (p.order) qs.set("_order", p.order);
  for (const [k, v] of Object.entries(p.filters ?? {})) if (v != null && v !== "") qs.set(`f_${k}`, v);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

// companion route-path по admin-ресурсу. media/chats/gallery/broadcast сюда НЕ входят —
// у companion пока нет таких эндпоинтов (остаются на Supabase/mock, см. TODO в route-хендлерах).
function resourcePath(resource: string): string | null {
  if (resource === "reports") return "reports";
  if (resource === "users" || resource === "profiles") return "users";
  if (resource === "bans") return "bans";
  return null;
}

export function companionHandles(resource: string): boolean {
  return resourcePath(resource) !== null;
}

// ---------------------------------------------------------------------------
// Field-мапперы: companion-строка → admin-UI-строка (data/fixtures типы).
// Деградируем мягко: если у companion поля ещё нет (avatar/nickname/emoji/online) —
// выводим null/derived-из-hashId, не падаем.
// ---------------------------------------------------------------------------
const now = () => Date.now();

// companion report.status (open→reviewing→resolved/dismissed) → admin ReportStatus.
function mapReportStatus(s: any): ReportStatus {
  switch (String(s)) {
    case "reviewing":
      return "in_review";
    case "resolved":
      return "resolved_banned"; // «resolved» = разобрано с действием (бан)
    case "dismissed":
      return "resolved_dismissed";
    case "in_review":
    case "resolved_banned":
    case "resolved_dismissed":
      return s as ReportStatus;
    default:
      return "open";
  }
}

// admin ReportStatus → companion body для PATCH (обратный маппинг).
function toCompanionReportBody(status?: string): Record<string, unknown> {
  switch (status) {
    case "in_review":
      return { status: "reviewing" };
    case "resolved_banned":
      return { status: "resolved", action: "ban" };
    case "resolved_dismissed":
      return { status: "dismissed" };
    case undefined:
      return {};
    default:
      return { status };
  }
}

function mapReport(r: any): ReportRow {
  const publicId = String(r.targetPublicId ?? r.target_public_id ?? r.hashId ?? "");
  return {
    id: String(r.id),
    reporterId: String(r.reporterId ?? r.reporter_id ?? ""),
    targetProfileId: String(r.targetProfileId ?? r.target_profile_id ?? ""),
    targetNickname: r.targetNickname ?? r.target_nickname ?? (publicId ? `#${publicId}` : "—"),
    targetPublicId: publicId,
    reason: (r.reason ?? "other") as ReportReason,
    note: r.note ?? undefined,
    status: mapReportStatus(r.status),
    createdAt: r.createdAt ?? r.created_at ?? "",
  };
}

function mapProfile(r: any): ProfileRow {
  const hashId = r.hashId ?? r.hash_id ?? null;
  const publicId = String(r.publicId ?? r.public_id ?? hashId ?? r.id ?? "");
  const banUntil = r.ban_until ?? r.banUntil ?? null;
  const banned =
    typeof r.banned === "boolean"
      ? r.banned
      : r.state === "banned" || r.state === "susp" || (banUntil ? new Date(banUntil).getTime() > now() : false);
  return {
    id: String(r.id),
    publicId,
    // companion может не хранить никнейм/эмодзи анон-персоны — деградируем к hashId.
    nickname: r.nickname ?? (hashId ? `#${hashId}` : `#${publicId}`),
    emoji: r.emoji ?? "🙂",
    online: Boolean(r.online ?? r.state === "online"),
    reportCount: Number(r.reportCount ?? r.report_count ?? 0),
    banned: Boolean(banned),
    createdAt: r.createdAt ?? r.created_at ?? "",
  };
}

function mapBan(r: any): BanRow {
  const publicId = String(r.publicId ?? r.public_id ?? r.hashId ?? "");
  return {
    id: String(r.id),
    profileId: String(r.profileId ?? r.profile_id ?? r.userId ?? ""),
    nickname: r.nickname ?? (publicId ? `#${publicId}` : "—"),
    publicId,
    reason: r.reason ?? "",
    expiresAt: r.expiresAt ?? r.expires_at ?? r.ban_until ?? null,
    state: (r.state ?? "active") as BanRow["state"],
    createdAt: r.createdAt ?? r.created_at ?? "",
  };
}

const MAPPERS: Record<string, (r: any) => unknown> = {
  reports: mapReport,
  users: mapProfile,
  profiles: mapProfile,
  bans: mapBan,
};

function mapRow(resource: string, r: any): unknown {
  return (MAPPERS[resource] ?? ((x: any) => x))(r);
}

// --- List / getOne ---
export async function companionList(
  resource: string,
  p: CompanionListParams,
): Promise<{ data: unknown[]; total: number }> {
  const path = resourcePath(resource);
  if (!path) throw new Error(`companion не обслуживает ресурс: ${resource}`);

  // getMany (ids) — companion list-контракт равенства не покрывает набор id; тянем поштучно.
  if (p.ids?.length) {
    const rows = await Promise.all(p.ids.map((id) => companionGetOne(resource, id)));
    const data = rows.filter((x): x is NonNullable<typeof x> => x != null);
    return { data, total: data.length };
  }

  const body = await companionFetch<{ data: any[]; total: number }>(`/admin/${path}${listQuery(p)}`);
  const rows = Array.isArray(body?.data) ? body.data : [];
  return { data: rows.map((r) => mapRow(resource, r)), total: Number(body?.total ?? rows.length) };
}

export async function companionGetOne(resource: string, id: string): Promise<unknown | null> {
  const path = resourcePath(resource);
  if (!path) throw new Error(`companion не обслуживает ресурс: ${resource}`);
  const body = await companionFetch<any>(`/admin/${path}/${encodeURIComponent(id)}`);
  const row = body?.data ?? body;
  return row ? mapRow(resource, row) : null;
}

// --- Mutations ---
// PermissionError переиспользуем из admin-repo, чтобы route отдал 403 (ленивый импорт во избежание цикла).
async function permissionError(msg: string): Promise<never> {
  const { PermissionError } = await import("@/lib/admin-repo");
  throw new PermissionError(msg);
}

export async function companionUpdateReport(
  id: string,
  values: { status?: string },
  adminId: string,
  role: string,
): Promise<unknown> {
  const body = toCompanionReportBody(values.status);
  const res = await companionFetch<any>(
    `/admin/reports/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(body) },
    { adminId, role },
  );
  const row = res?.data ?? res;
  return row ? mapReport(row) : companionGetOne("reports", id);
}

export async function companionUpdateResource(
  resource: string,
  id: string,
  values: Record<string, unknown>,
  adminId: string,
  role: string,
): Promise<unknown> {
  const auth = { adminId, role };

  // Бан/разбан юзера. Роль-гейт зеркалит Supabase-путь (companion тоже вернёт 403).
  if ((resource === "users" || resource === "profiles") && "banned" in values) {
    if (values.banned) {
      const expiresAt = typeof values.expiresAt === "string" ? values.expiresAt : null;
      if (!expiresAt && role !== "super_admin") {
        return permissionError("Перманентный бан доступен только super_admin. Задайте срок.");
      }
      const reason = typeof values.reason === "string" && values.reason ? values.reason : "Заблокирован модератором";
      await companionFetch(
        `/admin/users/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify({ banned: true, expiresAt, reason }) },
        auth,
      );
    } else {
      if (role !== "super_admin") return permissionError("Разбан доступен только super_admin.");
      await companionFetch(
        `/admin/users/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify({ banned: false }) },
        auth,
      );
    }
    return companionGetOne(resource, id);
  }

  // Мьют/размьют (мягче бана) — доступно модератору.
  if ((resource === "users" || resource === "profiles") && "muted" in values) {
    if (values.muted) {
      const mutedUntil = typeof values.mutedUntil === "string" ? values.mutedUntil : null;
      if (!mutedUntil) throw new Error("mute requires mutedUntil");
      const muteReason = typeof values.muteReason === "string" && values.muteReason ? values.muteReason : "Ограничение модератора";
      await companionFetch(
        `/admin/users/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify({ muted: true, expiresAt: mutedUntil, reason: muteReason }) },
        auth,
      );
    } else {
      await companionFetch(
        `/admin/users/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify({ muted: false }) },
        auth,
      );
    }
    return companionGetOne(resource, id);
  }

  // Снятие бана из раздела «Баны» — только super_admin.
  if (resource === "bans" && values.state === "lifted") {
    if (role !== "super_admin") return permissionError("Снятие бана доступно только super_admin.");
    const res = await companionFetch<any>(
      `/admin/bans/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ state: "lifted" }) },
      auth,
    );
    const row = res?.data ?? res;
    return row ? mapBan(row) : companionGetOne("bans", id);
  }

  throw new Error(`companion update не поддержан: ${resource}`);
}

// --- Media (разделы «Файлы» и «Галерея», см. COMPANION-ADMIN-API.md §4). ---
// companion уже хранит media_assets (миграция 0007) и отдаёт /admin/media(/folders);
// broadcast ниже — единственный ресурс, у которого ещё нет companion-хранилища.
function mapMediaAsset(r: any): MediaAssetRow {
  return {
    id: String(r.id),
    ownerProfileId: String(r.ownerProfileId ?? r.owner_id ?? ""),
    kind: r.kind === "video" ? "video" : "image",
    url: r.url ?? "",
    ephemeral: Boolean(r.ephemeral),
    expiresAt: r.expiresAt ?? r.expires_at ?? null,
    deletedAt: r.deletedAt ?? r.deleted_at ?? null,
    escalated: Boolean(r.escalated),
    ownerBadge: r.ownerBadge ?? r.owner_badge ?? undefined,
    createdAt: r.createdAt ?? r.created_at ?? "",
  };
}

export type CompanionMediaParams = {
  ownerId?: string; // internal owner id (folder.profileId) — не publicId/hashId
  kind?: string | null;
  from?: string; // ISO (RFC3339), включительно
  to?: string; // ISO (RFC3339), исключительно — семантика как в dateRange() route-хендлера
  page?: number;
  pageSize?: number;
};

// GET /admin/media?ownerId=&kind=&from=&to=&page=&pageSize= — без ownerId это общая галерея.
export async function companionMediaFiles(p: CompanionMediaParams): Promise<{ data: MediaAssetRow[]; total: number }> {
  const qs = new URLSearchParams();
  if (p.ownerId) qs.set("ownerId", p.ownerId);
  if (p.kind === "image" || p.kind === "video") qs.set("kind", p.kind);
  if (p.from) qs.set("from", p.from);
  if (p.to) qs.set("to", p.to);
  if (p.page) qs.set("page", String(p.page));
  if (p.pageSize) qs.set("pageSize", String(p.pageSize));
  const s = qs.toString();
  const body = await companionFetch<{ data: any[]; total: number }>(`/admin/media${s ? `?${s}` : ""}`);
  const rows = Array.isArray(body?.data) ? body.data : [];
  return { data: rows.map(mapMediaAsset), total: Number(body?.total ?? rows.length) };
}

export type CompanionMediaFolder = { profileId: string; nickname: string; publicId: string; images: number; videos: number; count: number };

// GET /admin/media/folders — рольап MediaAsset по владельцу для файл-менеджера («Файлы»).
export async function companionMediaFolders(): Promise<{ folders: CompanionMediaFolder[] }> {
  const body = await companionFetch<{ folders: any[] }>(`/admin/media/folders`);
  const rows = Array.isArray(body?.folders) ? body.folders : [];
  return {
    folders: rows.map((f) => ({
      profileId: String(f.profileId ?? f.owner_id ?? ""),
      nickname: f.nickname ?? "—",
      publicId: String(f.publicId ?? f.public_id ?? ""),
      images: Number(f.images ?? 0),
      videos: Number(f.videos ?? 0),
      count: Number(f.count ?? 0),
    })),
  };
}

// --- Broadcast (раздел «Рассылка»). Companion пока не хранит push-подписки массовой
// рассылки сам по себе (Фаза E1) — этот вызов бьёт в companion, когда ADMIN_BACKEND=companion,
// иначе broadcast/route.ts продолжает проксировать на WEB_URL (см. COMPANION-ADMIN-API.md §5).
export type CompanionBroadcastPayload = { title: string; body?: string; url?: string; gender?: "male" | "female" };
export type CompanionBroadcastResult = { sent: number; failed: number };

export async function companionBroadcast(payload: CompanionBroadcastPayload): Promise<CompanionBroadcastResult> {
  const body = await companionFetch<{ sent?: number; failed?: number }>(`/admin/broadcast`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { sent: Number(body?.sent ?? 0), failed: Number(body?.failed ?? 0) };
}

// --- Overview / Online (раздел «Обзор» и «Онлайн»). ---
export type OverviewSummary = {
  total: number;
  online: number;
  onlineFemale: number;
  onlineMale: number;
  onlineOther: number;
  reportsOpen: number;
  bansActive: number;
};

export async function companionOverview(): Promise<OverviewSummary> {
  const b = await companionFetch<any>(`/admin/overview`);
  return {
    total: Number(b?.total ?? 0),
    online: Number(b?.online ?? 0),
    onlineFemale: Number(b?.onlineFemale ?? 0),
    onlineMale: Number(b?.onlineMale ?? 0),
    onlineOther: Number(b?.onlineOther ?? 0),
    reportsOpen: Number(b?.reportsOpen ?? 0),
    bansActive: Number(b?.bansActive ?? 0),
  };
}

export type OnlineProfile = {
  id: string;
  publicId: string;
  nickname: string;
  emoji: string;
  realGender: string;
  lastSeen: string;
  reportCount: number;
};

export async function companionOnline(gender: string | null): Promise<{ profiles: OnlineProfile[] }> {
  const qs = gender ? `?gender=${encodeURIComponent(gender)}` : "";
  const b = await companionFetch<any>(`/admin/online${qs}`);
  const rows: any[] = Array.isArray(b?.profiles) ? b.profiles : Array.isArray(b?.data) ? b.data : [];
  const profiles = rows.map((r) => {
    const hashId = r.hashId ?? r.hash_id ?? null;
    const publicId = String(r.publicId ?? r.public_id ?? hashId ?? r.id ?? "");
    return {
      id: String(r.id),
      publicId,
      nickname: r.nickname ?? (hashId ? `#${hashId}` : `#${publicId}`),
      emoji: r.emoji ?? "🙂",
      realGender: String(r.realGender ?? r.real_gender ?? "any"),
      lastSeen: r.lastSeen ?? r.last_seen ?? "",
      reportCount: Number(r.reportCount ?? r.report_count ?? 0),
    };
  });
  return { profiles };
}
