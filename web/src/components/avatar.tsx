"use client";

import { useEffect, useState } from "react";

import { resolveMediaUrl } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

// Универсальный аватар — переиспользуется в чате, поиске, друзьях, профиле.
// avatarUrl: "http…" → прямой CDN-URL (Google-фото); иначе — путь в Storage bucket "media",
// резолвим через signed URL тем же путём, что и остальное медиа (lib/storage.ts::resolveMediaUrl).
// Без фото/пути — фолбэк: круг с первой буквой имени/ника на бренд-цвете, либо 🤫 для анонима.
export function Avatar({
  avatarUrl,
  name,
  publicId,
  size = 40,
  online,
  className,
}: {
  avatarUrl?: string;
  name?: string;
  publicId: string;
  size?: number;
  online?: boolean;
  className?: string;
}) {
  const direct = avatarUrl?.startsWith("http") ? avatarUrl : null;
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(direct);

  // Синк с новым avatarUrl — в фазе рендера (не в effect), чтобы http/пустой случай не требовал
  // setState в эффекте (react-hooks/set-state-in-effect); резолв media-пути остаётся в эффекте ниже.
  const [prevAvatarUrl, setPrevAvatarUrl] = useState(avatarUrl);
  if (avatarUrl !== prevAvatarUrl) {
    setPrevAvatarUrl(avatarUrl);
    setResolvedUrl(direct);
  }

  useEffect(() => {
    if (!avatarUrl || avatarUrl.startsWith("http")) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const url = await resolveMediaUrl(avatarUrl, token);
      if (!cancelled && url) setResolvedUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [avatarUrl]);

  const initial = name?.trim()?.[0]?.toUpperCase();

  return (
    <span
      className={cn("relative inline-flex shrink-0 select-none rounded-full", className)}
      style={{ width: size, height: size }}
      title={name || `#${publicId}`}
      aria-hidden="true"
    >
      {resolvedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolvedUrl} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center rounded-full bg-accent font-semibold text-accent-fg"
          style={{ fontSize: size * 0.42 }}
        >
          {initial || "🤫"}
        </span>
      )}
      {online ? (
        <span
          className="absolute bottom-0 right-0 rounded-full border-2 border-bg bg-success"
          style={{ width: Math.max(8, size * 0.28), height: Math.max(8, size * 0.28) }}
        />
      ) : null}
    </span>
  );
}
