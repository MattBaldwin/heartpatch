import { describe, expect, it } from 'vitest';
import { peekBeats, peekFrame } from './crooked-peekaboo.js';

describe('the peekaboo (#306 6d, owner decision 3)', () => {
  it('goes dark, blinks two eyes open, then boos with a sting and a shake that settles', () => {
    expect(peekFrame(0, false)).toMatchObject({ phase: 'dark', dark: 0, eyes: 0 });
    expect(peekFrame(240, false)).toMatchObject({ dark: 1, eyes: 0 });
    // Eyes opening, then a blink before the boo.
    expect(peekFrame(300, false).lids).toBeLessThan(1);
    expect(peekFrame(500, false)).toMatchObject({ phase: 'eyes', lids: 1, eyes: 1 });
    expect(peekFrame(570, false).lids).toBeLessThan(0.2);
    const boo = peekFrame(760, false);
    expect(boo.phase).toBe('boo');
    expect(boo.word).toBeGreaterThan(0);
    expect(boo.wordScale).toBeGreaterThan(1);
    const shakes = [730, 760, 800, 850, 900, 1000].map((ms) => peekFrame(ms, false).shake);
    expect(shakes.some((s) => Math.abs(s.x) > 4)).toBe(true);
    expect(peekFrame(1300, false).shake).toEqual({ x: 0, y: 0 });
    expect(peekFrame(1300, false).wordScale).toBe(1);
  });

  it('turns friendly: the dark lifts on the last lit room and the echo waves', () => {
    const after = peekFrame(3000, false);
    expect(after).toMatchObject({ phase: 'friendly', dark: 0, eyes: 0, word: 0, friend: 1 });
    expect(peekFrame(3000, true)).toMatchObject({ phase: 'friendly', dark: 0, friend: 1 });
  });

  it('is a gentle fade with reduced motion: no blink, no pop, no shake', () => {
    for (let ms = 0; ms <= 3000; ms += 25) {
      const f = peekFrame(ms, true);
      expect(f.shake).toEqual({ x: 0, y: 0 });
      expect(f.lids).toBe(1);
      expect(f.wordScale).toBe(1);
    }
    expect(peekFrame(300, true).dark).toBeGreaterThan(0);
    expect(peekFrame(300, true).dark).toBeLessThan(1);
  });

  it('moves me back to the light only once the dark is full, then the sting, the giggle and the card', () => {
    for (const calm of [false, true]) {
      const beats = peekBeats(calm);
      expect(beats.map((b) => b.kind)).toEqual(['swap', 'sting', 'giggle', 'card']);
      const swap = beats[0]!.at;
      expect(peekFrame(swap, calm).dark).toBe(1);
      for (let i = 1; i < beats.length; i++) expect(beats[i]!.at).toBeGreaterThan(beats[i - 1]!.at);
      // Over in under three seconds.
      expect(beats.at(-1)!.at).toBeLessThan(3000);
    }
  });
});
