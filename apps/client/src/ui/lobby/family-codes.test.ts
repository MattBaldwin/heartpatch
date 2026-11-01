import type { SignupCodeSummary } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  codeDays,
  codeLifeLeft,
  familyCodeBadge,
  familyCodeMeta,
  FAMILY_CODE_ACCOUNTS_ONLY,
  familyCodeUsedBy,
  joinCodeNudge,
  liveFamilyCodes,
} from './family-codes.js';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const DAY_MS = 86_400_000;

const code = (overrides: Partial<SignupCodeSummary> = {}): SignupCodeSummary => ({
  id: '01a11388-937a-7daa-8641-fb860cc8e15d',
  label: 'Smith family',
  status: 'live',
  uses: 3,
  maxUses: 8,
  expiresAt: new Date(NOW + 12 * DAY_MS).toISOString(),
  usedBy: [],
  ...overrides,
});

describe('family code lines', () => {
  it('says uses and days left while live', () => {
    expect(familyCodeMeta(code(), NOW)).toBe('3 of 8 used · 12 days left');
    expect(familyCodeMeta(code({ expiresAt: new Date(NOW + 3_600_000).toISOString() }), NOW)).toBe(
      '3 of 8 used · last day!',
    );
  });

  it('drops the days and adds a badge once a code has ended', () => {
    expect(familyCodeMeta(code({ status: 'used_up', uses: 8 }), NOW)).toBe('8 of 8 used');
    expect(familyCodeBadge('live')).toBeNull();
    expect(familyCodeBadge('used_up')).toBe('All used up');
    expect(familyCodeBadge('expired')).toBe('Too old');
    expect(familyCodeBadge('revoked')).toBe('Turned off');
  });

  it('lists who used it', () => {
    expect(familyCodeUsedBy(code())).toBeNull();
    expect(familyCodeUsedBy(code({ usedBy: ['fern'] }))).toBe('Used by fern');
    expect(familyCodeUsedBy(code({ usedBy: ['maple_leaf', 'oakley', 'fern'] }))).toBe(
      'Used by maple_leaf, oakley and fern',
    );
  });

  it('counts live codes against the cap', () => {
    expect(liveFamilyCodes([code(), code({ status: 'revoked' }), code()])).toBe(2);
  });
});

describe('days left on a code (#583)', () => {
  const expiresAt = new Date(NOW + 14 * DAY_MS).toISOString();

  it('counts from the time it is given (the game clock), not the device clock', () => {
    expect(codeDays(expiresAt, NOW)).toBe('14 days');
    expect(codeLifeLeft(expiresAt, NOW)).toBe('Works for 14 more days.');
    expect(codeDays(expiresAt, NOW - 7 * DAY_MS)).toBe('21 days');
  });

  it('rounds up, and says the last day plainly', () => {
    expect(codeDays(new Date(NOW + 3_600_000).toISOString(), NOW)).toBe('1 day');
    expect(codeDays(new Date(NOW - DAY_MS).toISOString(), NOW)).toBe('1 day');
    expect(codeLifeLeft(new Date(NOW + DAY_MS).toISOString(), NOW)).toBe(
      'Works until tomorrow at the latest.',
    );
  });
});

describe('joinCodeNudge', () => {
  it('explains a family code typed into Join a patch, however it is typed', () => {
    for (const typed of ['K7PQM3TRHXWA', 'k7pq-m3tr-hxwa', ' k7pq m3tr hxwa ']) {
      expect(joinCodeNudge(typed)).toContain('family code');
      expect(joinCodeNudge(typed)).toContain('8-letter invite code');
    }
  });

  it('leaves real invite codes and typos to the normal check', () => {
    expect(joinCodeNudge('K7PQ-M3TR')).toBeNull();
    expect(joinCodeNudge('K7PQ')).toBeNull();
    expect(joinCodeNudge('')).toBeNull();
  });

  it('tells a new family code owner it is for new accounts only', () => {
    expect(FAMILY_CODE_ACCOUNTS_ONLY).toContain('new accounts');
  });
});
