// In-memory rate-limit логина (per-инстанс). На кластере → Redis/БД.
// Блокируем перебор пароля/TOTP по ключу (ip+email).
const hits = new Map<string, number[]>();

export function loginAllowed(key: string, max = 5, windowMs = 5 * 60_000): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

export function clearLogin(key: string): void {
  hits.delete(key);
}
