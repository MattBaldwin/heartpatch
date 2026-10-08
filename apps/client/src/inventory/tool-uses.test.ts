import { describe, expect, it } from 'vitest';
import { bagItems, landedText } from './bag-view.js';
import { toolMakes, toolOf, toolStock, usesLine } from './tool-uses.js';

describe('explore tools in the bag (#199)', () => {
  it('knows which items are tools, and how many uses a new one has', () => {
    expect(toolOf('shovel')).toEqual({ tool: 'shovel', uses: 20 });
    expect(toolOf('rope')).toEqual({ tool: 'rope', uses: 10 });
    expect(toolOf('timber')).toBeNull();
  });

  it('counts tools, not uses, with a bar for the one in hand', () => {
    expect(toolStock('shovel', 20)).toEqual({ tools: 1, inHand: 20, share: 1 });
    expect(toolStock('shovel', 25)).toEqual({ tools: 2, inHand: 5, share: 0.25 });
    expect(toolStock('shovel', 0)).toBeNull();
    expect(toolStock('timber', 5)).toBeNull();
    const [shovel, timber] = bagItems({ shovel: 30, timber: 4 }).sort((a) =>
      a.id === 'shovel' ? -1 : 1,
    );
    expect(shovel).toMatchObject({ count: 30, tool: { tools: 2, share: 0.5 } });
    expect(timber?.tool).toBeNull();
  });

  it('says what a tool recipe makes, and what landed, in tools', () => {
    expect(toolMakes('shovel', 20, 'Shovel')).toBe('Makes a Shovel (20 digs)');
    expect(toolMakes('timber', 2, 'Timber')).toBeNull();
    expect(landedText([{ items: { shovel: 20 } }])).toBe('🪏 A new Shovel!');
    expect(landedText([{ items: { net: 40, timber: 2 } }])).toBe('🪵 +2 Timber, 🥅 2 new Nets!');
    expect(usesLine('lantern', 15)).toBe('15 caves left');
  });
});
