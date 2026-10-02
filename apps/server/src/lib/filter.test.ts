import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';
import { assertAllowedText, checkText } from './filter.js';

describe('checkText', () => {
  it('allows friendly names and messages', () => {
    for (const name of ['pumpkinpal', 'Moth_Muffin', 'Gourdon7', 'classic', 'grass', 'cockatoo']) {
      expect(checkText(name, 'name')).toEqual({ ok: true });
    }
    for (const msg of ['Nice trade!', 'Watch out, it is getting dark!', 'I have 3 squishies']) {
      expect(checkText(msg, 'message')).toEqual({ ok: true });
    }
  });

  it('rejects profanity, including leetspeak and separators in names', () => {
    for (const name of ['fuck', 'FuCk3r', 'sh1t', 'f_u_c_k', 'b_i_t_c_h', 'hitler', 'nazi']) {
      expect(checkText(name, 'name')).toEqual({ ok: false, reason: 'rude' });
    }
    expect(checkText('you are a sh1t', 'message')).toEqual({ ok: false, reason: 'rude' });
  });

  it('rejects phone numbers', () => {
    for (const text of ['5551234567', 'call 555-123-4567', '(555) 123 4567', 'pal_555_1234']) {
      expect(checkText(text, 'message')).toEqual({ ok: false, reason: 'personal_info' });
    }
    // Short numbers are fine.
    expect(checkText('Gourdon2014', 'name')).toEqual({ ok: true });
  });

  it('rejects emails, links and addresses', () => {
    for (const text of [
      'me@example.com',
      'kid at gmail dot com',
      'https://example.org',
      'www.pumpkins',
      'go to pumpkinpatch.com',
      'I live at 42 Maple Street',
      '1200 north oak ave',
    ]) {
      expect(checkText(text, 'message')).toEqual({ ok: false, reason: 'personal_info' });
    }
  });
});

describe('assertAllowedText', () => {
  it('throws VALIDATION_FAILED with a kid-readable message that hides the word', () => {
    let caught: unknown;
    try {
      assertAllowedText('fuck', 'name');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    const err = caught as AppError;
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.message).toMatch(/kinder name/);
    expect(err.message).not.toMatch(/fuck/i);
  });

  it('passes clean text', () => {
    expect(() => {
      assertAllowedText('pumpkinpal', 'name');
    }).not.toThrow();
  });
});
