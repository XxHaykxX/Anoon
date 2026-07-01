import { getUid, myProfileId, profileIdByPublic, rateLimit, REASON_MAP, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

// POST /api/report { peer: publicId, reason, comment? }
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  if (!rateLimit(`report:${uid}`, 10, 60_000)) return Response.json({ error: "rate limited" }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { peer?: unknown; reason?: unknown; comment?: unknown };
  const peer = typeof body.peer === "string" ? body.peer : "";
  const reason = REASON_MAP[typeof body.reason === "string" ? body.reason : "other"] ?? "other";
  const note = typeof body.comment === "string" ? body.comment.slice(0, 280) : null;
  if (!peer) return Response.json({ error: "peer required" }, { status: 400 });

  const admin = supabaseAdmin();
  const [reporterId, targetProfileId] = await Promise.all([myProfileId(admin, uid), profileIdByPublic(admin, peer)]);
  if (!reporterId || !targetProfileId) return Response.json({ error: "profile not found" }, { status: 404 });
  const { error } = await admin.from("Report").insert({ reporterId, targetProfileId, reason, note, status: "open" });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  const { data: prof } = await admin.from("Profile").select("reportCount").eq("id", targetProfileId).single();
  await admin.from("Profile").update({ reportCount: ((prof as { reportCount?: number } | null)?.reportCount ?? 0) + 1 }).eq("id", targetProfileId);
  return Response.json({ ok: true });
}
