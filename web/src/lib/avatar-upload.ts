"use client";

import { compressImage, uploadMedia } from "@/lib/storage";
import { supabase } from "@/lib/supabase";

// Загрузка фото профиля: тот же путь, что и обычные фото-сообщения (сжатие + bucket "media").
// Возвращает media-путь (НЕ http) — <Avatar> резолвит его в signed URL сам, как остальное медиа.
export async function uploadAvatarPhoto(file: Blob): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const { blob, mime } = await compressImage(file);
  const res = await uploadMedia(blob, "image", mime, token);
  return res?.path ?? null;
}
