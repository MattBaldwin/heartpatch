// Time-based one-time codes (RFC 6238, the 6-digit codes authenticator apps
// show) for admin sign-in (#196). HMAC-SHA1, 30-second steps: the defaults
// every authenticator app reads from an `otpauth://` link. Built on
// node:crypto so no dependency is needed.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ADMIN_RULES } from './limits.js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

/** RFC 4648 base32 without padding, as authenticator apps take secrets. */
export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32.charAt((value << (5 - bits)) & 31);
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const index = BASE32.indexOf(ch);
    if (index < 0) throw new Error('base32Decode: not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new 160-bit secret (RFC 4226's recommended length), base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The 30-second step a moment falls in. */
export function totpStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / STEP_SECONDS);
}

/** The code for one step (RFC 4226 dynamic truncation). */
export function totpCode(secret: string, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * The step a typed code matches, allowing one step either side for clock
 * drift, or null. A step at or before `lastStep` never matches, so each code
 * works once.
 */
export function matchTotp(
  secret: string,
  code: string,
  at: Date,
  lastStep: number | null,
): number | null {
  const now = totpStep(at);
  const typed = Buffer.from(code);
  let matched: number | null = null;
  // Check every step in the window so the time taken doesn't say which matched.
  for (let drift = -ADMIN_RULES.totpDriftSteps; drift <= ADMIN_RULES.totpDriftSteps; drift++) {
    const step = now + drift;
    const expected = Buffer.from(totpCode(secret, step));
    const same = expected.length === typed.length && timingSafeEqual(expected, typed);
    if (same && (lastStep === null || step > lastStep) && matched === null) matched = step;
  }
  return matched;
}

/** The link an authenticator app scans or takes pasted. */
export function otpauthUri(username: string, secret: string): string {
  const label = encodeURIComponent(`Heartpatch admin:${username}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('Heartpatch admin')}&algorithm=SHA1&digits=${String(DIGITS)}&period=${String(STEP_SECONDS)}`;
}
