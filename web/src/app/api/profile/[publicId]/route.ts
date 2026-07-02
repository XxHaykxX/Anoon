import {
  friendStatusBetween,
  getUid,
  myProfileCore,
  supabaseAdmin,
  unauthorized,
} from "@/lib/server/backend";

export const runtime = "nodejs";

// GET /api/profile/[publicId] — ПРИВАТНОСТЬ НА СЕРВЕРЕ (risk #2, критично).
// Полный DTO (имя/фамилия/фото/возраст/пол) отдаём ТОЛЬКО если вызывающий = принятый друг цели
// (или это он сам). Иначе — только анонимный {publicId, nickname}. Защита от перебора по #ID
// и от подделки friend_accept в realtime-канале (клиент обязан ре-фетчить сюда, C.1).
export async function GET(req: Request, ctx: { params: Promise<{ publicId: string }> }) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  const { publicId: raw } = await ctx.params;
  const publicId = (raw ?? "").trim().replace(/^#/, "");
  if (!publicId) return Response.json({ error: "publicId required" }, { status: 400 });

  const admin = supabaseAdmin();
  const me = await myProfileCore(admin, uid);
  if (!me) return unauthorized();

  const { data: target } = await admin
    .from("Profile")
    .select("id,publicId,nickname,firstName,lastName,avatarUrl,ageBand,realGender,online,lastSeen")
    .eq("publicId", publicId)
    .maybeSingle();
  const t = target as {
    id: string;
    publicId: string;
    nickname: string;
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
    ageBand: string | null;
    realGender: string | null;
    online: boolean;
    lastSeen: string | null;
  } | null;
  if (!t) return Response.json({ error: "not found" }, { status: 404 });

  const isSelf = t.id === me.id;
  const status = isSelf ? "accepted" : await friendStatusBetween(admin, me, { id: t.id, publicId: t.publicId });
  const revealed = isSelf || status === "accepted";

  if (!revealed) {
    // Анонимный минимум — никакой личности не утекает при переборе #ID.
    return Response.json({ profile: { publicId: t.publicId, nickname: t.nickname }, status });
  }
  return Response.json({
    profile: {
      publicId: t.publicId,
      nickname: t.nickname,
      firstName: t.firstName,
      lastName: t.lastName,
      avatarUrl: t.avatarUrl,
      ageBand: t.ageBand,
      realGender: t.realGender,
      online: t.online,
      lastSeen: t.lastSeen,
    },
    status,
  });
}
