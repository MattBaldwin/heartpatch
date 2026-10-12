import { RARE_FIND_TIERS, type PlayerBattle, type Rarity } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { RARE_REVEAL, revealStep } from './battle-config.js';
import revealCss from './rare-reveal.css?raw';
import { revealPlan, sparkleSpots } from './rare-reveal.js';

type PlanBattle = Parameters<typeof revealPlan>[0];

/** A wild battle before its first move, the player on side `a`. */
function wildBattle(over: Partial<PlanBattle> = {}, wildSpecies = 'glimmer'): PlanBattle {
  const side = (speciesId: string) => ({ active: 0, squishies: [{ speciesId }] });
  return {
    kind: 'wild',
    status: 'active',
    mySide: 'a',
    firstMeeting: true,
    view: { log: [], sides: { a: side('mine'), b: side(wildSpecies) } },
    ...over,
  } as unknown as PlanBattle;
}

const species = new Map<string, { rarity: Rarity }>(
  (['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'secret'] as const).map((r) => [
    r,
    { rarity: r },
  ]),
);

describe('revealPlan (#391)', () => {
  it('plays for Rare and up and for secret kinds, never commons or uncommons', () => {
    const plans = [...species.keys()].map((id) => revealPlan(wildBattle({}, id), species));
    expect(plans.map((p) => p?.tier.label ?? null)).toEqual([
      null,
      null,
      'Rare',
      'Epic',
      'Legendary',
      // No Mythic row in Phase 1: at least the Legendary moment.
      'Legendary',
      'Special',
    ]);
    expect(plans.map((p) => p?.rarity ?? null).slice(2)).toEqual([
      'rare',
      'epic',
      'legendary',
      'mythic',
      'secret',
    ]);
  });

  it('plays in full only on the first meeting; a kind met before gets just the banner', () => {
    expect(revealPlan(wildBattle({}, 'epic'), species)).toEqual({
      rarity: 'epic',
      tier: RARE_FIND_TIERS.epic,
      full: true,
    });
    expect(revealPlan(wildBattle({ firstMeeting: false }, 'epic'), species)?.full).toBe(false);
    // A server from before #391 sends nothing: the short one, never a surprise pause.
    const old = wildBattle({}, 'epic') as Partial<PlayerBattle>;
    delete old.firstMeeting;
    expect(revealPlan(old as PlanBattle, species)?.full).toBe(false);
  });

  it('takes a new tier from one data row (Mythic, Phase 2)', () => {
    const mythic = { ms: 2600, scale: 4, label: 'Mythic', banner: 'Wow!', patchLine: true };
    const plan = revealPlan(wildBattle({}, 'mythic'), species, false, {
      ...RARE_FIND_TIERS,
      mythic,
    });
    expect(plan?.tier).toEqual(mythic);
  });

  it('only opens a wild battle before its first move, and never a replay', () => {
    expect(revealPlan(wildBattle({}, 'rare'), species, true)).toBeNull();
    expect(revealPlan(wildBattle({ kind: 'tile' }, 'rare'), species)).toBeNull();
    expect(revealPlan(wildBattle({ status: 'finished' }, 'rare'), species)).toBeNull();
    const moved = wildBattle({}, 'rare');
    (moved.view.log as unknown[]).push({ type: 'turn' });
    expect(revealPlan(moved, species)).toBeNull();
    // An unknown kind (no species def) plays nothing.
    expect(revealPlan(wildBattle({}, 'nobody'), species)).toBeNull();
  });

  it('looks at the other side when the player is side b', () => {
    const b = wildBattle({ mySide: 'b' }, 'common');
    const sides = b.view.sides as unknown as Record<string, { squishies: { speciesId: string }[] }>;
    sides['a']!.squishies[0]!.speciesId = 'mythic';
    expect(revealPlan(b, species)?.rarity).toBe('mythic');
  });
});

describe('the moment grows with rarity (#391)', () => {
  it('has more of everything at each size step, and keeps the last past the end', () => {
    for (const list of [
      RARE_REVEAL.sparkles,
      RARE_REVEAL.dim,
      RARE_REVEAL.banner,
      RARE_REVEAL.ring,
    ]) {
      const steps = [1, 2, 3, 4].map((scale) => revealStep(list, scale));
      expect([...steps].sort((x, y) => x - y)).toEqual(steps);
      expect(steps[0]).toBeLessThan(steps[3]!);
      expect(revealStep(list, 99)).toBe(list.at(-1));
      expect(revealStep(list, 0)).toBe(list[0]);
    }
    expect(RARE_REVEAL.briefMs).toBeLessThan(RARE_FIND_TIERS.rare!.ms);
  });

  it('keeps every sparkle off the name pills, the sheet and the screen edges', () => {
    const layout = {
      spot: { x: 300, y: 260, r: 120 },
      sheetTop: 560,
      pillsBottom: 140,
      width: 390,
      height: 844,
    };
    const spots = sparkleSpots(28, layout, 7);
    expect(spots).toHaveLength(28);
    for (const s of spots) {
      const x = layout.spot.x + s.dx;
      const y = layout.spot.y + s.dy;
      expect(x).toBeGreaterThanOrEqual(14);
      expect(x).toBeLessThanOrEqual(layout.width - 14);
      expect(y).toBeGreaterThanOrEqual(layout.pillsBottom + RARE_REVEAL.sparkleClear.pills - 1);
      expect(y).toBeLessThanOrEqual(layout.sheetTop - RARE_REVEAL.sparkleClear.sheet + 1);
    }
    // Same kind, same screen: the same burst every time.
    expect(sparkleSpots(6, layout, 7)).toEqual(sparkleSpots(6, layout, 7));
  });

  it('animates only transform and opacity (mobile budget)', () => {
    const frames = revealCss.match(/@keyframes[^{]+\{([\s\S]*?\n)\}/g) ?? [];
    expect(frames.length).toBeGreaterThan(0);
    const props = new Set(
      frames.flatMap((f) => [...f.matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1])),
    );
    expect([...props].sort()).toEqual(['opacity', 'transform']);
  });
});
