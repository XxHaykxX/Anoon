import { getUid, myProfileId, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

// GET /api/profile/me — полный профиль вызывающего (для гидрации аккаунта на клиенте).
export async function GET(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();

  const admin = supabaseAdmin();
  const id = await myProfileId(admin, uid);
  if (!id) return Response.json({ profile: null });

  const { data } = await admin
    .from("Profile")
    .select("id,publicId,nickname,emoji,firstName,lastName,avatarUrl,ageBand,realGender,genderLocked,online,lastSeen")
    .eq("id", id)
    .maybeSingle();
  return Response.json({ profile: data ?? null });
}
