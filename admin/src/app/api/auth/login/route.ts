import { verify as argonVerify } from "@node-rs/argon2";
import { NextResponse } from "next/server";

import { ADMIN_COOKIE, COOKIE_MAX_AGE, signSession, type AdminSession } from "@/lib/admin-session";
import { clearLogin, loginAllowed } from "@/lib/login-rate-limit";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTotp } from "@/lib/totp";

export const runtime = "nodejs"; // argon2 (native) + supabase-js — только Node.

type AdminRow = { id: string; email: string; passwordHash: string; role: AdminSession["role"]; totpSecret: string | null };

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown; totp?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const totp = typeof body.totp === "string" ? body.totp.trim() : "";

  if (!email || !password) return NextResponse.json({ error: "email и пароль обязательны" }, { status: 400 });

  const rlKey = `${ip}:${email}`;
  if (!loginAllowed(rlKey)) return NextResponse.json({ error: "слишком много попыток, подождите" }, { status: 429 });

  const admin = supabaseAdmin();
  const { data } = await admin.from("AdminUser").select("id,email,passwordHash,role,totpSecret").eq("email", email).maybeSingle();
  const user = data as AdminRow | null;

  // Единый ответ на «нет юзера / неверный пароль» — не раскрываем существование email.
  const invalid = () => NextResponse.json({ error: "неверные данные" }, { status: 401 });
  if (!user) return invalid();

  const okPass = await argonVerify(user.passwordHash, password).catch(() => false);
  if (!okPass) return invalid();

  // 2FA (TOTP), если включена.
  if (user.totpSecret) {
    if (!totp) return NextResponse.json({ error: "нужен код 2FA", need2fa: true }, { status: 401 });
    if (!verifyTotp(user.totpSecret, totp)) return invalid();
  }

  clearLogin(rlKey);

  // Аудит входа + lastLoginAt.
  await admin.from("AdminUser").update({ lastLoginAt: new Date().toISOString() }).eq("id", user.id);
  await admin.from("ModeratorAction").insert({ adminId: user.id, type: "login", ip });

  const token = await signSession({ sub: user.id, email: user.email, role: user.role });
  const res = NextResponse.json({ id: user.id, name: user.email, role: user.role });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
