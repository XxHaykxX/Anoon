/* eslint-disable @typescript-eslint/no-explicit-any -- граница нетипизированного Supabase */
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// «Онлайн» = heartbeat за последние ONLINE_WINDOW_MS (online-флаг сам не сбрасывается).
const ONLINE_WINDOW_MS = 90_000;

// GET /api/admin/overview — сводка: всего юзеров, онлайн (девочки/мальчики/скрытые), жалобы, баны.
// GET /api/admin/overview?online=1&gender=female|male|any — список онлайн-профилей по полу.
export async function GET(req: Request) {
  const admin = supabaseAdmin();
  const url = new URL(req.url);
  const online = url.searchParams.get("online");
  const gender = url.searchParams.get("gender"); // female | male | any
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
