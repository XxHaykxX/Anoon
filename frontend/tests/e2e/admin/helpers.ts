import { createHmac } from "node:crypto";
import type { BrowserContext } from "@playwright/test";

/**
 * Shared infra for the **admin panel** e2e suite — the first tests this app has
 * ever had (see docs/qa/QA-ADMIN.md, which until now was a read-the-code
 * checklist with nothing automated behind it).
 *
 * Lives under frontend/ because that is where the repo's only Playwright
 * install is; the specs drive a different origin (the admin app on :3002) via
 * the `admin` project in playwright.config.ts, with a desktop viewport instead
 * of the phone frame. Nothing here touches the PWA.
 *
 * Requires, all live:
 *   1. companion (:6062) with COMPANION_ADMIN_SECRET set
 *   2. the admin app BUILT AND STARTED in the only mode that proves anything:
 *        NEXT_PUBLIC_DATA_MODE=api ADMIN_BACKEND=companion \
 *        COMPANION_ADMIN_URL=http://localhost:6062 COMPANION_ADMIN_SECRET=... \
 *        npx next build && npx next start -p 3002
 *      (NEXT_PUBLIC_DATA_MODE is inlined at BUILD time — starting an app built
 *      in mock mode with the api env set silently keeps the mock data provider
 *      and every assertion here becomes a test of the fixtures.)
 *   3. ADMIN_SESSION_SECRET exported to the test process, matching the app's
 *
 * Run:  E2E_ADMIN=1 ADMIN_SESSION_SECRET=... npx playwright test --project=admin
 */

export const E2E_ADMIN = process.env.E2E_ADMIN === "1";

/** Call at the top of every admin spec (module scope, before `test(...)`). */
export function skipUnlessAdmin(test: { skip: (cond: boolean, reason: string) => void }): void {
  test.skip(
    !E2E_ADMIN,
    "Admin suite requires a live companion + the admin app started in " +
      "api/companion mode — set E2E_ADMIN=1 and ADMIN_SESSION_SECRET (see helpers.ts header).",
  );
}

export const ADMIN_COOKIE = "anoon_admin";
export type AdminRole = "super_admin" | "moderator";

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/**
 * Mint the same HS256 session JWT that POST /api/auth/login issues
 * (src/lib/admin-session.ts: sub/email/role claims, 8h TTL).
 *
 * Why mint instead of logging in through the form: the operator record lives in
 * Supabase (`AdminUser`), and the project this repo is configured against no
 * longer resolves — `acepsafoeihfrgbzrbif.supabase.co` is NXDOMAIN — so the
 * login form cannot be exercised from here at all. Everything AFTER the login
 * (the session gate, the role gate, and every companion-backed section) does
 * not involve Supabase and is fully testable, which is what this suite covers.
 * The login form itself stays a manual step in docs/qa/QA-ADMIN.md §0.3 until
 * there is a reachable Supabase or a local operator store.
 *
 * Hand-rolled rather than via `jose` so the frontend package needs no new
 * dependency for a 12-line signature.
 */
export function signAdminSession(role: AdminRole, sub = `e2e-${role}`): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("ADMIN_SESSION_SECRET must be set (>=16 chars) and match the admin app's");
  }
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256" }));
  const payload = b64url(
    JSON.stringify({ email: `${sub}@anoon.app`, role, sub, iat: now, exp: now + 3600 }),
  );
  const sig = b64url(createHmac("sha256", secret).update(`${head}.${payload}`).digest());
  return `${head}.${payload}.${sig}`;
}

/** Put a signed operator session on a context, as the login route's Set-Cookie would. */
export async function loginAs(context: BrowserContext, role: AdminRole): Promise<void> {
  const url = new URL(process.env.ADMIN_BASE_URL ?? "http://localhost:3002");
  await context.addCookies([
    {
      name: ADMIN_COOKIE,
      value: signAdminSession(role),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
