"use client";

import { supabase } from "@/lib/supabase";

// Клиентская работа с Supabase Storage (бакет media, приватный).
// Загрузка — напрямую в Storage по signed-upload-URL (обход serverless body-лимита).
const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api";
const BUCKET = "media";

type UploadOk = { path: string; mediaId: string };

// Одна попытка аплоада: успех → объект, ошибка → строка-причина (для лога/ретрая).
async function tryUpload(
  blob: Blob,
  kind: "image" | "video" | "voice",
  mime: string,
  accessToken: string,
): Promise<UploadOk | string> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/media/create-upload`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ kind, mime }),
    });
  } catch (e) {
    return `create-upload fetch: ${e instanceof Error ? e.message : e}`;
  }
  if (!res.ok) {
    const detail = await res.json().then((j) => (j as { error?: string }).error).catch(() => "");
    return `create-upload ${res.status}: ${detail ?? ""}`;
  }
  const { path, token, mediaId } = (await res.json()) as { path: string; token: string; mediaId: string };
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, blob, { contentType: mime });
  if (error) return `uploadToSignedUrl: ${error.message}`;
  return { path, mediaId };
}

// Загрузить blob → { path, mediaId } (или null). Ретрай 3× — гасит гонку синка профиля
// (create-upload 404) и transient-сбои сети/токена. Причина каждой неудачи — в консоль (dev).
export async function uploadMedia(
  blob: Blob,
  kind: "image" | "video" | "voice",
  mime: string,
  accessToken: string,
): Promise<UploadOk | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await tryUpload(blob, kind, mime, accessToken);
    if (typeof r !== "string") return r;
    if (process.env.NODE_ENV !== "production") console.warn(`[uploadMedia] попытка ${attempt + 1} не удалась: ${r}`);
    if (attempt < 2) await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
  }
  return null;
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
