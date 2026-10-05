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

  it('keeps mild potty words out of names, not messages (owner decision 2026-10-05, #155)', () => {
    for (const name of [
      'Mr Poop Butt',
      'MrPoopButt',
      'poopy',
      'B_u_t_t',
      'fartface',
      'Booger7',
      'Sir Pee',
      'PeePee',
      'WeeWee',
      'crap_pal',
      'Crappy',
      'Dumb Dumb',
      'Bu77',
      'P00p',
    ]) {
      expect(checkText(name, 'name'), name).toEqual({ ok: false, reason: 'potty' });
    }
    // Everyday words that hold one, and names that only sound close, stay fine.
    for (const name of [
      'Butterfly',
      'Button',
      'Farther',
      'Saturday',
      'Scrappy',
      'Peekaboo',
      'Dumbo',
      'Speedy',
      'Peep',
      'Weevil',
      'Spooky',
      'Pookie',
      'Closer',
      'Sweet Pea',
    ]) {
      expect(checkText(name, 'name'), name).toEqual({ ok: true });
    }
    // Messages aren't names: a potty word there is allowed (ids only today anyway).
    expect(checkText('that squishy is a poop', 'message')).toEqual({ ok: true });
    // Real rudeness still reads as rude, not potty.
    expect(checkText('poop fuck', 'name')).toEqual({ ok: false, reason: 'rude' });
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

  it('says why, sweetly, for a potty name and never repeats it', () => {
    let caught: unknown;
    try {
      assertAllowedText('Mr Poop Butt', 'name');
    } catch (err) {
      caught = err;
    }
    const err = caught as AppError;
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.message).toBe("Let's keep names sweet, not stinky! Try another one.");
    expect(err.message).not.toMatch(/poop|butt/i);
  });

  it('passes clean text', () => {
    expect(() => {
      assertAllowedText('pumpkinpal', 'name');
    }).not.toThrow();
  });
});
