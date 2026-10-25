import { findAvoidedWords, HOME_BASE_RULES, roadCost, TRAVEL_RULES } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { roadPath } from './road-api.js';
import {
  refundText,
  roadCardLevel,
  roadCards,
  roadCommandFor,
  roadEffect,
  roadName,
  ROAD_TEXT,
  takeUpRefund,
} from './road-model.js';
import { testWildIsle, userId } from '../map/test-view.js';

const ME = userId(1);
const view = testWildIsle();
const mine = view.tiles.find((t) => t.ownerUserId === ME && t.homeSlot === null);
const theirs = view.tiles.find((t) => t.ownerUserId === userId(2));
const river = view.tiles.find((t) => t.terrain === 'river');

describe('road cards (#621 W1-6)', () => {
  it('offers a Path where there is no road, at the first level cost', () => {
    if (!mine) throw new Error('no tile');
    const [card, ...rest] = roadCards({ tile: mine, me: ME, level: null, supplied: true });
    expect(rest).toEqual([]);
    expect(card).toMatchObject({
      id: 'road-1',
      name: 'Path',
      area: 'spot',
      blocked: null,
      cost: roadCost(1, TRAVEL_RULES),
    });
  });

  it('offers the next level up on a road: Road, then Paved road, then nothing', () => {
    if (!mine) throw new Error('no tile');
    const names = [1, 2, 3].map(
      (level) => roadCards({ tile: mine, me: ME, level, supplied: true })[0]?.name ?? null,
    );
    expect(names).toEqual(['Road', 'Paved road', null]);
    expect(roadCards({ tile: mine, me: ME, level: 1, supplied: true })[0]?.cost).toEqual(
      roadCost(2, TRAVEL_RULES),
    );
  });

  it('shows a blocked Path with a kind reason when the land is cut off', () => {
    if (!mine) throw new Error('no tile');
    const [card] = roadCards({ tile: mine, me: ME, level: null, supplied: false });
    expect(card?.blocked).toBe(ROAD_TEXT.cutOff);
    // Raising a road that already stands is never blocked by supply.
    expect(roadCards({ tile: mine, me: ME, level: 1, supplied: false })[0]?.blocked).toBeNull();
    // Not known yet: the server decides.
    expect(roadCards({ tile: mine, me: ME, level: null, supplied: null })[0]?.blocked).toBeNull();
  });

  it("offers nothing on someone else's land, water, or when signed out", () => {
    if (!theirs || !river || !mine) throw new Error('no tile');
    expect(roadCards({ tile: theirs, me: ME, level: null, supplied: true })).toEqual([]);
    expect(roadCards({ tile: river, me: ME, level: null, supplied: true })).toEqual([]);
    expect(roadCards({ tile: mine, me: null, level: null, supplied: true })).toEqual([]);
  });

  it('reads a card id back to its level and the command it sends', () => {
    expect(roadCardLevel('road-2')).toBe(2);
    expect(roadCardLevel('bridge')).toBeNull();
    expect(roadCardLevel('road-x')).toBeNull();
    expect(roadCommandFor(1)).toBe('build');
    expect(roadCommandFor(2)).toBe('upgrade');
    expect(roadCommandFor(3)).toBe('upgrade');
  });

  it('names the levels and says what each does', () => {
    expect([1, 2, 3].map(roadName)).toEqual(['Path', 'Road', 'Paved road']);
    expect(roadEffect(1)).toContain('1 tile away');
    expect(roadEffect(3)).toContain('3 tiles away');
  });

  it('gives half of what was spent back, as the server does', () => {
    expect(takeUpRefund(1)).toEqual({ timber: 2 });
    expect(refundText(takeUpRefund(1))).toContain('2');
    expect(refundText({})).toBe('');
    expect(HOME_BASE_RULES.removeRefundPercent).toBe(50);
  });

  it('keeps the words kind: no avoided words in anything a player reads', () => {
    const lines = [
      ROAD_TEXT.cutOff,
      ROAD_TEXT.built(1),
      ROAD_TEXT.built(3),
      ROAD_TEXT.line(2),
      ROAD_TEXT.takeUp,
      ROAD_TEXT.takeUpAsk('2 x'),
      ROAD_TEXT.tookUp(''),
      roadEffect(1),
      roadEffect(2),
      roadEffect(3),
    ];
    for (const line of lines) expect(findAvoidedWords(line)).toEqual([]);
  });

  it('sends each command to its own route', () => {
    expect(roadPath('m1', 'build')).toBe('/maps/m1/roads');
    expect(roadPath('m1', 'upgrade')).toBe('/maps/m1/roads/upgrade');
    expect(roadPath('m1', 'remove')).toBe('/maps/m1/roads/remove');
  });
});
