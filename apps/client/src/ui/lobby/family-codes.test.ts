import type { SignupCodeSummary } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  familyCodeBadge,
  familyCodeMeta,
  familyCodeUsedBy,
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
