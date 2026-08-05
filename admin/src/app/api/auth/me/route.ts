import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ADMIN_COOKIE, verifySession } from "@/lib/admin-session";

export const runtime = "nodejs";

export async function GET() {
  const jar = await cookies();
  const session = await verifySession(jar.get(ADMIN_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ id: session.sub, name: session.email, role: session.role });
}
