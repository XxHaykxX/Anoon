import {
  getUid,
  myProfileCore,
  rateLimit,
  supabaseAdmin,
  unauthorized,
  type FriendStatus,
} from "@/lib/server/backend";

export const runtime = "nodejs";

type FriendshipRow = { loId: string; hiId: string; requestedById: string; status: string };
type Hit = { id: string; publicId: string; nickname: string };

// GET /api/users/search?q= — ТОЛЬКО точный #ID ИЛИ точный ник (реальное имя НЕ ищется —
// перебор/деанонимизация, ревью). DTO анонимный {publicId, nickname, status}; имя/фото не отдаём.
export async function GET(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  if (!rateLimit(`search:${uid}`, 30, 60_000)) return Response.json({ error: "rate limited" }, { status: 429 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ results: [] });
  const asId = q.replace(/^#/, "");

  const admin = supabaseAdmin();
  const me = await myProfileCore(admin, uid);
  if (!me) return Response.json({ results: [] });

  // Точное совпадение по publicId ИЛИ nickname. Ник экранируем (запятая ломает PostgREST or()).
  const safeNick = q.replace(/[,()]/g, " ");
  const { data: rows } = await admin
    .from("Profile")
    .select("id,publicId,nickname")
    .or(`publicId.eq.${asId},nickname.eq.${safeNick}`)
    .limit(20);
  const hits = ((rows ?? []) as Hit[]).filter((r) => r.id !== me.id); // себя скрываем
  if (!hits.length) return Response.json({ results: [] });

  // Статусы одним запросом: все мои связи → map peerId→status (перспектива me).
  const { data: frs } = await admin
    .from("Friendship").select("loId,hiId,requestedById,status").or(`loId.eq.${me.id},hiId.eq.${me.id}`);
  const statusByPeer = new Map<string, FriendStatus>();
  for (const f of (frs ?? []) as FriendshipRow[]) {
    const peerId = f.loId === me.id ? f.hiId : f.loId;
    statusByPeer.set(peerId, f.status === "accepted" ? "accepted" : f.requestedById === me.id ? "pending_me" : "pending_peer");
  }

  const results = hits.map((h) => ({
    publicId: h.publicId,
    nickname: h.nickname,
    status: statusByPeer.get(h.id) ?? ("none" as FriendStatus),
  }));
  return Response.json({ results });
}
