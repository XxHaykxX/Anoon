import { getUid, KIND_MAP, myProfileId, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

const BUCKET = "media";
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
};

// POST /api/media/create-upload { kind, mime } → signed upload URL + MediaAsset.
// Клиент грузит файл напрямую в Storage (обход 4.5МБ лимита serverless body).
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { kind?: unknown; mime?: unknown };
  const webKind = typeof body.kind === "string" ? body.kind : "";
  const kind = KIND_MAP[webKind] ?? "";
  // Чистим mime от codecs-параметров (iOS Safari: "audio/mp4;codecs=..." → "audio/mp4").
  const rawMime = typeof body.mime === "string" ? body.mime : "application/octet-stream";
  const mime = rawMime.split(";")[0].trim().toLowerCase();
  if (!kind) return Response.json({ error: "kind required" }, { status: 400 });

  const admin = supabaseAdmin();
  const profileId = await myProfileId(admin, uid);
  if (!profileId) return Response.json({ error: "profile not found" }, { status: 404 });

  // Ext по mime; фолбэк по типу медиа (голос iOS может дать неожиданный mime).
  const KIND_EXT: Record<string, string> = { image: "jpg", video: "mp4", audio: "webm" };
  const ext = EXT[mime] ?? KIND_EXT[kind] ?? "bin";
  const path = `${profileId}/${crypto.randomUUID()}.${ext}`;

  // MediaAsset (ephemeral, TTL 7 дней).
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const { data: asset, error: aerr } = await admin
    .from("MediaAsset").insert({ ownerProfileId: profileId, r2Key: path, mime, kind, ephemeral: true, expiresAt })
    .select("id").single();
  if (aerr) return Response.json({ error: aerr.message }, { status: 400 });

  const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return Response.json({ error: error.message }, { status: 400 });

  return Response.json({ path, token: signed.token, mediaId: (asset as { id: string }).id });
}
