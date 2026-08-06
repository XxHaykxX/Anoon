/* eslint-disable @typescript-eslint/no-explicit-any -- граница нетипизированного Supabase */
import { NextResponse } from "next/server";

import { statusFor } from "@/lib/companion-client";

import { profiles } from "@/data/fixtures";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const BUCKET = "media";
// «Идёт сейчас» = сообщение за последние LIVE_WINDOW_MS.
const LIVE_WINDOW_MS = 5 * 60_000;

// TODO(companion): БЛОКИРОВАНО юр. вопросом Q7a (COMPANION-PLAN.md §7) — доступ модератора
// к приватным перепискам целиком vs только по открытой жалобе не решён. Не реализовывать
// companion-путь, пока это не разрешено (см. #67 USER-1). Остаётся на Supabase-пути даже при
// ADMIN_BACKEND=companion; в mock-режиме — фикстуры. (см. ADMIN-REUSE-PLAN.md §5 п.2 /
// COMPANION-ADMIN-API.md §3)
const MOCK = process.env.NEXT_PUBLIC_DATA_MODE !== "api";
const MOCK_CONVS = [
  { id: "c1", aId: "p1", bId: "p3", messages: 2, lastMessageAt: new Date(Date.now() - 30_000).toISOString(), createdAt: "2026-06-30T09:00:00Z" },
  { id: "c2", aId: "p2", bId: "p4", messages: 2, lastMessageAt: "2026-06-29T15:40:00Z", createdAt: "2026-06-29T15:00:00Z" },
] as const;
const MOCK_MSGS: Record<string, { id: string; senderId: string; kind: string; text: string | null; status: string; createdAt: string; mediaUrl: string | null; mediaKind: string | null }[]> = {
  c1: [
    { id: "m1", senderId: "p1", kind: "text", text: "Привет! Как дела?", status: "read", createdAt: "2026-06-30T08:59:00Z", mediaUrl: null, mediaKind: null },
    { id: "m2", senderId: "p3", kind: "text", text: "Привет, отлично! А у тебя?", status: "read", createdAt: "2026-06-30T09:00:00Z", mediaUrl: null, mediaKind: null },
  ],
  c2: [
    { id: "m3", senderId: "p2", kind: "text", text: "Заходил вчера в игру?", status: "read", createdAt: "2026-06-29T15:39:00Z", mediaUrl: null, mediaKind: null },
    { id: "m4", senderId: "p4", kind: "text", text: "Не успел, сегодня попробую", status: "read", createdAt: "2026-06-29T15:40:00Z", mediaUrl: null, mediaKind: null },
  ],
};

function peer(id: string) {
  const p = profiles.find((x) => x.id === id);
  return { id, nickname: p?.nickname ?? "—", publicId: p?.publicId ?? "", emoji: p?.emoji ?? "🙂" };
}

function mockConversations() {
  const now = Date.now();
  const conversations = MOCK_CONVS.map((c) => ({
    id: c.id,
    a: peer(c.aId),
    b: peer(c.bId),
    messages: c.messages,
    lastMessageAt: c.lastMessageAt,
    createdAt: c.createdAt,
    live: now - new Date(c.lastMessageAt).getTime() < LIVE_WINDOW_MS,
  }));
  return NextResponse.json({ conversations });
}

// GET /api/admin/chats — список диалогов (свежие сверху) + пометка «идёт сейчас».
// GET /api/admin/chats?id=<conversationId> — сообщения диалога (со signed URL медиа).
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");

  if (MOCK) return id ? NextResponse.json({ messages: MOCK_MSGS[id] ?? [] }) : mockConversations();

  const admin = supabaseAdmin();

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
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: statusFor(err, 400) });
  }
}
