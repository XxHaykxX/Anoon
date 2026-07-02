import { getUid, myProfileCore, rateLimit, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

// POST /api/messages/react { messageId, emoji: string|null } — реакция на сообщение (T10).
// ТОЛЬКО личка друзей (kind=friend) — рулетка анонимна/эфемерна, реакции туда не идут.
// Формат хранения: Message.reactions JSON, publicId → emoji (одна реакция на юзера).
// emoji=null снимает свою реакцию. Мердж на сервере по СВОЕМУ publicId — нельзя подделать
// реакцию за собеседника; проверка участия в Conversation — нельзя реагировать на чужой диалог.
export async function POST(req: Request) {
  const uid = await getUid(req);
  if (!uid) return unauthorized();
  if (!rateLimit(`react:${uid}`, 60, 60_000)) return Response.json({ error: "rate limited" }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { messageId?: unknown; emoji?: unknown };
  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  const emoji = typeof body.emoji === "string" && body.emoji ? body.emoji.slice(0, 8) : null;
  if (!messageId) return Response.json({ error: "messageId required" }, { status: 400 });

  const admin = supabaseAdmin();
  const me = await myProfileCore(admin, uid);
  if (!me) return Response.json({ error: "profile not found" }, { status: 404 });

  const { data: msgRow } = await admin.from("Message").select("id,conversationId,reactions").eq("id", messageId).maybeSingle();
  const msg = msgRow as { id: string; conversationId: string; reactions: Record<string, string> | null } | null;
  if (!msg) return Response.json({ error: "not found" }, { status: 404 });

  const { data: convRow } = await admin.from("Conversation").select("profileAId,profileBId,kind").eq("id", msg.conversationId).maybeSingle();
  const conv = convRow as { profileAId: string; profileBId: string; kind: string } | null;
  if (!conv || conv.kind !== "friend" || (conv.profileAId !== me.id && conv.profileBId !== me.id)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const reactions = { ...(msg.reactions ?? {}) };
  if (emoji) reactions[me.publicId] = emoji;
  else delete reactions[me.publicId];
  const next = Object.keys(reactions).length ? reactions : null;

  const { error } = await admin.from("Message").update({ reactions: next }).eq("id", messageId);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true, reactions: next ?? {} });
}
