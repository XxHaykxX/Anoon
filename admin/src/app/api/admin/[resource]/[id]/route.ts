import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getOne, PermissionError, updateResource } from "@/lib/admin-repo";
import { ADMIN_COOKIE, verifySession } from "@/lib/admin-session";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params;
  try {
    const data = await getOne(resource, id);
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 400 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params;
  const jar = await cookies();
  const session = await verifySession(jar.get(ADMIN_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const values = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const data = await updateResource(resource, id, values, session.sub, session.role);
    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof PermissionError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 400 });
  }
}
