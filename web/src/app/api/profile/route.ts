import { getUid, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

type IdRow = { id: string } | null;
type ProfileRow = { id: string; publicId: string; nickname: string } | null;

async function nextPublicId(admin: ReturnType<typeof supabaseAdmin>): Promise<string> {
  const { count } = await admin.from("Profile").select("*", { count: "exact", head: true });
  return String((count ?? 0) + 1).padStart(5, "0");
}

export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as { nickname?: unknown };
  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  if (nickname.length < 2) return Response.json({ error: "nickname required (>=2)" }, { status: 400 });

  const admin = supabaseAdmin();

  const { data: existingUser } = await admin.from("User").select("id").eq("provider", "anonymous").eq("providerId", uid).maybeSingle();
  let userId = (existingUser as IdRow)?.id;
  if (!userId) {
    const { data: newUser, error } = await admin.from("User").insert({ provider: "anonymous", providerId: uid }).select("id").single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    userId = (newUser as IdRow)!.id;
  }

  const { data: existing } = await admin.from("Profile").select("id,publicId,nickname").eq("userId", userId).maybeSingle();
  const ex = existing as ProfileRow;
  if (ex) {
    if (ex.nickname !== nickname) await admin.from("Profile").update({ nickname }).eq("id", ex.id);
    return Response.json({ id: ex.id, publicId: ex.publicId, nickname });
  }

  const publicId = await nextPublicId(admin);
  const { data: created, error: perr } = await admin
    .from("Profile").insert({ userId, publicId, nickname, online: true }).select("id,publicId,nickname").single();
  if (perr) return Response.json({ error: perr.message }, { status: 400 });
  return Response.json(created);
}
