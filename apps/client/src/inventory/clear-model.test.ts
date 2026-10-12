import {
  CLEARING_RULES,
  findAvoidedWords,
  type Clearing,
  type Gather,
  type PublicTile,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { userId } from '../map/test-view.js';
import {
  CLEAR_CARD_ID,
  CLEAR_TEXT,
  clearCards,
  clearedNote,
  clearOffer,
  clearsFirst,
  toolName,
} from './clear-model.js';

const me = userId(1);
const NOW = Date.parse('2026-10-12T12:00:00Z');
const LATER = '2026-10-12T12:01:00Z';
const EARLIER = '2026-10-12T11:59:00Z';
const uses = CLEARING_RULES.tools.find((t) => t.id === 'axe')!.uses;

const tile = (extra: Partial<PublicTile> = {}): PublicTile => ({
  q: 2,
  r: 0,
  terrain: 'forest',
  ownerUserId: me,
  nodeResource: null,
  homeSlot: null,
  homestead: 'joined',
  gathering: null,
  cooldownUntil: null,
  defenders: 0,
  guardianHint: null,
  buildings: [],
  ...extra,
});

const bag = (items: Record<string, number> = { axe: uses }) => ({ items, gathers: [] });
const gatherAt = (q: number, readyAt: string) => ({ q, r: 0, readyAt }) as Gather;
const clearAt = (q: number, readyAt: string): Clearing => ({
  id: userId(7),
  q,
  r: 0,
  tool: 'axe',
  drop: {},
  startedAt: '2026-10-12T11:58:00Z',
  readyAt,
});

describe('clearOffer (#242)', () => {
  it("offers to clear an empty homestead of mine with the land's tool, and what it drops", () => {
    expect(clearOffer(tile(), me, bag(), NOW)).toEqual({
      tool: 'axe',
      drop: { timber: expect.any(Number) as number },
      blocked: null,
      needTool: false,
    });
    expect(clearOffer(tile({ terrain: 'meadow' }), me, bag(), NOW)).toMatchObject({
      tool: 'spade',
      drop: { greens: 4 },
    });
    // A spot drops one gather of itself.
    expect(
      clearOffer(tile({ terrain: 'hills', nodeResource: 'stone' }), me, bag(), NOW),
    ).toMatchObject({ tool: 'spade', drop: { stone: expect.any(Number) as number } });
  });

  it('asks for the tool first when the bag has none', () => {
    expect(clearOffer(tile(), me, bag({}), NOW)).toMatchObject({ needTool: true, blocked: null });
  });

  it("isn't offered off a joined homestead of mine, on cleared or unclearable land, or with something on it", () => {
    const off = (extra: Partial<PublicTile>) => clearOffer(tile(extra), me, bag(), NOW);
    expect(clearOffer(tile(), null, bag(), NOW)).toBeNull();
    expect(off({ ownerUserId: userId(2) })).toBeNull();
    expect(off({ homeSlot: 3 })).toBeNull();
    expect(off({ homestead: null })).toBeNull();
    expect(off({ homestead: 'paused' })).toBeNull();
    expect(off({ terrain: 'clearing' })).toBeNull();
    expect(off({ terrain: 'old-forest' })).toBeNull();
    expect(off({ terrain: 'lake' })).toBeNull();
    expect(
      off({
        buildings: [
          {
            id: userId(9),
            buildingId: 'hearthfire',
            kind: 'hearthfire',
            level: 1,
            spot: 0,
            lit: true,
            safeRadius: 1,
          },
        ],
      }),
    ).toBeNull();
    expect(off({ clearing: { readyAt: LATER } })).toBeNull();
    // My own clear here, before the map hears of it.
    expect(clearOffer(tile(), me, { ...bag(), clears: [clearAt(2, LATER)] }, NOW)).toBeNull();
  });

  it('says why it waits: a gather, a squishy, or another clear going', () => {
    const waits = (state: Parameters<typeof clearOffer>[2], extra: Partial<PublicTile> = {}) =>
      clearOffer(tile(extra), me, state, NOW)?.blocked;
    expect(waits({ ...bag(), gathers: [gatherAt(2, LATER)] })).toBe(CLEAR_TEXT.gathering);
    expect(waits(bag(), { workers: 1 })).toBe(CLEAR_TEXT.squishyBusy);
    expect(waits(bag(), { defenders: 2 })).toBe(CLEAR_TEXT.squishyBusy);
    expect(waits({ ...bag(), clears: [clearAt(5, LATER)] })).toBe(CLEAR_TEXT.already);
  });

  it("doesn't wait on a gather or clear that's finished: the server banks it first", () => {
    const done = { ...bag(), gathers: [gatherAt(2, EARLIER)], clears: [clearAt(5, EARLIER)] };
    expect(clearOffer(tile(), me, done, NOW)?.blocked).toBeNull();
  });
});

describe('clearCards (#242)', () => {
  const ids = (cards: readonly { id: string }[]) => cards.map((c) => c.id);

  it("is Clear land with its drawn tool and one use, and nothing on land that can't be cleared", () => {
    const [card] = clearCards(tile(), me, bag(), NOW);
    expect(card).toMatchObject({
      id: CLEAR_CARD_ID,
      icon: 'axe',
      name: CLEAR_TEXT.name,
      cost: { axe: 1 },
      area: 'spot',
      blocked: null,
      craft: null,
    });
    expect(clearCards(tile({ terrain: 'meadow' }), me, bag(), NOW)[0]?.icon).toBe('spade');
    expect(clearCards(tile({ terrain: 'lake' }), me, bag(), NOW)).toEqual([]);
    expect(clearCards(tile(), me, bag({}), NOW)[0]?.craft).toBe(
      'Make an Axe in your recipe book first!',
    );
  });

  it('shows the buildings a spot makes room for, waiting, after Clear land', () => {
    const cards = clearCards(tile({ nodeResource: 'timber' }), me, bag(), NOW);
    expect(ids(cards)).toEqual([CLEAR_CARD_ID, 'hearthfire', 'training-grounds']);
    expect(cards.slice(1).map((c) => c.blocked)).toEqual([
      CLEAR_TEXT.firstLine,
      CLEAR_TEXT.firstLine,
    ]);
    // Land with no spot is built on as it is.
    expect(ids(clearCards(tile(), me, bag(), NOW))).toEqual([CLEAR_CARD_ID]);
  });

  it("shows only Clear land and why it waits while it can't start (review, 3b-1)", () => {
    const spot = tile({ nodeResource: 'timber' });
    const cards = clearCards(spot, me, { ...bag(), gathers: [gatherAt(2, LATER)] }, NOW);
    expect(cards).toEqual([expect.objectContaining({ blocked: CLEAR_TEXT.gathering })]);
    expect(ids(clearCards({ ...spot, workers: 1 }, me, bag(), NOW))).toEqual([CLEAR_CARD_ID]);
  });
});

describe('clearsFirst (#242)', () => {
  it('holds a building back on a clearable homestead spot only', () => {
    expect(clearsFirst(tile({ nodeResource: 'timber' }))).toBe(true);
    expect(clearsFirst(tile())).toBe(false);
    expect(clearsFirst(tile({ nodeResource: 'timber', homestead: null }))).toBe(false);
    expect(clearsFirst(tile({ nodeResource: 'timber', homeSlot: 1 }))).toBe(false);
    expect(clearsFirst(tile({ nodeResource: 'stone', terrain: 'old-forest' }))).toBe(false);
  });
});

describe('clear words', () => {
  const done = { q: 1, r: 0, items: { greens: 4 }, landCleared: true };

  it('says the land is cleared before its drop, unless someone else took it meanwhile', () => {
    expect(clearedNote([done])).toBe(CLEAR_TEXT.cleared);
    expect(clearedNote([{ ...done, landCleared: false }])).toBe('');
    expect(clearedNote([])).toBe('');
  });

  it('names the tool with the right article, and keeps every line kid-friendly', () => {
    expect(CLEAR_TEXT.needTool(toolName('axe'))).toBe('Make an Axe in your recipe book first!');
    expect(CLEAR_TEXT.needTool(toolName('spade'))).toBe('Make a Spade in your recipe book first!');
    const lines = Object.values(CLEAR_TEXT).map((t) => (typeof t === 'string' ? t : t('x')));
    expect(lines.flatMap((l) => findAvoidedWords(l))).toEqual([]);
  });
});
