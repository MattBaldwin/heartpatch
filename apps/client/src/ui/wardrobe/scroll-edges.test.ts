import { describe, expect, it } from 'vitest';
import { scrollEdges, scrollMore } from './scroll-edges.js';

describe('scrollEdges (#152)', () => {
  it('says nothing when the row fits', () => {
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toEqual({
      left: false,
      right: false,
    });
    // A fraction of a pixel over is still "fits".
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 300.6, clientWidth: 300 }).right).toBe(false);
  });

  it('fades the edge with more chips behind it, and only that edge', () => {
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 900, clientWidth: 390 })).toEqual({
      left: false,
      right: true,
    });
    expect(scrollEdges({ scrollLeft: 200, scrollWidth: 900, clientWidth: 390 })).toEqual({
      left: true,
      right: true,
    });
    expect(scrollEdges({ scrollLeft: 510, scrollWidth: 900, clientWidth: 390 })).toEqual({
      left: true,
      right: false,
    });
    // Scrolled to within a pixel of the end counts as the end.
    expect(scrollEdges({ scrollLeft: 509.4, scrollWidth: 900, clientWidth: 390 }).right).toBe(
      false,
    );
  });

  it('spells the sides for the stylesheet', () => {
    expect(scrollMore({ left: false, right: false })).toBeNull();
    expect(scrollMore({ left: false, right: true })).toBe('right');
    expect(scrollMore({ left: true, right: true })).toBe('left right');
  });
});
