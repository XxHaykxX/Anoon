"use client";

import { supabase } from "@/lib/supabase";

// Клиентская работа с Supabase Storage (бакет media, приватный).
// Загрузка — напрямую в Storage по signed-upload-URL (обход serverless body-лимита).
const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api";
const BUCKET = "media";

// Загрузить blob → вернуть { path, mediaId } (или null при ошибке).
export async function uploadMedia(
  blob: Blob,
  kind: "image" | "video" | "voice",
  mime: string,
  accessToken: string,
): Promise<{ path: string; mediaId: string } | null> {
  const res = await fetch(`${BASE}/media/create-upload`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ kind, mime }),
  });
  if (!res.ok) return null;
  const { path, token, mediaId } = (await res.json()) as { path: string; token: string; mediaId: string };
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, blob, { contentType: mime });
  if (error) return null;
  return { path, mediaId };
}

// Получить временный signed URL для показа медиа по пути.
export async function resolveMediaUrl(path: string, accessToken: string): Promise<string | null> {
  const res = await fetch(`${BASE}/media/download`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) return null;
  const { url } = (await res.json()) as { url: string };
  return url;
}
