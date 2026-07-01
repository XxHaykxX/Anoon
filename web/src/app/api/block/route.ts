import { getUid, myProfileId, profileIdByPublic, rateLimit, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

// POST /api/block { peer: publicId }
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  if (!rateLimit(`block:${uid}`, 20, 60_000)) return Response.json({ error: "rate limited" }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { peer?: unknown };
  const peer = typeof body.peer === "string" ? body.peer : "";
  if (!peer) return Response.json({ error: "peer required" }, { status: 400 });

  const admin = supabaseAdmin();
  const [blockerId, blockedId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
  if (!blockerId || !blockedId) return Response.json({ error: "profile not found" }, { status: 404 });
  const { error } = await admin.from("Block").upsert({ blockerId, blockedId }, { onConflict: "blockerId,blockedId" });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
