import { NextResponse } from "next/server";

import { companionEnabled, companionFile, statusFor } from "@/lib/companion-client";

export const runtime = "nodejs";

// GET /api/admin/file?ref=/v0/file/s/<id> — одно вложение из чата или галереи.
//
// Файл лежит у Tinode, и он не отдаст его браузеру оператора: нужен apikey и
// залогиненная сессия, а Tinode-аккаунта у оператора нет. Тянем через companion,
// который ходит ROOT-ботом, и стримим как есть — ключи наружу не выходят.
// Доступ: сессия проверена proxy (default-deny), companion дополнительно требует
// admin-секрет и подписанный токен оператора.
export async function GET(req: Request) {
  const ref = new URL(req.url).searchParams.get("ref");
  if (!ref) return NextResponse.json({ error: "ref required" }, { status: 400 });
  if (!companionEnabled()) return NextResponse.json({ error: "api mode required" }, { status: 404 });

  try {
    const upstream = await companionFile(ref);
    return new NextResponse(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "error" },
      { status: statusFor(err, 502) },
    );
  }
}
