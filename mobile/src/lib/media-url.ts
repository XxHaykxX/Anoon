import { authedFileUrl, getTinodeClient } from '@/lib/tinode';

/**
 * Ссылки на файлы Tinode для `<Image source={{ uri }}>`.
 *
 * Абсолютный адрес делает уже сам `authedFileUrl` — он подставляет
 * `platform().fileBaseUrl` (на вебе пустая строка, на телефоне — origin
 * бэкенда). Здесь остались только два удобства поверх него.
 */

/** Готовый URL по Tinode-ref, или `null` если ref пустой. */
export function fileUrl(ref: string | null | undefined): string | null {
  return ref ? authedFileUrl(ref) : null;
}

/** Фото контакта (`public.photo.ref`) по имени топика, или `null`. */
export function avatarUrlFor(topic: string | undefined): string | null {
  if (!topic) return null;
  return fileUrl(getTinodeClient().avatarRefFor(topic));
}
