/* eslint-disable @typescript-eslint/no-explicit-any -- граница нетипизированного Supabase */
import { NextResponse } from "next/server";

import { bans, profiles, reports } from "@/data/fixtures";
import { companionEnabled, companionOnline, companionOverview } from "@/lib/companion-client";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// «Онлайн» = heartbeat за последние ONLINE_WINDOW_MS (online-флаг сам не сбрасывается).
const ONLINE_WINDOW_MS = 90_000;

// Companion пока не отдаёт admin-эндпоинты (см. ADMIN-REUSE-PLAN.md §5) — в mock-режиме
// (NEXT_PUBLIC_DATA_MODE!=="api") отвечаем фикстурами, чтобы страница работала без бэкенда.
const MOCK = process.env.NEXT_PUBLIC_DATA_MODE !== "api";
const MOCK_GENDER: Record<string, "male" | "female"> = { p1: "female", p2: "male", p3: "female", p4: "male" };

function mockOnline(gender: string | null) {
  const rows = profiles
    .filter((p) => p.online)
    .filter((p) => !gender || gender === "any" || MOCK_GENDER[p.id] === gender)
    .map((p) => ({
      id: p.id,
      publicId: p.publicId,
      nickname: p.nickname,
      emoji: p.emoji,
      realGender: MOCK_GENDER[p.id] ?? "any",
      lastSeen: new Date().toISOString(),
      reportCount: p.reportCount,
    }));
  return NextResponse.json({ profiles: rows });
}

function mockSummary() {
  const onlineRows = profiles.filter((p) => p.online);
  const onlineFemale = onlineRows.filter((p) => MOCK_GENDER[p.id] === "female").length;
  const onlineMale = onlineRows.filter((p) => MOCK_GENDER[p.id] === "male").length;
  return NextResponse.json({
    total: profiles.length,
    online: onlineRows.length,
    onlineFemale,
    onlineMale,
    onlineOther: onlineRows.length - onlineFemale - onlineMale,
    reportsOpen: reports.filter((r) => r.status === "open").length,
    bansActive: bans.filter((b) => b.state === "active").length,
  });
}

// GET /api/admin/overview — сводка: всего юзеров, онлайн (девочки/мальчики/скрытые), жалобы, баны.
// GET /api/admin/overview?online=1&gender=female|male|any — список онлайн-профилей по полу.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const online = url.searchParams.get("online");
  const gender = url.searchParams.get("gender"); // female | male | any

  if (MOCK) return online ? mockOnline(gender) : mockSummary();

  // ADMIN_BACKEND=companion → сводку/онлайн отдаёт companion (presence-трекер + агрегаты).
  if (companionEnabled()) {
    try {
      return NextResponse.json(online ? await companionOnline(gender) : await companionOverview());
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 400 });
    }
  }

  const admin = supabaseAdmin();
  const sinceIso = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();

  try {
    if (online) {
      let q = admin
        .from("Profile")
        .select("id,publicId,nickname,emoji,realGender,lastSeen,reportCount")
        .gte("lastSeen", sinceIso)
        .order("lastSeen", { ascending: false })
        .limit(500);
      if (gender === "female" || gender === "male" || gender === "any") q = q.eq("realGender", gender);
      const { data } = await q;
      return NextResponse.json({ profiles: (data ?? []) as any[] });
    }

    // Сводные счётчики.
    const [{ count: total }, onlineRows, { count: reportsOpen }, { count: bansActive }] = await Promise.all([
      admin.from("Profile").select("*", { count: "exact", head: true }),
      admin.from("Profile").select("realGender").gte("lastSeen", sinceIso).limit(5000),
      admin.from("Report").select("*", { count: "exact", head: true }).eq("status", "open"),
      admin.from("Ban").select("*", { count: "exact", head: true }).eq("state", "active"),
    ]);

    const rows = (onlineRows.data ?? []) as Array<{ realGender: string }>;
    const onlineFemale = rows.filter((r) => r.realGender === "female").length;
    const onlineMale = rows.filter((r) => r.realGender === "male").length;
    const onlineOther = rows.length - onlineFemale - onlineMale;

    return NextResponse.json({
      total: total ?? 0,
      online: rows.length,
      onlineFemale,
      onlineMale,
      onlineOther,
      reportsOpen: reportsOpen ?? 0,
      bansActive: bansActive ?? 0,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 400 });
  }
}
