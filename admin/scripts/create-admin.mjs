// Создать/обновить супер-админа. Хеширует пароль argon2id и апсертит AdminUser.
// Запуск (из admin/):
//   node --env-file=.env scripts/create-admin.mjs
// Требует env: SUPABASE_URL, SUPABASE_SECRET_KEY, ADMIN_EMAIL, ADMIN_PASSWORD.
// Опц.: ADMIN_TOTP_SECRET (base32) — включит 2FA для этого админа.

import { hash } from "@node-rs/argon2";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SECRET_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TOTP_SECRET } = process.env;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Нужны SUPABASE_URL и SUPABASE_SECRET_KEY");
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Нужны ADMIN_EMAIL и ADMIN_PASSWORD");
  process.exit(1);
}

const email = ADMIN_EMAIL.trim().toLowerCase();
const passwordHash = await hash(ADMIN_PASSWORD);
const row = {
  email,
  passwordHash,
  role: "super_admin",
  totpSecret: ADMIN_TOTP_SECRET?.trim() || null,
};

const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const { error } = await db.from("AdminUser").upsert(row, { onConflict: "email" });
if (error) {
  console.error("Ошибка апсерта AdminUser:", error.message);
  process.exit(1);
}
console.log(`✔ Админ готов: ${email}${row.totpSecret ? " (2FA включена)" : ""}`);
