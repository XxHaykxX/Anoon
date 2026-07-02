import { getUid, myProfileId, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

// GET /api/profile/me — плоский профиль вызывающего (для гидрации аккаунта на клиенте).
// Контракт клиента (fetchMyProfile / FullProfileDTO): плоский объект с полем `gender`
// (алиас realGender), либо null если профиля ещё нет. НЕ оборачивать в { profile }.
export async function GET(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();

  const admin = supabaseAdmin();
  const id = await myProfileId(admin, uid);
  if (!id) return Response.json(null);

  const { data } = await admin
    .from("Profile")
    .select("publicId,nickname,emoji,firstName,lastName,avatarUrl,ageBand,realGender,genderLocked,online,lastSeen")
    .eq("id", id)
    .maybeSingle();
  if (!data) return Response.json(null);

  const p = data as {
    publicId: string; nickname: string; emoji: string;
    firstName: string | null; lastName: string | null; avatarUrl: string | null;
    ageBand: string | null; realGender: string; genderLocked: boolean;
    online: boolean; lastSeen: string | null;
  };
  return Response.json({
    publicId: p.publicId,
    nickname: p.nickname,
    emoji: p.emoji,
    firstName: p.firstName,
    lastName: p.lastName,
    avatarUrl: p.avatarUrl,
    ageBand: p.ageBand,
    gender: p.realGender,
    genderLocked: p.genderLocked,
    online: p.online,
    lastSeen: p.lastSeen,
  });
}
