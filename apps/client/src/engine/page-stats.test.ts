import { describe, expect, it } from 'vitest';
import { RenderRate, type Rendered } from './page-stats.js';

const scene = (id: { n: number }): Rendered => ({ getRenderId: () => id.n });

describe('RenderRate (#501)', () => {
  it('counts renders per second across scenes, from when each is first seen', () => {
    const rate = new RenderRate();
    const a = { n: 500 };
    const b = { n: 0 };
    const sa = scene(a);
    const sb = scene(b);
    expect(rate.sample([sa], 0)).toBe(0);
    a.n += 30;
    // b is new: its renders before now don't count.
    b.n = 7;
    expect(rate.sample([sa, sb], 500)).toBe(60);
    a.n += 15;
    b.n += 15;
    expect(rate.sample([sa, sb], 1000)).toBe(60);
  });

  it('drops a scene that went away without counting it again', () => {
    const rate = new RenderRate();
    const a = { n: 0 };
    const sa = scene(a);
    rate.sample([sa], 0);
    a.n = 10;
    expect(rate.sample([], 1000)).toBe(0);
  });
});
