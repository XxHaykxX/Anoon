"use client";

import { createClient } from "@supabase/supabase-js";

// Браузерный Supabase-клиент (publishable-ключ). Сессия хранится в localStorage.
// Мутации приватных данных идут через backend (@supabase/server, secret) — не отсюда.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url ?? "http://localhost", key ?? "anon", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "anoon-auth",
  },
});
