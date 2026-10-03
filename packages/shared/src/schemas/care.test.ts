import { describe, expect, it } from 'vitest';
import { NICKNAME_MAX_LENGTH, NicknameSchema, RenameSquishyRequestSchema } from './care.js';

describe('NicknameSchema', () => {
  it('trims and squashes spaces', () => {
    expect(NicknameSchema.parse('  Sir   Puffs  ')).toBe('Sir Puffs');
    expect(NicknameSchema.parse("Bo's Pal-2!")).toBe("Bo's Pal-2!");
    expect(NicknameSchema.parse('Ñoño')).toBe('Ñoño');
    expect(NicknameSchema.parse('Puff\n\tPuff')).toBe('Puff Puff');
  });

  it('needs a letter or two, and not too many', () => {
    expect(NicknameSchema.safeParse('   ').success).toBe(false);
    expect(NicknameSchema.safeParse('x'.repeat(NICKNAME_MAX_LENGTH)).success).toBe(true);
    expect(NicknameSchema.safeParse('x'.repeat(NICKNAME_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('keeps out markup and odd symbols', () => {
    for (const bad of ['<b>hi</b>', 'puff@home', '💖', 'x\u200by']) {
      expect(NicknameSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('RenameSquishyRequestSchema', () => {
  it('takes a name or null, nothing else', () => {
    expect(RenameSquishyRequestSchema.parse({ nickname: ' Puff ' })).toEqual({ nickname: 'Puff' });
    expect(RenameSquishyRequestSchema.parse({ nickname: null })).toEqual({ nickname: null });
    expect(RenameSquishyRequestSchema.safeParse({}).success).toBe(false);
    expect(RenameSquishyRequestSchema.safeParse({ nickname: 'a', extra: 1 }).success).toBe(false);
  });
});
