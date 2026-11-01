import { describe, expect, it } from 'vitest';
import { longNightShown, nudgeSwitches } from './push-settings-view.js';

describe('Settings › Nudges switches', () => {
  it('has no Long Night switch when the patch has no Long Night day', async () => {
    const shown = await longNightShown('on', () => Promise.resolve(false));
    expect(shown).toBe(false);
    expect(nudgeSwitches('on', shown)).toEqual(['dusk', 'gatherers', 'friend']);
  });

  it('adds the Long Night switch, last, when the patch has a Long Night day', async () => {
    const shown = await longNightShown('on', () => Promise.resolve(true));
    expect(nudgeSwitches('on', shown)).toEqual(['dusk', 'gatherers', 'friend', 'longNight']);
  });

  it('a failed ask is no switch', async () => {
    expect(await longNightShown('on', () => Promise.reject(new Error('offline')))).toBe(false);
  });

  it('asks nothing and shows no switches unless nudges are on', async () => {
    for (const state of ['install', 'blocked', 'off'] as const) {
      let asked = 0;
      const shown = await longNightShown(state, () => {
        asked++;
        return Promise.resolve(true);
      });
      expect(shown).toBe(false);
      expect(asked).toBe(0);
      expect(nudgeSwitches(state, true)).toEqual([]);
    }
  });
});
