"use client";

import { supabase } from "@/lib/supabase";

// Клиентская работа с Supabase Storage (бакет media, приватный).
// Загрузка — напрямую в Storage по signed-upload-URL (обход serverless body-лимита).
const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api";
const BUCKET = "media";

type UploadOk = { path: string; mediaId: string };

// Сжатие/ресайз фото перед загрузкой: телефонные снимки 3-5МБ → ~200-500КБ.
// Быстрее аплоад И быстрее показ у собеседника. Фолбэк — оригинал при ошибке/если больше.
const MAX_DIM = 1600;
export async function compressImage(blob: Blob): Promise<{ blob: Blob; mime: string }> {
  try {
    if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return { blob, mime: blob.type || "image/jpeg" };
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob, mime: blob.type || "image/jpeg" };
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (out && out.size < blob.size) return { blob: out, mime: "image/jpeg" };
    return { blob, mime: blob.type || "image/jpeg" };
  } catch {
    return { blob, mime: blob.type || "image/jpeg" };
  }
}

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

// Крошечная превью (data URL ~1-2КБ) для мгновенного показа у собеседника (Telegram-стиль):
// показываем размытой сразу, пока грузится полное фото.
export async function makeThumbnail(blob: Blob): Promise<string | null> {
  try {
    if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return null;
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 32 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return c.toDataURL("image/jpeg", 0.5);
  } catch {
    return null;
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

// Превью-кадр (poster) из видео — мгновенный размытый показ, пока видео стримится.
// С жёсткими таймаутами: если кадр не готов быстро — отдаём null (НЕ виснем, аплоад не блокируем).
export async function makeVideoThumbnail(blob: Blob): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "metadata";
  v.src = url;
  try {
    await withTimeout(
      new Promise<void>((res, rej) => {
        v.onloadeddata = () => res();
        v.onerror = () => rej(new Error("video load"));
      }),
      3000,
    );
    await withTimeout(
      new Promise<void>((res) => {
        v.onseeked = () => res();
        v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
      }),
      1500,
    ).catch(() => {});
    const vw = v.videoWidth || 32;
    const vh = v.videoHeight || 32;
    const scale = Math.min(1, 32 / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.5);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute("src");
  }
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
