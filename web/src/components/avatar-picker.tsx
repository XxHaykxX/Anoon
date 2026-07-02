"use client";

import { Camera, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { Avatar } from "@/components/avatar";
import { uploadAvatarPhoto } from "@/lib/avatar-upload";

// Круглый пикер фото профиля: тап → выбор файла → мгновенный локальный превью (blob URL)
// + фоновая загрузка в Storage. onChange получает media-путь готового фото (не сам файл).
// Используется в register/confirm (шаг 2) и в /profile.
export function AvatarPicker({
  avatarUrl,
  name,
  publicId,
  onChange,
}: {
  avatarUrl?: string;
  name?: string;
  publicId: string;
  onChange: (path: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalPreview(URL.createObjectURL(file));
    setUploading(true);
    const path = await uploadAvatarPhoto(file);
    setUploading(false);
    if (path) onChange(path);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label="Выбрать фото профиля"
        className="relative flex h-[88px] w-[88px] items-center justify-center"
      >
        {localPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={localPreview} alt="" className="h-[88px] w-[88px] rounded-full object-cover" />
        ) : (
          <Avatar avatarUrl={avatarUrl} name={name} publicId={publicId} size={88} />
        )}
        <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg bg-accent text-accent-fg">
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
        </span>
      </button>
      <input ref={inputRef} type="file" accept="image/*" onChange={(e) => void onFile(e)} className="hidden" />
      <span className="text-xs text-fg-muted">Фото (необязательно)</span>
    </div>
  );
}
