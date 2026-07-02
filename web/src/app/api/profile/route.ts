import { createHash } from "crypto";

import { getAuthUser, supabaseAdmin, unauthorized } from "@/lib/server/backend";

export const runtime = "nodejs";

type IdRow = { id: string } | null;
type ProfileRow = {
  id: string;
  publicId: string;
  nickname: string;
  realGender: string;
  genderLocked: boolean;
} | null;

const AUTH_PROVIDERS = new Set(["google", "apple", "anonymous", "email"]);
// Supabase provider-строка → AuthProvider enum. Незнакомое (маловероятно) → email.
function mapProvider(p: string): string {
  return AUTH_PROVIDERS.has(p) ? p : "email";
}
function emailHash(email: string | null): string | null {
  if (!email) return null;
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

// #ID через атомарный SEQUENCE (profile_public_seq) — снимает гонку параллельных регистраций
// (раньше count(Profile)+1 давал дубликаты #ID → 500 на unique). RPC next_public_id() создан
// миграцией. Фолбэк на count+1 — только если RPC недоступен (переходный период до деплоя функции).
async function nextPublicId(admin: ReturnType<typeof supabaseAdmin>): Promise<string> {
  const { data, error } = await admin.rpc("next_public_id");
  if (!error && typeof data === "string" && data.length > 0) return data;
  const { count } = await admin.from("Profile").select("*", { count: "exact", head: true });
  return String((count ?? 0) + 1).padStart(5, "0");
}

export async function POST(req: Request) {
  const auth = await getAuthUser(req);
  if (!auth) return unauthorized();
  const uid = auth.id;

  const body = (await req.json().catch(() => ({}))) as {
    nickname?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    avatarUrl?: unknown;
    gender?: unknown;
    ageBand?: unknown;
  };
  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  if (nickname.length < 2) return Response.json({ error: "nickname required (>=2)" }, { status: 400 });

  const firstName = typeof body.firstName === "string" ? body.firstName.trim().slice(0, 60) || null : null;
  const lastName = typeof body.lastName === "string" ? body.lastName.trim().slice(0, 60) || null : null;
  const avatarUrl = typeof body.avatarUrl === "string" ? body.avatarUrl.trim().slice(0, 500) || null : null;
  const ageBand = typeof body.ageBand === "string" ? body.ageBand.trim().slice(0, 20) || null : null;
  // Пол блокируется навсегда при выборе. Принимаем только male/female; всё прочее = «не задан».
  const gender = body.gender === "male" || body.gender === "female" ? body.gender : null;

  const admin = supabaseAdmin();

  // Провайдер-агностичный резолв аккаунта: сперва по supabaseUserId, затем legacy-anon (переход).
  let userId: string | undefined;
  const { data: byUid } = await admin.from("User").select("id").eq("supabaseUserId", uid).maybeSingle();
  userId = (byUid as IdRow)?.id;
  if (!userId) {
    const { data: legacy } = await admin
      .from("User").select("id").eq("provider", "anonymous").eq("providerId", uid).maybeSingle();
    userId = (legacy as IdRow)?.id;
    // Долечиваем legacy-строку: проставляем supabaseUserId, чтобы дальше резолв шёл по нему.
    if (userId) await admin.from("User").update({ supabaseUserId: uid }).eq("id", userId);
  }
  if (!userId) {
    const { data: newUser, error } = await admin
      .from("User")
      .insert({
        id: crypto.randomUUID(),
        provider: mapProvider(auth.provider),
        providerId: uid,
        supabaseUserId: uid,
        emailHash: emailHash(auth.email),
      })
      .select("id")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    userId = (newUser as IdRow)!.id;
  }

  const { data: existing } = await admin
    .from("Profile").select("id,publicId,nickname,realGender,genderLocked").eq("userId", userId).maybeSingle();
  const ex = existing as ProfileRow;

  if (ex) {
    const patch: Record<string, unknown> = {};
    if (ex.nickname !== nickname) patch.nickname = nickname;
    if (firstName !== null) patch.firstName = firstName;
    if (lastName !== null) patch.lastName = lastName;
    if (avatarUrl !== null) patch.avatarUrl = avatarUrl;
    if (ageBand !== null) patch.ageBand = ageBand;
    if (gender) {
      if (ex.genderLocked) {
        // Пол уже зафиксирован: попытка сменить на другой — запрет; тот же — no-op.
        if (ex.realGender !== gender) return Response.json({ error: "gender locked" }, { status: 409 });
      } else {
        patch.realGender = gender;
        patch.genderLocked = true;
      }
    }
    if (Object.keys(patch).length) await admin.from("Profile").update(patch).eq("id", ex.id);
    return Response.json({ id: ex.id, publicId: ex.publicId, nickname });
  }

  const publicId = await nextPublicId(admin);
  const { data: created, error: perr } = await admin
    .from("Profile")
    .insert({
      id: crypto.randomUUID(),
      userId,
      publicId,
      nickname,
      firstName,
      lastName,
      avatarUrl,
      ageBand,
      realGender: gender ?? "any",
      genderLocked: gender !== null,
      online: true,
    })
    .select("id,publicId,nickname")
    .single();
  if (perr) return Response.json({ error: perr.message }, { status: 400 });
  return Response.json(created);
}
