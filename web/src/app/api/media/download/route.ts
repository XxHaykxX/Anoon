import { getUid, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

const BUCKET = "media";
const TTL = 3600; // signed URL живёт 1 час

// POST /api/media/download { path } → временный signed URL для показа.
// Путь — неугадываемый UUID; доступ любому авторизованному (собеседник знает путь из сообщения).
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { path?: unknown };
  const path = typeof body.path === "string" ? body.path : "";
  if (!path) return Response.json({ error: "path required" }, { status: 400 });

  const admin = supabaseAdmin();

  // Defense in depth: если это медиа одноразового сообщения, которое уже просмотрено —
  // не выдаём signed URL даже по прямому fetch (истина — Message.once && viewedAt на сервере).
  const { data: asset } = await admin.from("MediaAsset").select("id").eq("r2Key", path).maybeSingle();
  const assetId = (asset as { id: string } | null)?.id;
  if (assetId) {
    const { data: m } = await admin.from("Message").select("once,viewedAt").eq("mediaId", assetId).maybeSingle();
    const row = m as { once: boolean; viewedAt: string | null } | null;
    if (row?.once && row.viewedAt != null) return Response.json({ error: "consumed" }, { status: 403 });
  }

  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ url: data.signedUrl });
}
