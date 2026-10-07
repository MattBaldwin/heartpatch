import { describe, expect, it } from 'vitest';
import {
  CreateSignupCodeRequestSchema,
  formatSignupCode,
  normalizeSignupCode,
  signupCodeShape,
} from './signup-codes.js';

describe('signup code shapes', () => {
  it('tells family codes, invites and anything else apart', () => {
    expect(signupCodeShape('k7pq m3tr-hxwa')).toBe('family');
    expect(signupCodeShape('WXYZ-2345')).toBe('invite');
    expect(signupCodeShape('heartpatch-dev-family')).toBe('other');
    // Look-alikes (0, I, U) aren't in the alphabet.
    expect(signupCodeShape('K7PQ-M3TR-HXW0')).toBe('other');
    expect(signupCodeShape('WXYZ-234')).toBe('other');
  });

  it('normalizes and formats', () => {
    expect(normalizeSignupCode(' k7pq-m3tr hxwa ')).toBe('K7PQM3TRHXWA');
    expect(formatSignupCode('K7PQM3TRHXWA')).toBe('K7PQ-M3TR-HXWA');
  });

  it('needs a short label', () => {
    expect(CreateSignupCodeRequestSchema.parse({ label: ' Lee family ' })).toEqual({
      label: 'Lee family',
    });
    expect(CreateSignupCodeRequestSchema.safeParse({ label: '  ' }).success).toBe(false);
    expect(CreateSignupCodeRequestSchema.safeParse({ label: 'x'.repeat(31) }).success).toBe(false);
  });
});
