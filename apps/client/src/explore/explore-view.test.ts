import {
  EXPLORE_RULES,
  findAvoidedWords,
  type ExploreTileResponse,
  type SearchSpotResponse,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { EXPLORE_VIEW } from './explore-config.js';
import {
  actionFor,
  afterSearch,
  clampToTile,
  EXPLORE_TEXT,
  findLines,
  insideTile,
  findShowsCard,
  findToast,
  foundCount,
  joystickVector,
  makeOneLine,
  missingTool,
  needsHere,
  progressLine,
  rareTitle,
  restLine,
  stepToward,
  toolChip,
  toolChipShort,
  HANDS_ICON,
  PLAY_TEXT,
  toolRecipeRows,
  usesLine,
  xpLines,
} from './explore-view.js';
import { isIconName } from '../ui/line-icons.js';

const SQRT3_2 = Math.sqrt(3) / 2;

const spot = (index: number, x: number, z: number, done = false) => ({
  index,
  kind: 'rock',
  tool: null,
  x,
  z,
  done,
});

const found = (over: Partial<SearchSpotResponse> = {}): SearchSpotResponse => ({
  spot: 2,
  found: {},
  lore: null,
  clothing: null,
  notable: null,
  xp: [],
  tool: null,
  progress: { searched: 3, total: 10 },
  explored: false,
  homestead: null,
  items: {},
  ...over,
});

describe('explore text', () => {
  it('counts what is left, then celebrates', () => {
    expect(progressLine({ searched: 7, total: 12 })).toBe('7 of 12 found 🔍');
    expect(progressLine({ searched: 12, total: 12 })).toBe('All 12 found! ✨');
  });

  it('says how many uses a tool has left, and when it needs a rest', () => {
    expect(usesLine('net', 12)).toBe('12 dives left');
    expect(usesLine('shovel', 1)).toBe('1 dig left');
    expect(usesLine('rope', 0)).toBe('Resting zZ');
    expect(needsHere('mound', 'shovel')).toBe('This mound needs a Shovel!');
    expect(needsHere('hollow-log', 'net')).toBe('This hollow log needs a Snorkel!');
    expect(restLine('shovel')).toBe('Your Shovel needs a rest! Craft a new one 🛠️');
  });

  it('gives every spot kind an action', () => {
    for (const kind of EXPLORE_RULES.spotKinds) {
      const action = actionFor({ kind: kind.id, tool: kind.tool });
      expect(action.interaction).toBe(kind.interaction);
      expect(action.label.length).toBeGreaterThan(0);
    }
    expect(actionFor({ kind: 'mound', tool: 'shovel' }).label).toBe('Dig');
    expect(actionFor({ kind: 'tree', tool: null }).label).toBe('Shake');
  });

  it('shows each spot its own icon, drawn or an emoji every iPhone has', () => {
    expect(actionFor({ kind: 'mound', tool: 'shovel' }).icon).toBe('shovel');
    expect(actionFor({ kind: 'flower-bed', tool: null }).icon).toBe('🌷');
    expect(actionFor({ kind: 'tree', tool: null }).icon).toBe('🌳');
    expect(actionFor({ kind: 'rock', tool: null }).icon).toBe('rock');
  });

  it('uses only emoji the iOS 17 floor has, or drawn icons (the explore view itself)', () => {
    // Scope: the big button, the gesture chips, the header's hands, and every
    // line in EXPLORE_TEXT. Each emoji here was checked by hand against the
    // floor (iOS 17 has up to Emoji 15.0; 🪏 is Emoji 16). A new one is added
    // here on purpose, after the same check. Item icons come from the bag's
    // own table (inventory/item-icons.ts), outside this view. The app-wide
    // check on emoji age is ui/emoji-floor.test.ts (#308).
    const known = new Set(['🌳', '🌷', '🎃', '✊', '↔', '✋', '✨', '🪱', '🏡', '💦', '🔍', '📖']);
    const icons = [
      ...EXPLORE_RULES.spotKinds.map((k) => actionFor({ kind: k.id, tool: k.tool }).icon),
      ...Object.values(PLAY_TEXT).map((p) => p.icon),
      HANDS_ICON,
    ];
    const lines = Object.values(EXPLORE_TEXT).map((t) => (typeof t === 'string' ? t : t('Meadow')));
    for (const text of [...icons.filter((i) => !isIconName(i)), ...lines]) {
      for (const ch of text.match(/\p{Extended_Pictographic}/gu) ?? []) {
        expect(known.has(ch), `${ch} in “${text}”`).toBe(true);
      }
    }
  });

  it('lists a tool recipe against the bag', () => {
    const rows = toolRecipeRows('rope', { greens: 1 });
    expect(rows).toEqual([
      { id: 'timber', text: '🪵 Timber 0/2', enough: false },
      { id: 'greens', text: '🌿 Greens 1/1', enough: true },
    ]);
    expect(toolRecipeRows('shovel', { timber: 9, stone: 9 }).every((r) => r.enough)).toBe(true);
  });

  it('names the tool in hand on the header chip', () => {
    expect(toolChip('shovel', 18)).toBe('Shovel · 18 digs');
    expect(toolChip('lantern', 1)).toBe('Lantern · 1 cave');
    expect(toolChip('net', 0)).toBe('Snorkel · Resting zZ');
    expect(toolChip('rope', 10)).toBe('Walking Stick · 10 hikes');
    expect(toolChip(null, 0)).toBe('Hands');
    expect(toolChipShort('lantern', 20)).toBe('20');
    expect(toolChipShort('net', 0)).toBe('zZ');
    expect(toolChipShort(null, 0)).toBe('');
  });

  it('says what makes a missing tool, counted once the bag is read', () => {
    const rows = toolRecipeRows('rope', { greens: 1 });
    expect(makeOneLine(rows, true)).toBe('Make one: 🪵 Timber 0/2 · 🌿 Greens 1/1');
    expect(makeOneLine(rows, false)).toBe('Make one: 🪵 Timber ×2 · 🌿 Greens ×1');
    expect(makeOneLine([], true)).toBe('');
  });

  it('toasts a common find and keeps the card for rare ones', () => {
    const common = found({ found: { timber: 2 }, xp: [{ squishyId: 'a', xp: 6 }] });
    expect(findShowsCard(common)).toBe(false);
    expect(findToast(common, { a: 'Puddlepuff' })).toEqual({
      main: '+2 Timber',
      extra: 'Puddlepuff +6 XP',
    });
    expect(foundCount(common)).toBe(2);
    expect(findToast(found(), {}).main).toBe(EXPLORE_TEXT.worm);
    expect(findToast(common, {}, true).main).toBe('Big splash! 💦 +2 Timber');
    expect(findToast(found({ tool: { id: 'shovel', usesLeft: 0 } }), {}).extra).toBe(
      restLine('shovel'),
    );
    const lore = found({ lore: { id: 'under-a-mossy-rock', title: 'Under a Mossy Rock' } });
    expect(findShowsCard(lore)).toBe(true);
    expect(rareTitle(lore, 'meadow')).toBe(EXPLORE_TEXT.lorePage);
    expect(findShowsCard(found({ clothing: 'pumpkin-hood' }))).toBe(true);
    expect(findShowsCard(found({ notable: 'heartdust' }))).toBe(true);
    const done = found({ explored: true, homestead: 'joined' });
    expect(findShowsCard(done)).toBe(true);
    expect(rareTitle(done, 'meadow')).toBe('Meadow joined your home!');
    expect(rareTitle(found({ explored: true }), 'meadow')).toContain('every spot');
  });

  it('turns a find into card lines, or a wiggly worm', () => {
    expect(findLines(found())).toEqual([{ kind: 'none', text: EXPLORE_TEXT.worm }]);
    const lines = findLines(
      found({
        found: { timber: 2 },
        lore: { id: 'under-a-mossy-rock', title: 'Under a Mossy Rock' },
      }),
    );
    expect(lines.map((l) => l.kind)).toEqual(['item', 'lore']);
    expect(lines[0]?.text).toContain('Timber ×2');
    // A page says where it went (#307); other lines have no note.
    expect(lines[1]?.note).toBe('Added to your Lorebook 📖');
    expect(lines[0]?.note).toBeUndefined();
    expect(xpLines([{ squishyId: 'a', xp: 6 }], { a: 'Puddlepuff' })).toEqual(['Puddlepuff +6 XP']);
  });

  it('keeps the words kind (style guide §8, §9)', () => {
    for (const line of Object.values(EXPLORE_TEXT)) {
      if (typeof line === 'string') expect(findAvoidedWords(line)).toEqual([]);
    }
  });
});

describe('a search changes the tile on screen', () => {
  it('marks the spot done and keeps the tool count', () => {
    const tile: ExploreTileResponse = {
      q: 1,
      r: 2,
      terrain: 'meadow',
      spots: [spot(1, 0, 0), spot(2, 0.3, 0)],
      needs: ['shovel'],
      progress: { searched: 2, total: 10 },
      homestead: null,
      tools: { shovel: 20, net: 0, rope: 0, lantern: 0 },
    };
    const next = afterSearch(
      tile,
      found({ tool: { id: 'shovel', usesLeft: 19 }, homestead: 'joined' }),
    );
    expect(next.spots.map((s) => s.done)).toEqual([false, true]);
    expect(next.tools.shovel).toBe(19);
    expect(next.homestead).toBe('joined');
    expect(next.progress).toEqual({ searched: 3, total: 10 });
  });

  it('knows which tool a spot is missing', () => {
    expect(missingTool({ tool: null }, {})).toBeNull();
    expect(missingTool({ tool: 'net' }, { net: 0 })).toBe('net');
    expect(missingTool({ tool: 'net' }, { net: 3 })).toBeNull();
  });
});

describe('walking on the tile', () => {
  it('keeps the Keeper inside the tile', () => {
    const margin = EXPLORE_VIEW.edgeMargin;
    expect(clampToTile({ x: 0, z: 0 })).toEqual({ x: 0, z: 0 });
    const side = clampToTile({ x: 5, z: 0 });
    expect(side.x).toBeCloseTo(SQRT3_2 - margin);
    expect(side.z).toBeCloseTo(0);
    for (const angle of [0, 0.5, 1, 1.6, 2.4, 3, 4, 5.2]) {
      const p = clampToTile({ x: Math.cos(angle) * 4, z: Math.sin(angle) * 4 });
      expect(insideTile(p), `angle ${String(angle)}`).toBe(true);
    }
    // The top corner is further out than the sides (pointy-topped tiles).
    expect(insideTile({ x: 0, z: 0.85 })).toBe(true);
    expect(insideTile({ x: 0.85, z: 0 })).toBe(false);
  });

  it('walks towards a point and stops on it', () => {
    expect(stepToward({ x: 0, z: 0 }, { x: 0.5, z: 0 }, 0.1)).toEqual({ x: 0.1, z: 0 });
    expect(stepToward({ x: 0.45, z: 0 }, { x: 0.5, z: 0 }, 0.1)).toEqual({ x: 0.5, z: 0 });
  });

  it('reads the joystick as a direction on the ground', () => {
    expect(joystickVector(2, 2)).toEqual({ x: 0, z: 0 });
    const up = joystickVector(0, -200);
    expect(up.x).toBeCloseTo(0);
    expect(up.z).toBeCloseTo(1);
    const right = joystickVector(EXPLORE_VIEW.joystick.radius / 2, 0);
    expect(right.x).toBeGreaterThan(0);
    expect(right.x).toBeLessThan(1);
  });
});
