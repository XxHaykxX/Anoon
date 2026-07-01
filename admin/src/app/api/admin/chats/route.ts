/* eslint-disable @typescript-eslint/no-explicit-any -- граница нетипизированного Supabase */
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const BUCKET = "media";
// «Идёт сейчас» = сообщение за последние LIVE_WINDOW_MS.
const LIVE_WINDOW_MS = 5 * 60_000;

// GET /api/admin/chats — список диалогов (свежие сверху) + пометка «идёт сейчас».
// GET /api/admin/chats?id=<conversationId> — сообщения диалога (со signed URL медиа).
export async function GET(req: Request) {
  const admin = supabaseAdmin();
  const id = new URL(req.url).searchParams.get("id");

  try {
    if (!id) {
      const { data: convs } = await admin
        .from("Conversation")
        .select("id,profileAId,profileBId,lastMessageAt,createdAt")
        .order("lastMessageAt", { ascending: false, nullsFirst: false })
        .limit(200);
      const list = (convs ?? []) as any[];

      const pids = [...new Set(list.flatMap((c) => [c.profileAId, c.profileBId]))];
      const { data: profs } = pids.length
        ? await admin.from("Profile").select("id,nickname,publicId,emoji").in("id", pids)
        : { data: [] };
      const pmap = new Map((profs ?? []).map((p: any) => [p.id, p]));

      // Счётчики сообщений по диалогам.
      const ids = list.map((c) => c.id);
      const countByConv = new Map<string, number>();
      if (ids.length) {
        const { data: msgs } = await admin.from("Message").select("conversationId").in("conversationId", ids).limit(10000);
        for (const m of (msgs ?? []) as any[]) countByConv.set(m.conversationId, (countByConv.get(m.conversationId) ?? 0) + 1);
      }

      const now = Date.now();
      const conversations = list.map((c) => {
        const a = pmap.get(c.profileAId);
        const b = pmap.get(c.profileBId);
        return {
          id: c.id,
          a: { id: c.profileAId, nickname: a?.nickname ?? "—", publicId: a?.publicId ?? "", emoji: a?.emoji ?? "🙂" },
          b: { id: c.profileBId, nickname: b?.nickname ?? "—", publicId: b?.publicId ?? "", emoji: b?.emoji ?? "🙂" },
          messages: countByConv.get(c.id) ?? 0,
          lastMessageAt: c.lastMessageAt,
          createdAt: c.createdAt,
          live: c.lastMessageAt ? now - new Date(c.lastMessageAt).getTime() < LIVE_WINDOW_MS : false,
        };
      });
      return NextResponse.json({ conversations });
    }

    // Сообщения диалога.
    const { data: rows } = await admin
      .from("Message")
      .select("id,senderId,kind,text,mediaId,status,createdAt")
      .eq("conversationId", id)
      .order("createdAt", { ascending: true })
      .limit(2000);
    const msgs = (rows ?? []) as any[];

    // Медиа → signed URL.
    const mediaIds = [...new Set(msgs.map((m) => m.mediaId).filter(Boolean))];
    const urlById = new Map<string, { url: string; kind: string }>();
    if (mediaIds.length) {
      const { data: assets } = await admin.from("MediaAsset").select("id,r2Key,kind,deletedAt").in("id", mediaIds);
      await Promise.all(
        ((assets ?? []) as any[]).map(async (a) => {
          if (a.deletedAt) return;
          const { data } = await admin.storage.from(BUCKET).createSignedUrl(a.r2Key, 3600);
          if (data?.signedUrl) urlById.set(a.id, { url: data.signedUrl, kind: a.kind });
        }),
      );
    }

    const messages = msgs.map((m) => {
      const media = m.mediaId ? urlById.get(m.mediaId) : undefined;
      return {
        id: m.id,
        senderId: m.senderId,
        kind: m.kind,
        text: m.text ?? null,
        status: m.status,
        createdAt: m.createdAt,
        mediaUrl: media?.url ?? null,
        mediaKind: media?.kind ?? null,
      };
    });
    return NextResponse.json({ messages });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 400 });
  }
}
