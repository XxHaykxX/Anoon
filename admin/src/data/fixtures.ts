// Мок-данные для admin-UI (DATA_MODE=mock). Заменятся реальным admin-API позже.
// Приватность: email-hash/providerId здесь НЕ моделируются (в UI не показываются).

export type ProfileRow = {
  id: string;
  publicId: string; // #ID
  nickname: string;
  emoji: string;
  online: boolean;
  reportCount: number;
  banned: boolean;
  createdAt: string;
};

export type ReportReason = "spam" | "abuse" | "sexual" | "illegal" | "other";
export type ReportStatus = "open" | "in_review" | "resolved_banned" | "resolved_dismissed";

export type ReportRow = {
  id: string;
  reporterId: string;
  targetProfileId: string;
  targetNickname: string;
  targetPublicId: string;
  reason: ReportReason;
  note?: string;
  status: ReportStatus;
  createdAt: string;
};

export type BanRow = {
  id: string;
  profileId: string;
  nickname: string;
  publicId: string;
  reason: string;
  expiresAt: string | null; // null = перманентный
  state: "active" | "expired" | "lifted";
  createdAt: string;
};

export const profiles: ProfileRow[] = [
  { id: "p1", publicId: "00001", nickname: "Тёплый Ёжик", emoji: "🦔", online: true, reportCount: 3, banned: false, createdAt: "2026-06-20T10:00:00Z" },
  { id: "p2", publicId: "00002", nickname: "Синий Кот", emoji: "🐱", online: false, reportCount: 0, banned: false, createdAt: "2026-06-21T12:30:00Z" },
  { id: "p3", publicId: "00003", nickname: "Ночной Сокол", emoji: "🦅", online: true, reportCount: 7, banned: false, createdAt: "2026-06-22T08:15:00Z" },
  { id: "p4", publicId: "00004", nickname: "Тихий Лис", emoji: "🦊", online: false, reportCount: 1, banned: true, createdAt: "2026-06-19T18:45:00Z" },
];

export const reports: ReportRow[] = [
  { id: "r1", reporterId: "p2", targetProfileId: "p3", targetNickname: "Ночной Сокол", targetPublicId: "00003", reason: "abuse", note: "Оскорбления в чате", status: "open", createdAt: "2026-06-30T09:10:00Z" },
  { id: "r2", reporterId: "p1", targetProfileId: "p3", targetNickname: "Ночной Сокол", targetPublicId: "00003", reason: "sexual", note: "Непрошеное медиа", status: "open", createdAt: "2026-06-30T09:40:00Z" },
  { id: "r3", reporterId: "p4", targetProfileId: "p1", targetNickname: "Тёплый Ёжик", targetPublicId: "00001", reason: "spam", status: "in_review", createdAt: "2026-06-29T14:05:00Z" },
  { id: "r4", reporterId: "p2", targetProfileId: "p4", targetNickname: "Тихий Лис", targetPublicId: "00004", reason: "illegal", note: "Противоправный контент", status: "open", createdAt: "2026-06-30T11:00:00Z" },
];

export const bans: BanRow[] = [
  { id: "b1", profileId: "p4", nickname: "Тихий Лис", publicId: "00004", reason: "Противоправный контент", expiresAt: null, state: "active", createdAt: "2026-06-29T20:00:00Z" },
  { id: "b2", profileId: "p3", nickname: "Ночной Сокол", publicId: "00003", reason: "Спам — временный", expiresAt: "2026-06-27T00:00:00Z", state: "expired", createdAt: "2026-06-20T00:00:00Z" },
  { id: "b3", profileId: "p2", nickname: "Синий Кот", publicId: "00002", reason: "Ошибочный бан — снят", expiresAt: null, state: "lifted", createdAt: "2026-06-18T00:00:00Z" },
];

// --- Медиа-ассеты (Этап 3). Приватность: url — заглушка R2 (mock),
// в проде проксируется через admin-API (аудит просмотра). ---
export type MediaKind = "image" | "video";

export type MediaAssetRow = {
  id: string;
  ownerProfileId: string;
  kind: MediaKind;
  url: string; // R2-заглушка (mock: picsum / sample-video)
  poster?: string; // постер для видео
  width?: number;
  height?: number;
  durationMs?: number;
  ephemeral: boolean;
  expiresAt?: string | null;
  deletedAt: string | null; // != null → «медиа удалено/истекло»
  escalated: boolean; // помечено на CSAM-эскалацию → элемент блокируется
  reportReason?: ReportReason; // связь с жалобой (для content-warning)
  ownerBadge?: string; // #ID владельца — для общей галереи (разные владельцы на тайлах)
  createdAt: string;
};

const IMG = (seed: string, w = 600, h = 800) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

export const media: MediaAssetRow[] = [
  // p1 — Тёплый Ёжик
  { id: "m1", ownerProfileId: "p1", kind: "image", url: IMG("anoon-m1"), width: 600, height: 800, ephemeral: false, deletedAt: null, escalated: false, createdAt: "2026-06-20T11:00:00Z" },
  { id: "m2", ownerProfileId: "p1", kind: "image", url: IMG("anoon-m2"), width: 600, height: 800, ephemeral: true, deletedAt: null, escalated: false, createdAt: "2026-06-21T09:30:00Z" },
  // p3 — Ночной Сокол (на него жалобы abuse/sexual)
  { id: "m3", ownerProfileId: "p3", kind: "image", url: IMG("anoon-m3"), width: 600, height: 800, ephemeral: false, deletedAt: null, escalated: false, reportReason: "sexual", createdAt: "2026-06-22T08:20:00Z" },
  { id: "m4", ownerProfileId: "p3", kind: "video", url: "https://media.vidstack.io/720p.mp4", poster: "https://media.vidstack.io/poster.png", width: 1280, height: 720, durationMs: 120000, ephemeral: false, deletedAt: null, escalated: false, reportReason: "sexual", createdAt: "2026-06-22T08:25:00Z" },
  { id: "m5", ownerProfileId: "p3", kind: "image", url: IMG("anoon-m5"), width: 600, height: 800, ephemeral: true, expiresAt: "2026-06-25T00:00:00Z", deletedAt: "2026-06-25T00:00:00Z", escalated: false, createdAt: "2026-06-22T08:40:00Z" },
  // p4 — Тихий Лис (illegal-жалоба)
  { id: "m6", ownerProfileId: "p4", kind: "image", url: IMG("anoon-m6"), width: 600, height: 800, ephemeral: false, deletedAt: null, escalated: false, reportReason: "illegal", createdAt: "2026-06-19T19:00:00Z" },
  { id: "m7", ownerProfileId: "p4", kind: "image", url: IMG("anoon-m7"), width: 600, height: 800, ephemeral: false, deletedAt: null, escalated: true, reportReason: "illegal", createdAt: "2026-06-19T19:05:00Z" },
];

export const fixtures: Record<string, unknown[]> = { profiles, users: profiles, reports, bans, media };
