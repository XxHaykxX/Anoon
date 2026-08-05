import { jwtVerify, SignJWT } from "jose";

// Подписанная httpOnly-сессия админа (JWT HS256). Edge-safe (jose на Web Crypto) —
// используется и в middleware, и в route handlers.
export const ADMIN_COOKIE = "anoon_admin";
const ALG = "HS256";
const TTL_SECONDS = 60 * 60 * 8; // 8 часов

export type AdminSession = { sub: string; email: string; role: "super_admin" | "moderator" };

function secret(): Uint8Array {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("ADMIN_SESSION_SECRET не задан (>=16 симв.)");
  return new TextEncoder().encode(s);
}

export async function signSession(payload: AdminSession): Promise<string> {
  return new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<AdminSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
    if (!payload.sub) return null;
    return { sub: payload.sub, email: String(payload.email ?? ""), role: (payload.role as AdminSession["role"]) ?? "moderator" };
  } catch {
    return null;
  }
}

export const COOKIE_MAX_AGE = TTL_SECONDS;
