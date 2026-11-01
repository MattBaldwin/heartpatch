import { PUSH_RULES, PUSH_TEXT, PushKindSchema, pushLineFor } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { FALLBACK_NUDGE, mapIdOf, notificationOf, nudgeFor } from './push-payload.js';

const MAP_ID = '0b7c6f1e-3f4a-4c1b-9d2e-5a6b7c8d9e0f';

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const line = pushLineFor('dusk');
  return { v: 1, kind: 'dusk', ...line, mapId: MAP_ID, tag: `dusk:${MAP_ID}`, ...overrides };
}

describe('notificationOf', () => {
  it.each(PushKindSchema.options)('shows the server’s words for %s', (kind) => {
    const line = pushLineFor(kind, 'Moonberry');
    const data = JSON.stringify(payload({ kind, ...line, tag: `${kind}:${MAP_ID}` }));
    expect(notificationOf(data)).toEqual({
      title: line.title,
      body: line.body,
      tag: `${kind}:${MAP_ID}`,
      data: { mapId: MAP_ID, kind },
    });
  });

  it('takes already-parsed JSON and a patch-less nudge', () => {
    expect(notificationOf(payload({ mapId: null }))?.data).toEqual({ mapId: null, kind: 'dusk' });
  });

  it('passes the friend name through untouched (the server filtered it)', () => {
    const title = PUSH_TEXT.friend.title.replace('{name}', 'Moonberry');
    expect(notificationOf(payload({ kind: 'friend', title }))?.title).toBe(
      'Moonberry is in your patch! 👋',
    );
  });

  it.each(['title', 'body', 'tag', 'kind', 'mapId', 'v'])('refuses a payload without %s', (key) => {
    const data = Object.fromEntries(Object.entries(payload()).filter(([k]) => k !== key));
    expect(notificationOf(JSON.stringify(data))).toBeNull();
  });

  it.each([
    ['an unknown version', { v: 2 }],
    ['an unknown kind', { kind: 'hollow-man' }],
    ['an empty title', { title: '' }],
    ['a title too long', { title: 'x'.repeat(81) }],
    ['a map id that is not a uuid', { mapId: 'my-patch' }],
  ])('refuses %s', (_name, overrides) => {
    expect(notificationOf(payload(overrides))).toBeNull();
  });

  it.each([
    ['nothing', null],
    ['an empty push', ''],
    ['text that is not JSON', 'hello there'],
    ['a JSON string', '"dusk"'],
    ['a number', 42],
  ])('refuses %s', (_name, data) => {
    expect(notificationOf(data)).toBeNull();
  });

  it('refuses a body over the payload limit without parsing it', () => {
    const big = JSON.stringify(payload({ extra: 'x'.repeat(PUSH_RULES.maxPayloadBytes) }));
    expect(big.length).toBeGreaterThan(PUSH_RULES.maxPayloadBytes);
    expect(notificationOf(big)).toBeNull();
  });
});

describe('nudgeFor', () => {
  it('falls back to a friendly line so a push is never silent', () => {
    expect(nudgeFor('not json')).toBe(FALLBACK_NUDGE);
    expect(nudgeFor(null)).toBe(FALLBACK_NUDGE);
    expect(FALLBACK_NUDGE.title).toBe('Heartpatch has news 💛');
  });

  it('uses the payload when it reads', () => {
    expect(nudgeFor(JSON.stringify(payload())).tag).toBe(`dusk:${MAP_ID}`);
  });
});

describe('mapIdOf', () => {
  it('reads the patch from a clicked notification’s data', () => {
    expect(mapIdOf({ mapId: MAP_ID, kind: 'dusk' })).toBe(MAP_ID);
  });

  it.each([null, undefined, 'x', {}, { mapId: null }, { mapId: '' }, { mapId: 7 }])(
    'is null for %j',
    (data) => {
      expect(mapIdOf(data)).toBeNull();
    },
  );
});
