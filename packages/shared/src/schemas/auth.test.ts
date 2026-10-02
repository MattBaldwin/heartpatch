import { describe, expect, it } from 'vitest';
import {
  formatRecoveryCode,
  LoginRequestSchema,
  normalizeRecoveryCode,
  RECOVERY_CODE_ALPHABET,
  RecoveryCodeSchema,
  SignupRequestSchema,
  TimeZoneSchema,
  UsernameSchema,
} from './auth.js';

describe('UsernameSchema', () => {
  it('accepts letters, numbers and underscores, trimmed', () => {
    expect(UsernameSchema.parse('  Pumpkin_Pal7 ')).toBe('Pumpkin_Pal7');
  });

  it('rejects short, long and fancy names with a kid-readable message', () => {
    for (const bad of ['ab', 'a'.repeat(17), 'pumpkin pal', 'pal!', 'pümpkin', '']) {
      const result = UsernameSchema.safeParse(bad);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toMatch(/^Names /);
    }
  });
});

describe('recovery codes', () => {
  it('has no look-alike characters', () => {
    for (const c of '01ILOU') expect(RECOVERY_CODE_ALPHABET).not.toContain(c);
  });

  it('normalizes case, spaces and dashes', () => {
    expect(normalizeRecoveryCode(' abcd-efgh jkmn ')).toBe('ABCDEFGHJKMN');
    expect(RecoveryCodeSchema.parse('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN');
  });

  it('formats in groups of four', () => {
    expect(formatRecoveryCode('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN');
  });

  it('rejects wrong lengths and characters outside the alphabet', () => {
    for (const bad of ['ABCD-EFGH-JKM', 'ABCD-EFGH-JKMNP', 'ABCD-EFGH-JKM0', 'ABCD-EFGH-JKMI']) {
      expect(RecoveryCodeSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('TimeZoneSchema', () => {
  it('accepts IANA-shaped names', () => {
    for (const tz of ['UTC', 'America/New_York', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5']) {
      expect(TimeZoneSchema.safeParse(tz).success).toBe(true);
    }
  });

  it('rejects offsets and junk', () => {
    for (const tz of ['', '+05:00', 'America/../etc', 'a b', '/UTC']) {
      expect(TimeZoneSchema.safeParse(tz).success).toBe(false);
    }
  });
});

describe('request schemas', () => {
  it('parses a signup', () => {
    const body = {
      signupCode: ' family ',
      username: 'pumpkinpal',
      password: 'correct horse',
      birthYear: 2014,
      timeZone: 'America/Chicago',
    };
    expect(SignupRequestSchema.parse(body)).toEqual({ ...body, signupCode: 'family' });
  });

  it('rejects a short signup password and a fractional birth year', () => {
    const base = {
      signupCode: 'family',
      username: 'pumpkinpal',
      password: 'correct horse',
      birthYear: 2014,
      timeZone: 'UTC',
    };
    expect(SignupRequestSchema.safeParse({ ...base, password: 'short' }).success).toBe(false);
    expect(SignupRequestSchema.safeParse({ ...base, birthYear: 2014.5 }).success).toBe(false);
  });

  it('only shape-checks login, so any password length is just "wrong"', () => {
    expect(LoginRequestSchema.safeParse({ username: 'pal', password: 'x' }).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ username: '', password: 'x' }).success).toBe(false);
  });
});
