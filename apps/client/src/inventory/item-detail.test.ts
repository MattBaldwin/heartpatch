import { findAvoidedWords, GAME_DATA } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { itemDetail } from './item-detail.js';

describe('the Bag item card (#241)', () => {
  it('says what a made thing is for, with chips from its data', () => {
    const soup = itemDetail('hearty-soup', 2);
    expect(soup.have).toBe('You have 2');
    // A tool is counted in uses (#199).
    expect(itemDetail('net', 12).have).toBe('12 dives left');
    expect(soup.purpose).toBe(GAME_DATA.resources.find((r) => r.id === 'hearty-soup')?.description);
    expect(soup.chips).toEqual([
      { text: '💚 Heals 40% energy', battle: true },
      { text: '🫧 Next bump 75% softer', battle: true },
      { text: '🎒 Use it in a battle', battle: false },
    ]);
    expect(soup.where).toBeNull();
    expect(itemDetail('heart-charm', 3).chips.map((c) => c.text)).toEqual([
      '💗 Helps befriend a wild squishy',
    ]);
  });

  it("answers what's Glimmer for, and where it turns up", () => {
    const glimmer = itemDetail('glimmer', 2);
    expect(glimmer.purpose).not.toBe('');
    expect(glimmer.chips.map((c) => c.text)).toEqual([
      '🔨 For building Glimmer Rail and Lantern Fence',
      '⬆️ Upgrades Hearthfire, Crafting Factory and more',
      '🍳 Goes into Lantern',
    ]);
    expect(glimmer.where).toMatch(/Mountain/);
  });

  it('names a few things and then says "and more"', () => {
    const treats = itemDetail('treats', 1).chips.map((c) => c.text);
    expect(treats).toContain('🤗 Care: Feed');
    expect(treats).toContain('🥣 Made from Greens and Pumpkins');
    expect(treats.find((t) => t.startsWith('🍳'))).toMatch(/and more$/);
    expect(itemDetail('fireworks', 1).chips.map((c) => c.text)).toEqual(['🎀 A New Year keepsake']);
  });

  it('gives every item a line and chips in kind words', () => {
    for (const r of GAME_DATA.resources) {
      const d = itemDetail(r.id, 1);
      expect(d.purpose, r.id).not.toBe('');
      expect(d.chips.length, r.id).toBeGreaterThan(0);
      const words = [d.purpose, d.where ?? '', ...d.chips.map((c) => c.text)].join(' ');
      expect(findAvoidedWords(words), r.id).toEqual([]);
    }
  });
});
