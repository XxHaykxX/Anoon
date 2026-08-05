import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase-клиент с secret-ключом (bypass RLS). Тот же паттерн, что в backend/.
// НИКОГДА не импортировать в клиентские компоненты — ключ привилегированный.
let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY не заданы (admin/.env)");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
