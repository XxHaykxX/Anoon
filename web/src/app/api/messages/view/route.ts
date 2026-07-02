import { getUid, myProfileId, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

// POST /api/messages/view { id } — пометить одноразовое (view-once) сообщение просмотренным.
// Сервер-истина приватности: пометить может ТОЛЬКО ПОЛУЧАТЕЛЬ (второй участник, не отправитель).
// Идемпотентно: viewedAt ставится один раз (не сдвигается повторными вызовами). Возврат {viewedAt}.
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const admin = supabaseAdmin();
  const meId = await myProfileId(admin, uid);
  if (!meId) return Response.json({ error: "profile not found" }, { status: 404 });

  const { data: msgRow } = await admin
    .from("Message").select("id,senderId,conversationId,viewedAt").eq("id", id).maybeSingle();
  const msg = msgRow as { id: string; senderId: string; conversationId: string; viewedAt: string | null } | null;
  if (!msg) return Response.json({ error: "not found" }, { status: 404 });

  // Отправитель НЕ может «просмотреть» своё же одноразовое (иначе слил бы себе доступ навсегда).
  if (msg.senderId === meId) return Response.json({ error: "not recipient" }, { status: 403 });

  // Вызывающий обязан быть участником диалога (получателем).
  const { data: convRow } = await admin
    .from("Conversation").select("profileAId,profileBId").eq("id", msg.conversationId).maybeSingle();
  const conv = convRow as { profileAId: string; profileBId: string } | null;
  if (!conv || (conv.profileAId !== meId && conv.profileBId !== meId)) {
    return Response.json({ error: "not participant" }, { status: 403 });
  }

  // Идемпотентно: уже просмотрено → возвращаем прежний момент, не сдвигаем.
  if (msg.viewedAt) return Response.json({ viewedAt: msg.viewedAt });

  const now = new Date().toISOString();
  await admin.from("Message").update({ viewedAt: now }).eq("id", id).is("viewedAt", null);
  return Response.json({ viewedAt: now });
}
