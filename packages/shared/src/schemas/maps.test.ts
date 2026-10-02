import { describe, expect, it } from 'vitest';
import {
  CreateMapRequestSchema,
  formatInviteCode,
  InviteCodeSchema,
  MapNameSchema,
  normalizeInviteCode,
} from './maps.js';

describe('MapNameSchema', () => {
  it('trims and collapses spaces', () => {
    expect(MapNameSchema.parse('  Pumpkin   Hollow ')).toBe('Pumpkin Hollow');
  });

  it('accepts friendly names and refuses odd ones', () => {
    for (const ok of ["Moth's Meadow", 'Patch 2', 'Café Nook!', 'Ab']) {
      expect(MapNameSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ['a', ' ', 'x'.repeat(25), 'Patch <3', 'semi;colon']) {
      expect(MapNameSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('invite codes', () => {
  it('normalizes what people type', () => {
    expect(normalizeInviteCode('abcd efgh')).toBe('ABCDEFGH');
    expect(InviteCodeSchema.parse('wxyz-2345')).toBe('WXYZ2345');
    expect(formatInviteCode('WXYZ2345')).toBe('WXYZ-2345');
  });

  it('refuses wrong lengths and look-alike characters', () => {
    for (const bad of ['ABCD-EFG', 'ABCD-EFGHJ', 'ABCD-EFG0', 'ABCD-EFGI', 'ABCD-EFGU']) {
      expect(InviteCodeSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('CreateMapRequestSchema', () => {
  it('needs a name and an IANA-shaped time zone', () => {
    expect(CreateMapRequestSchema.safeParse({ name: 'Nice', timeZone: 'UTC' }).success).toBe(true);
    expect(CreateMapRequestSchema.safeParse({ name: 'Nice', timeZone: '+05:00' }).success).toBe(
      false,
    );
  });
});
