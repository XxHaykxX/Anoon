import { createHmac } from "node:crypto";

// TOTP (RFC 6238, HMAC-SHA1, 6 цифр, шаг 30с). Без внешних зависимостей.
// Секрет — base32 (RFC 4648), как в Google Authenticator.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // 64-битный счётчик big-endian (верхние 32 бита практически нули).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

// Проверка токена с окном ±1 шаг (компенсация рассинхрона часов).
export function verifyTotp(secret: string, token: string, nowMs = Date.now()): boolean {
  const t = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(t)) return false;
  const key = base32Decode(secret);
  if (key.length === 0) return false;
  const step = Math.floor(nowMs / 1000 / 30);
  for (let w = -1; w <= 1; w++) {
    if (hotp(key, step + w) === t) return true;
  }
  return false;
}
