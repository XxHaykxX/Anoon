import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { statusFor } from "@/lib/companion-client";

import { listResource } from "@/lib/admin-repo";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-session";

export const runtime = "nodejs";

// Чтение списка требует залогиненного оператора — ровно как мутации в [id]/route.ts.
// Одного proxy.ts тут мало: он default-deny только при NEXT_PUBLIC_DATA_MODE=api, а при
// любом другом значении пропускает всё, тогда как listResource всё равно идёт в РЕАЛЬНЫЕ
// данные (companion при ADMIN_BACKEND=companion, иначе Supabase). Сочетание
// «ADMIN_BACKEND=companion + режим не api» отдавало бы жалобы/юзеров/баны анониму.
// Проверка здесь не зависит от env и закрывает оба бэкенда сразу.
// Мок-режим сюда не заходит вовсе: там UI работает на mockDataProvider, который не делает
// ни одного fetch — так что dev-цикл на фикстурах не задет.
export async function GET(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  const jar = await cookies();
  const session = await verifySession(jar.get(ADMIN_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const sp = url.searchParams;
  const filters: Record<string, string> = {};
  for (const [k, v] of sp.entries()) if (k.startsWith("f_")) filters[k.slice(2)] = v;

  try {
    const result = await listResource(resource, {
      page: sp.get("page") ? Number(sp.get("page")) : undefined,
      pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : undefined,
      sort: sp.get("sort") ?? undefined,
      order: (sp.get("order") as "asc" | "desc") ?? undefined,
      filters,
      // По НАЛИЧИЮ параметра, не по его непустоте: `ids=` — это «только эти, то
      // есть никого». Проверка на истинность строки превращала пустой набор в
      // отсутствие фильтра, и getMany ни за что отдавал первую страницу целиком
      // (замерено: `ids=` возвращал все 13 строк вместо нуля).
      ids: sp.has("ids") ? sp.get("ids")!.split(",").filter(Boolean) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: statusFor(err, 400) });
  }
}
