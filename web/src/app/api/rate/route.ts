import { getUid, profileIdByPublic, rateLimit, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

// POST /api/rate { peer: publicId, rating: 1..5 } — оценка собеседника после чата.
// Копит ratingSum/ratingCount на профиле цели (trust-сигнал против фейков).
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  if (!rateLimit(`rate:${uid}`, 20, 60_000)) return Response.json({ error: "rate limited" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { peer?: unknown; rating?: unknown };
  const peer = typeof body.peer === "string" ? body.peer : "";
  const rating = typeof body.rating === "number" ? Math.round(body.rating) : 0;
  if (!peer || rating < 1 || rating > 5) return Response.json({ error: "peer + rating(1..5) required" }, { status: 400 });

  const admin = supabaseAdmin();
  const targetId = await profileIdByPublic(admin, peer);
  if (!targetId) return Response.json({ error: "profile not found" }, { status: 404 });

  const { data: prof } = await admin.from("Profile").select("ratingSum,ratingCount").eq("id", targetId).single();
  const p = prof as { ratingSum?: number; ratingCount?: number } | null;
  await admin
    .from("Profile")
    .update({ ratingSum: (p?.ratingSum ?? 0) + rating, ratingCount: (p?.ratingCount ?? 0) + 1 })
    .eq("id", targetId);
  return Response.json({ ok: true });
}
