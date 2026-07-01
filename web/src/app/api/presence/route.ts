import { getUid, myProfileId, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

// Карта клиентского пола → enum Gender в БД.
const GENDER_MAP: Record<string, "male" | "female" | "any"> = { m: "male", f: "female", nobody: "any" };

// POST /api/presence { gender? } — heartbeat: online=true + lastSeen=now (+ realGender если задан).
// Клиент шлёт каждые ~30с пока активен. online-статус в админке считается по свежести lastSeen.
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as { gender?: unknown };
  const rawGender = typeof body.gender === "string" ? body.gender : "";
  const realGender = GENDER_MAP[rawGender];

  const admin = supabaseAdmin();
  const profileId = await myProfileId(admin, uid);
  if (!profileId) return Response.json({ error: "profile not found" }, { status: 404 });

  const patch: Record<string, unknown> = { online: true, lastSeen: new Date().toISOString() };
  if (realGender) patch.realGender = realGender;
  const { error } = await admin.from("Profile").update(patch).eq("id", profileId);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
