import { CLEARING_RULES, findAvoidedWords, type Gather, type PublicTile } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { userId } from '../map/test-view.js';
import { CLEAR_TEXT, clearedText, clearOffer, clearsFirst, toolName } from './clear-model.js';

const me = userId(1);
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

describe('clearOffer (#242)', () => {
  it("offers to clear an empty homestead of mine with the land's tool, and what it drops", () => {
    expect(clearOffer(tile(), me, bag())).toEqual({
      tool: 'axe',
      drop: { timber: expect.any(Number) as number },
      blocked: null,
      needTool: false,
    });
    expect(clearOffer(tile({ terrain: 'meadow' }), me, bag())).toMatchObject({
      tool: 'spade',
      drop: { greens: 4 },
    });
    // A spot drops one gather of itself.
    expect(clearOffer(tile({ terrain: 'hills', nodeResource: 'stone' }), me, bag())).toMatchObject({
      tool: 'spade',
      drop: { stone: expect.any(Number) as number },
    });
  });

  it('asks for the tool first when the bag has none', () => {
    expect(clearOffer(tile(), me, bag({}))).toMatchObject({ needTool: true, blocked: null });
  });

  it("isn't offered off a joined homestead of mine, on cleared or unclearable land, or with something on it", () => {
    const off = (extra: Partial<PublicTile>) => clearOffer(tile(extra), me, bag());
    expect(clearOffer(tile(), null, bag())).toBeNull();
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
    expect(off({ clearing: { readyAt: '2026-10-12T12:00:00Z' } })).toBeNull();
  });

  it('says why it waits: a gather, a squishy, or another clear going', () => {
    const gather = { q: 2, r: 0 } as Gather;
    expect(clearOffer(tile(), me, { ...bag(), gathers: [gather] })?.blocked).toBe(
      CLEAR_TEXT.gathering,
    );
    expect(clearOffer(tile({ workers: 1 }), me, bag())?.blocked).toBe(CLEAR_TEXT.squishyBusy);
    expect(clearOffer(tile({ defenders: 2 }), me, bag())?.blocked).toBe(CLEAR_TEXT.squishyBusy);
    const clears = [
      {
        id: userId(7),
        q: 5,
        r: 5,
        tool: 'axe',
        drop: {},
        startedAt: '2026-10-12T11:58:00Z',
        readyAt: '2026-10-12T12:00:00Z',
      },
    ];
    expect(clearOffer(tile(), me, { ...bag(), clears })?.blocked).toBe(CLEAR_TEXT.already);
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
  it('pops up cleared land with its drop, or only the drop when the land went to someone else', () => {
    const done = { q: 1, r: 0, items: { greens: 4 }, landCleared: true };
    expect(clearedText([done])).toBe(`${CLEAR_TEXT.cleared} 🌿 +4 Greens!`);
    expect(clearedText([{ ...done, landCleared: false }])).toBe('🌿 +4 Greens!');
    expect(clearedText([{ ...done, items: {} }])).toBe(CLEAR_TEXT.cleared);
  });

  it('names the tool with the right article, and keeps every line kid-friendly', () => {
    expect(CLEAR_TEXT.needTool(toolName('axe'))).toBe('Make an Axe in your recipe book first!');
    expect(CLEAR_TEXT.needTool(toolName('spade'))).toBe('Make a Spade in your recipe book first!');
    const lines = Object.values(CLEAR_TEXT).map((t) => (typeof t === 'string' ? t : t('x')));
    expect(lines.flatMap((l) => findAvoidedWords(l))).toEqual([]);
  });
});
