import { describe, expect, it } from 'vitest';
import { scrollToShow } from './knocked-view.js';

describe('scrollToShow', () => {
  it("doesn't scroll when the card already shows whole", () => {
    expect(scrollToShow(120, 300, 400)).toBe(0);
  });

  it('scrolls just far enough for the bottom of the card (Fix it) to show, keeping the top in sight', () => {
    // Card 120 to 420 in a 400-tall panel: 28 brings its bottom 8 above the edge.
    expect(scrollToShow(120, 420, 400)).toBe(28);
  });

  it('never scrolls the top of a tall card out of sight', () => {
    expect(scrollToShow(120, 900, 400)).toBe(112);
  });
});
