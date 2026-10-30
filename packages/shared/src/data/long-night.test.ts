import { describe, expect, it } from 'vitest';
import * as publicEntry from '../index.js';
import { checkLongNightSecrets } from '../schemas/data/long-night-secrets.js';
import { checkLongNightRules, LongNightWeekdaySchema } from '../schemas/data/long-night.js';
import * as serverEntry from './server/index.js';
import { LONG_NIGHT_SECRETS } from './server/long-night.js';
import { LONG_NIGHT_RULES } from './long-night.js';

describe('the Long Night rules (#727)', () => {
  it('are valid, and start every patch on Saturday (owner decision Q5)', () => {
    expect(checkLongNightRules(LONG_NIGHT_RULES)).toEqual([]);
    expect(LONG_NIGHT_RULES.defaultWeekday).toBe(6);
  });

  it('refuses rules that would break the Night', () => {
    expect(checkLongNightRules({ ...LONG_NIGHT_RULES, defaultWeekday: 7 })).not.toEqual([]);
    expect(checkLongNightRules({ ...LONG_NIGHT_RULES, gapOpenHours: 0 })).not.toEqual([]);
    expect(checkLongNightRules({ ...LONG_NIGHT_RULES, rescueRewardsMultiplier: 0.5 })).not.toEqual(
      [],
    );
    expect(checkLongNightRules({ ...LONG_NIGHT_RULES, noticeDays: 7 })).not.toEqual([]);
    expect(checkLongNightRules({ ...LONG_NIGHT_RULES, strengthMultiplier: 3 })).not.toEqual([]);
  });

  it('counts weekdays from Sunday (0) to Saturday (6)', () => {
    expect(LongNightWeekdaySchema.safeParse(0).success).toBe(true);
    expect(LongNightWeekdaySchema.safeParse(6).success).toBe(true);
    expect(LongNightWeekdaySchema.safeParse(-1).success).toBe(false);
    expect(LongNightWeekdaySchema.safeParse(7).success).toBe(false);
    expect(LongNightWeekdaySchema.safeParse(2.5).success).toBe(false);
  });
});

describe('the Long Night secrets (#727, rule 6)', () => {
  it('are valid', () => {
    expect(checkLongNightSecrets(LONG_NIGHT_SECRETS)).toEqual([]);
    expect(checkLongNightSecrets({ strengthMultiplier: 0 })).not.toEqual([]);
    expect(checkLongNightSecrets({ ...LONG_NIGHT_SECRETS, extra: 1 })).not.toEqual([]);
  });

  it('keep how much stronger he is server-only', () => {
    for (const name of ['LONG_NIGHT_SECRETS', 'LongNightSecretsSchema', 'checkLongNightSecrets']) {
      expect(name in serverEntry, name).toBe(true);
      expect(name in publicEntry, name).toBe(false);
    }
    expect('strengthMultiplier' in LONG_NIGHT_RULES).toBe(false);
    expect('LONG_NIGHT_RULES' in publicEntry).toBe(true);
  });
});
