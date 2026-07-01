import { NextResponse } from "next/server";

import { listResource } from "@/lib/admin-repo";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
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
      ids: sp.get("ids") ? sp.get("ids")!.split(",") : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 400 });
  }
}
