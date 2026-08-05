import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_COOKIE, verifySession } from "@/lib/admin-session";

// Proxy (бывш. middleware, Next 16). Default-deny: всё, кроме /login и /api/auth/*,
// требует валидной сессии. Активно при NEXT_PUBLIC_DATA_MODE=api (иначе mock — гейт клиентский).
const PUBLIC = ["/login", "/api/auth/login", "/api/auth/logout"];

export async function proxy(req: NextRequest) {
  // В mock-режиме не трогаем (демо без бэкенда).
  if (process.env.NEXT_PUBLIC_DATA_MODE !== "api") return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();

  const session = await verifySession(req.cookies.get(ADMIN_COOKIE)?.value);
  if (session) return NextResponse.next();

  // API → 401 JSON; страницы → редирект на логин.
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // Пропускаем статику/ассеты Next + PWA-файлы (sw.js, manifest, иконки) — иначе default-deny
  // редиректит их на /login и PWA не работает. Проверяем всё остальное.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon).*)"],
};
