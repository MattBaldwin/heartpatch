import { describe, expect, it } from 'vitest';
import { checkPushRules, checkPushText } from '../schemas/data/push.js';
import {
  PushKindSchema,
  PushPayloadSchema,
  PushSettingsPatchSchema,
  PushSubscribeRequestSchema,
  type PushPayload,
} from '../schemas/push.js';
import { HOME_BASE_RULES } from './home-base.js';
import { PUSH_RULES, PUSH_TEXT, pushLineFor, quietHoursContain } from './push.js';

describe('push nudges’ rules (#726)', () => {
  it('are valid, with quiet hours 9 PM–7 AM (owner answer 3)', () => {
    expect(checkPushRules(PUSH_RULES)).toEqual([]);
    expect(PUSH_RULES.quietHours).toEqual({ from: 21 * 60, to: 7 * 60 });
  });

  it('refuses rules that would break a nudge', () => {
    expect(checkPushRules({ ...PUSH_RULES, dailyCap: 0 })).not.toEqual([]);
    expect(checkPushRules({ ...PUSH_RULES, quietHours: { from: 1440, to: 0 } })).not.toEqual([]);
    expect(checkPushRules({ ...PUSH_RULES, quietHours: { from: 60, to: 60 } })).not.toEqual([]);
    // Every kind in the priority list, once.
    expect(
      checkPushRules({
        ...PUSH_RULES,
        priority: ['dusk', 'dusk', 'friend', 'gatherers', 'long-night-soon'],
      }),
    ).not.toEqual([]);
    expect(checkPushRules({ ...PUSH_RULES, priority: ['dusk'] })).not.toEqual([]);
    const ttlWithoutFriend = Object.fromEntries(
      Object.entries(PUSH_RULES.ttlSeconds).filter(([kind]) => kind !== 'friend'),
    );
    expect(checkPushRules({ ...PUSH_RULES, ttlSeconds: ttlWithoutFriend })).not.toEqual([]);
    expect(checkPushRules({ ...PUSH_RULES, sendNow: true })).not.toEqual([]);
  });

  it('knows quiet hours across midnight', () => {
    const minute = (h: number, m = 0) => h * 60 + m;
    expect(quietHoursContain(minute(20, 59))).toBe(false);
    expect(quietHoursContain(minute(21))).toBe(true);
    expect(quietHoursContain(minute(23, 59))).toBe(true);
    expect(quietHoursContain(0)).toBe(true);
    expect(quietHoursContain(minute(6, 59))).toBe(true);
    expect(quietHoursContain(minute(7))).toBe(false);
    expect(quietHoursContain(minute(12))).toBe(false);
    // A window that doesn't wrap.
    const nap = { from: minute(13), to: minute(14) };
    expect(quietHoursContain(minute(12, 59), nap)).toBe(false);
    expect(quietHoursContain(minute(13), nap)).toBe(true);
    expect(quietHoursContain(minute(14), nap)).toBe(false);
  });
});

describe('push nudges’ words (#726, rule 9)', () => {
  it('are valid, kid-safe and name nobody but the friend', () => {
    expect(checkPushText(PUSH_TEXT)).toEqual([]);
    expect(pushLineFor('friend', 'Moonberry')).toEqual({
      title: 'Moonberry is in your patch! 👋',
      body: 'Pop in and say hi.',
    });
    // The other kinds ignore a name.
    expect(pushLineFor('dusk', 'Moonberry')).toEqual(PUSH_TEXT.dusk);
    // A name is always literal, never a replacement pattern.
    expect(pushLineFor('friend', '$&$&').title).toBe('$&$& is in your patch! 👋');
  });

  it('refuses avoided words, stray names and unknown placeholders', () => {
    const withLine = (kind: keyof typeof PUSH_TEXT, title: string) => ({
      ...PUSH_TEXT,
      [kind]: { ...PUSH_TEXT[kind], title },
    });
    expect(checkPushText(withLine('dusk', 'Your squishy will die tonight'))).toEqual([
      'dusk.title: avoided words: die',
    ]);
    expect(checkPushText(withLine('dusk', '{name}, light a fire!'))[0]).toMatch(
      /^dusk\.title: needs/,
    );
    expect(checkPushText(withLine('friend', 'A friend is here!'))[0]).toMatch(
      /^friend\.title: needs/,
    );
    expect(checkPushText(withLine('gatherers', '{squishy} is done!'))).toEqual([
      'gatherers.title: unknown placeholder {squishy}',
    ]);
    const withoutDusk = Object.fromEntries(
      Object.entries(PUSH_TEXT).filter(([kind]) => kind !== 'dusk'),
    );
    expect(checkPushText(withoutDusk)).not.toEqual([]);
  });

  it('say the Long Night starts at nightfall', () => {
    expect(HOME_BASE_RULES.nightfallMinute).toBe(19 * 60);
    expect(PUSH_TEXT['long-night-soon'].body).toContain('starts at 7.');
  });

  it('fit every payload in the size cap, with the longest username', () => {
    const longestName = 'x'.repeat(20);
    for (const kind of PushKindSchema.options) {
      const payload: PushPayload = {
        v: 1,
        kind,
        ...pushLineFor(kind, longestName),
        mapId: '0199a000-0000-7000-8000-000000000000',
        tag: `${kind}/0199a000-0000-7000-8000-000000000000`,
      };
      expect(PushPayloadSchema.parse(payload)).toEqual(payload);
      expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThan(
        PUSH_RULES.maxPayloadBytes,
      );
    }
  });
});

describe('the push API contract (#726)', () => {
  const subscription = {
    endpoint: 'https://web.push.apple.com/QGfx1a2b3c',
    keys: { p256dh: `B${'a'.repeat(86)}`, auth: 'b'.repeat(22) },
    expirationTime: null,
  };

  it('takes a browser’s PushSubscription.toJSON()', () => {
    expect(PushSubscribeRequestSchema.parse(subscription)).toEqual(subscription);
    expect(
      PushSubscribeRequestSchema.parse({
        ...subscription,
        replaces: 'https://fcm.googleapis.com/x',
      }).replaces,
    ).toBe('https://fcm.googleapis.com/x');
  });

  it('refuses endpoints and keys a push service would never give', () => {
    const bad = (over: object) =>
      PushSubscribeRequestSchema.safeParse({ ...subscription, ...over }).success;
    expect(bad({ endpoint: 'http://web.push.apple.com/x' })).toBe(false);
    expect(bad({ endpoint: `https://web.push.apple.com/${'x'.repeat(2048)}` })).toBe(false);
    expect(bad({ keys: { p256dh: 'a+b/c=', auth: 'b'.repeat(22) } })).toBe(false);
    expect(bad({ keys: { p256dh: 'a'.repeat(129), auth: 'b'.repeat(22) } })).toBe(false);
    expect(bad({ keys: { ...subscription.keys, extra: 'x' } })).toBe(false);
    expect(bad({ userId: 'someone-else' })).toBe(false);
  });

  it('changes at least one setting at a time, and only known ones', () => {
    expect(PushSettingsPatchSchema.parse({ dusk: false })).toEqual({ dusk: false });
    expect(PushSettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(PushSettingsPatchSchema.safeParse({ hollow: false }).success).toBe(false);
  });
});
