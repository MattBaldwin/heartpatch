import { describe, expect, it } from 'vitest';
import {
  findAvoidedWords,
  type FactoryBatch,
  type FactoryView,
  type Landed,
} from '@heartpatch/shared';
import {
  batchPlanLine,
  batchRows,
  batchTimeLine,
  FACTORY_TEXT,
  goingCount,
  hasRoom,
  lengthText,
  manyOf,
  nextLevelRoom,
  pickRows,
  showsWelcomeBack,
  soonestFreeMs,
  stopPreview,
  welcomeChips,
} from './factory-view.js';
import { GAME_DATA } from '@heartpatch/shared';

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

function batch(over: Partial<FactoryBatch> = {}): FactoryBatch {
  const total = over.total ?? 10;
  const itemSeconds = over.itemSeconds ?? 60;
  return {
    id: '00000000-0000-4000-8000-000000000001',
    recipeId: 'heart-charm',
    total,
    done: 0,
    itemSeconds,
    startedAt: iso(T0),
    nextAt: iso(T0 + itemSeconds * 1000),
    doneAt: iso(T0 + total * itemSeconds * 1000),
    ...over,
  };
}

const view = (batches: FactoryBatch[], level = 1, slots = 2): FactoryView => ({
  buildingId: '00000000-0000-4000-8000-0000000000aa',
  level,
  slots,
  batches,
});

describe('the Factory panel words (#294)', () => {
  it('counts a batch up on the game clock, with a bar and a countdown', () => {
    const [row] = batchRows(view([batch()]), T0 + 4.5 * 60_000);
    expect(row).toMatchObject({ name: 'Heart Charm', icon: '💗', done: 4, total: 10, percent: 40 });
    expect(batchTimeLine(row!, T0 + 4.5 * 60_000)).toBe('Next one in 30s · all done in 6m');
    const [done] = batchRows(view([batch()]), T0 + 11 * 60_000);
    expect(done?.finished).toBe(true);
    expect(batchTimeLine(done!, T0 + 11 * 60_000)).toBe(FACTORY_TEXT.allDone);
  });

  it('says "+3 🍪 each" for a recipe that makes more than one', () => {
    const [row] = batchRows(view([batch({ recipeId: 'cook-treats', total: 5 })]), T0);
    expect(row?.each).toBe('+3 🍪 each');
    expect(batchRows(view([batch()]), T0)[0]?.each).toBe('');
  });

  it('knows when there is a free spot, and when one frees up', () => {
    const two = view([batch(), batch({ id: '00000000-0000-4000-8000-000000000002', total: 2 })]);
    expect(goingCount(two, T0)).toBe(2);
    expect(hasRoom(two, T0)).toBe(false);
    expect(soonestFreeMs(two, T0)).toBe(2 * 60_000);
    // The short batch is all made: its spot is free (the next settle ends it).
    expect(hasRoom(two, T0 + 3 * 60_000)).toBe(true);
  });

  it('says what the next level adds, and nothing at the top', () => {
    expect(nextLevelRoom(view([], 1))).toEqual({ level: 2, slots: 3 });
    expect(nextLevelRoom(view([], 2, 3))).toEqual({ level: 3, slots: 4 });
    expect(nextLevelRoom(view([], 3, 4))).toBeNull();
  });

  it('lists only open recipe pages, and says why one cannot be picked', () => {
    const open = new Set(['recipe:heart-charm', 'recipe:cook-treats', 'recipe:leafy-heart-charms']);
    const rows = pickRows({ timber: 28, treats: 12 }, ['halloween'], (k) => open.has(k));
    expect(rows.map((r) => r.recipe.id)).toEqual([
      'heart-charm',
      'cook-treats',
      'leafy-heart-charms',
    ]);
    expect(rows[0]).toMatchObject({ canMake: 12, note: null, line: '2 🪵 · 1 🍪 · 1 min each' });
    expect(rows[1]?.note).toMatch(/You need 2 more Greens first!/);
    expect(rows[1]?.line).toBe('2 🌿 → 3 🍪 · 1 min each');
    expect(rows[2]?.note).toBe('Only around Thanksgiving.');
  });

  it('says what a batch uses and how long it takes', () => {
    const charm = GAME_DATA.recipes.find((r) => r.id === 'heart-charm')!;
    expect(batchPlanLine(charm, 10)).toBe('Uses 20 🪵 · 10 🍪 now · all done in 10 min');
    expect(lengthText(30)).toBe('30 s');
    expect(lengthText(90 * 60)).toBe('1h 30m');
  });

  it('says lots of a thing the way a kid would', () => {
    expect(manyOf('Shovel', 3)).toBe('Shovels');
    expect(manyOf('Shovel', 1)).toBe('Shovel');
    expect(manyOf('Cooked Treats', 3)).toBe('Cooked Treats');
    expect(manyOf('Frozen Water', 3)).toBe('Frozen Water');
    expect(FACTORY_TEXT.stopKeep(3, 'Shovel')).toBe('You keep the 3 Shovels already made.');
  });

  it('previews a stop: what is kept and everything else back, the one in progress too', () => {
    const preview = stopPreview(batch(), T0 + 4.5 * 60_000);
    expect(preview.kept).toBe(4);
    expect(preview.refund).toEqual({ timber: 12, treats: 6 });
    expect(preview.lines).toEqual([
      '💗 You keep the 4 Heart Charms already made.',
      "↩️ 6 aren't finished yet (the one being made too). You get back 12 🪵 Timber, 6 🍪 Treats.",
    ]);
  });

  it('shows the welcome-back card only after a while away, with what the Factory made', () => {
    const landed: Landed[] = [
      { kind: 'factory' as const, items: { 'heart-charm': 10 }, recipeId: 'heart-charm' },
      { kind: 'factory' as const, items: { treats: 15 }, recipeId: 'cook-treats' },
      { kind: 'gather' as const, items: { timber: 5 } },
    ];
    expect(showsWelcomeBack(landed, 31 * 60_000)).toBe(true);
    expect(showsWelcomeBack(landed, 5 * 60_000)).toBe(false);
    expect(showsWelcomeBack([landed[2]!], 99 * 60_000)).toBe(false);
    expect(welcomeChips(landed)).toEqual(['💗 +10 Heart Charm', '🍪 +15 Treats']);
  });

  it('talks about explore tools as tools, never as their uses (#199)', () => {
    const shovel = GAME_DATA.recipes.find((r) => r.output.resource === 'shovel');
    expect(shovel).toBeDefined();
    const uses = shovel!.output.quantity;
    expect(
      welcomeChips([{ kind: 'factory', items: { shovel: 2 * uses }, recipeId: shovel!.id }]),
    ).toEqual(['🪏 2 new Shovels']);
    const [row] = batchRows(view([batch({ recipeId: shovel!.id, total: 5 })]), T0);
    expect(row?.each).toBe(`+🪏 (${String(uses)} digs) each`);
    const pick = pickRows({ timber: 99, stone: 99 }, [], () => true).find(
      (r) => r.recipe.id === shovel!.id,
    );
    expect(pick?.line).toContain(`→ 🪏 (${String(uses)} digs)`);
    expect(pick?.line).not.toContain(`${String(uses)} 🪏`);
  });

  it('uses only kid-friendly words', () => {
    const words = Object.values(FACTORY_TEXT)
      .map((t) => (typeof t === 'function' ? (t as (...a: unknown[]) => string)(2, 'x', 3) : t))
      .join(' ');
    expect(findAvoidedWords(words)).toEqual([]);
  });
});
