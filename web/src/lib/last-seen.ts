// Онлайн-статус по свежести lastSeen. Profile.online в БД не гасится (нет крона) — поэтому
// «в сети» считаем по порогу свежести heartbeat (клиент шлёт /api/presence каждые ~30с),
// как это делает и админка. Порог с запасом на пропущенный тик.
const ONLINE_MS = 90_000;

// Postgres timestamp приходит БЕЗ таймзоны (`2026-07-02T16:41:03.269`). JS `new Date()` парсит
// такую строку как ЛОКАЛЬНОЕ время → у юзера в UTC+N время сдвигается на N часов («был 4 ч назад»
// сразу после активности). Значения сервера — UTC, поэтому дописываем `Z`, если tz отсутствует.
function parseServerTime(s: string): number {
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(s);
  return new Date(hasTz ? s : s + "Z").getTime();
}

export function isOnline(lastSeen?: string | null): boolean {
  if (!lastSeen) return false;
  return Date.now() - parseServerTime(lastSeen) < ONLINE_MS;
}

// Русская подпись присутствия. Гендер-нейтрально через «был(а)» (как в популярных RU-мессенджерах).
export function presenceLabel(lastSeen?: string | null): string {
  if (isOnline(lastSeen)) return "в сети";
  if (!lastSeen) return "не в сети";
  const diffMs = Date.now() - parseServerTime(lastSeen);
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
