import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  matchTotp,
  newTotpSecret,
  otpauthUri,
  totpCode,
  totpStep,
} from './totp.js';

// RFC 6238 appendix B's SHA-1 secret, "12345678901234567890", in base32.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('round-trips base32', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(() => base32Decode('not base32!')).toThrow();
  });

  it('matches the RFC 6238 test vectors (last 6 digits)', () => {
    const vectors: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ];
    for (const [seconds, code] of vectors) {
      expect(totpCode(RFC_SECRET, totpStep(new Date(seconds * 1000)))).toBe(code);
    }
  });

  it('accepts one step of drift either side, and nothing further', () => {
    const secret = newTotpSecret();
    const at = new Date('2026-10-07T12:00:10Z');
    const step = totpStep(at);
    expect(matchTotp(secret, totpCode(secret, step), at, null)).toBe(step);
    expect(matchTotp(secret, totpCode(secret, step - 1), at, null)).toBe(step - 1);
    expect(matchTotp(secret, totpCode(secret, step + 1), at, null)).toBe(step + 1);
    expect(matchTotp(secret, totpCode(secret, step - 2), at, null)).toBeNull();
    expect(matchTotp(secret, totpCode(secret, step + 2), at, null)).toBeNull();
  });

  it('never accepts a step at or before the last one used', () => {
    const secret = newTotpSecret();
    const at = new Date('2026-10-07T12:00:10Z');
    const step = totpStep(at);
    const code = totpCode(secret, step);
    expect(matchTotp(secret, code, at, step)).toBeNull();
    expect(matchTotp(secret, code, at, step - 1)).toBe(step);
  });

  it('refuses codes of the wrong shape', () => {
    const secret = newTotpSecret();
    const at = new Date();
    expect(matchTotp(secret, '', at, null)).toBeNull();
    expect(matchTotp(secret, '12345', at, null)).toBeNull();
    expect(matchTotp(secret, `${totpCode(secret, totpStep(at))}0`, at, null)).toBeNull();
  });

  it('makes 160-bit secrets and an otpauth link apps read', () => {
    const secret = newTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    expect(newTotpSecret()).not.toBe(secret);
    const uri = otpauthUri('Pumpkin Dad', secret);
    expect(uri).toMatch(/^otpauth:\/\/totp\/Heartpatch%20admin%3APumpkin%20Dad\?secret=/);
    expect(uri).toContain('&digits=6&period=30');
  });
});
