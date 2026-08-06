// Создать/обновить оператора панели. Хеширует пароль argon2id и апсертит AdminUser.
// Запуск (из admin/):
//   node --env-file=.env scripts/create-admin.mjs                  # super_admin (по умолчанию)
//   node --env-file=.env scripts/create-admin.mjs --role moderator
//
// Роль раньше была зашита в `super_admin`, и модератора приходилось дописывать
// руками в Supabase. А без модератора не проверить единственное место, где роль
// реально что-то решает: отказ в перманентном бане и в снятии бана.
//
// Требует env: SUPABASE_URL, SUPABASE_SECRET_KEY, ADMIN_EMAIL, ADMIN_PASSWORD.
// Опц.: ADMIN_TOTP_SECRET (base32) — включит 2FA для этого оператора;
//       ADMIN_ROLE — то же, что --role (флаг имеет приоритет).

import { hash } from "@node-rs/argon2";
import { createClient } from "@supabase/supabase-js";

const ROLES = ["super_admin", "moderator"];

function roleFromArgs(argv) {
  const i = argv.indexOf("--role");
  if (i !== -1) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith("--role="));
  return inline ? inline.slice("--role=".length) : undefined;
}

const { SUPABASE_URL, SUPABASE_SECRET_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TOTP_SECRET, ADMIN_ROLE } =
  process.env;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Нужны SUPABASE_URL и SUPABASE_SECRET_KEY");
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("Нужны ADMIN_EMAIL и ADMIN_PASSWORD");
  process.exit(1);
}

const role = (roleFromArgs(process.argv.slice(2)) ?? ADMIN_ROLE ?? "super_admin").trim();
if (!ROLES.includes(role)) {
  // Опечатка в роли не должна тихо завести оператора с правами, которых не ждали.
  console.error(`Неизвестная роль: ${role}. Допустимо: ${ROLES.join(" | ")}`);
  process.exit(1);
}

const email = ADMIN_EMAIL.trim().toLowerCase();
const passwordHash = await hash(ADMIN_PASSWORD);
const row = {
  email,
  passwordHash,
  role,
  totpSecret: ADMIN_TOTP_SECRET?.trim() || null,
};

const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
// upsert по email: повторный запуск с другой ролью МЕНЯЕТ роль существующего
// оператора. Это и есть способ понизить/повысить — но помнить об этом стоит,
// иначе «пересоздал админа» может тихо снять права.
const { error } = await db.from("AdminUser").upsert(row, { onConflict: "email" });
if (error) {
  console.error("Ошибка апсерта AdminUser:", error.message);
  process.exit(1);
}
console.log(`✔ Оператор готов: ${email} — роль ${role}${row.totpSecret ? ", 2FA включена" : ""}`);
