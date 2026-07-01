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

  const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, TTL);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ url: data.signedUrl });
}
