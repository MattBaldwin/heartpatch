import { findAvoidedWords } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  BUILD_TEXT,
  buildStatus,
  buildTotal,
  detailLine,
  pickCard,
  times,
  type BuildCard,
} from './build-model.js';

const card = (over: Partial<BuildCard> = {}): BuildCard => ({
  id: 'hedge',
  icon: '🌿',
  name: 'Hedge',
  effect: 'Keeps other Keepers out',
  cost: { greens: 3 },
  area: 'edges',
  blocked: null,
  craft: null,
  ...over,
});

describe('build model (#371)', () => {
  it('multiplies an edge building by the edges picked, and a spot building not at all', () => {
    expect(times({ greens: 3, timber: 1 }, 4)).toEqual({ greens: 12, timber: 4 });
    expect(buildTotal(card(), 4)).toEqual({ greens: 12 });
    expect(buildTotal(card(), 0)).toEqual({ greens: 3 });
    expect(buildTotal(card({ area: 'spot' }), 1)).toEqual({ greens: 3 });
  });

  it('says whether Build! works, and why not', () => {
    expect(buildStatus(card(), { greens: 12 }, 4).kind).toBe('ready');
    expect(buildStatus(card(), { greens: 11 }, 4).kind).toBe('short');
    expect(buildStatus(card(), { greens: 99 }, 0).kind).toBe('no-area');
    // The bag hasn't loaded: leave it to the server to say no.
    expect(buildStatus(card(), null, 2).kind).toBe('ready');
    expect(buildStatus(card({ blocked: 'No room left.' }), {}, 1)).toEqual({
      kind: 'blocked',
      note: 'No room left.',
    });
    expect(buildStatus(card({ craft: 'Carve one first!' }), {}, 1).kind).toBe('craft');
  });

  it('writes the selected card as one line', () => {
    expect(detailLine(card(), 1)).toBe('Keeps other Keepers out · 3 🌿');
    expect(detailLine(card(), 4)).toBe('Keeps other Keepers out · 12 🌿 (4 edges)');
  });

  it('keeps the asked-for card, else the first one the bag can build', () => {
    const fire = card({ id: 'fire', area: 'spot', cost: { timber: 5 } });
    const cards = [fire, card()];
    expect(pickCard(cards, 'hedge', {})?.id).toBe('hedge');
    expect(pickCard(cards, null, { greens: 9 })?.id).toBe('hedge');
    expect(pickCard(cards, null, { timber: 9 })?.id).toBe('fire');
    expect(pickCard(cards, 'gone', {})?.id).toBe('fire');
    expect(pickCard([], null, {})).toBeNull();
  });

  it('stays cozy and kid-safe', () => {
    for (const line of Object.values(BUILD_TEXT)) {
      if (typeof line === 'string') expect(findAvoidedWords(line)).toEqual([]);
    }
  });
});

describe('the first card you can pay for (#371)', () => {
  it('follows the bag once it has loaded, until a card is tapped', () => {
    const fire = card({ id: 'fire', area: 'spot', cost: { timber: 5 } });
    const hedge = card();
    // The bag isn't here yet: the first unblocked card shows.
    expect(pickCard([fire, hedge], null, null)?.id).toBe('fire');
    // It loads with greens but no timber: the pick moves to what you can pay for.
    expect(pickCard([fire, hedge], null, { greens: 9 })?.id).toBe('hedge');
    // A tapped card stays picked, whatever the bag says.
    expect(pickCard([fire, hedge], 'fire', { greens: 9 })?.id).toBe('fire');
  });
});
