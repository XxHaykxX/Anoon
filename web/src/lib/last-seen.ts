// Онлайн-статус по свежести lastSeen. Profile.online в БД не гасится (нет крона) — поэтому
// «в сети» считаем по порогу свежести heartbeat (клиент шлёт /api/presence каждые ~30с),
// как это делает и админка. Порог с запасом на пропущенный тик.
const ONLINE_MS = 90_000;

export function isOnline(lastSeen?: string | null): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < ONLINE_MS;
}

// Русская подпись присутствия. Гендер-нейтрально через «был(а)» (как в популярных RU-мессенджерах).
export function presenceLabel(lastSeen?: string | null): string {
  if (isOnline(lastSeen)) return "в сети";
  if (!lastSeen) return "не в сети";
  const diffMs = Date.now() - new Date(lastSeen).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "был(а) в сети недавно";
  if (min < 60) return `был(а) в сети ${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `был(а) в сети ${hr} ч назад`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "был(а) в сети вчера";
  if (days < 7) return `был(а) в сети ${days} дн назад`;
  return "был(а) в сети давно";
}
