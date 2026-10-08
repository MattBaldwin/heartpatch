import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../data/index.js';
import { itemEffects } from './item-effects.js';

const resource = (id: string) => {
  const r = GAME_DATA.resources.find((x) => x.id === id);
  if (!r) throw new Error(`no resource ${id}`);
  return r;
};

describe('itemEffects (#241)', () => {
  it('reads a potion from its battle effect', () => {
    const brew = resource('brave-brew').battleEffect;
    expect(itemEffects('brave-brew')).toEqual([
      { kind: 'boost', stat: 'attack', percent: brew?.attackPercent },
      { kind: 'shield', percent: brew?.shieldPercent },
      { kind: 'battle' },
    ]);
    const cocoa = resource('cozy-cocoa').battleEffect;
    expect(itemEffects('cozy-cocoa')).toEqual([
      { kind: 'boost', stat: 'defense', percent: cocoa?.defensePercent },
      { kind: 'shield', percent: cocoa?.shieldPercent },
      { kind: 'battle' },
    ]);
    const soup = resource('hearty-soup').battleEffect;
    expect(itemEffects('hearty-soup')).toEqual([
      { kind: 'heal', percent: soup?.healPercent },
      { kind: 'shield', percent: soup?.shieldPercent },
      { kind: 'battle' },
    ]);
  });

  it('says a Heart Charm helps befriend a wild squishy', () => {
    expect(itemEffects('heart-charm')).toEqual([{ kind: 'befriend' }]);
  });

  it("says the Jack-o'-Lantern builds a fire on your land, and what that fire does", () => {
    const fire = GAME_DATA.buildings.find((b) => b.id === 'jack-o-lantern-hearthfire');
    expect(fire?.kind).toBe('hearthfire');
    if (fire?.kind !== 'hearthfire') return;
    expect(itemEffects('jack-o-lantern-hearthfire')).toEqual([
      { kind: 'builds', building: fire.id, placement: 'land' },
      { kind: 'building', effect: { kind: 'safe', radius: fire.levels[0]?.safeRadius } },
      { kind: 'building', effect: { kind: 'fuel', perNight: fire.fuelPerNight } },
    ]);
  });

  it('lists what a gathered thing goes into', () => {
    // Glimmer builds two fences and takes the others (and the fire) to their top level (#203).
    expect(itemEffects('glimmer')).toEqual([
      { kind: 'build-with', buildings: ['glimmer-rail', 'lantern-fence'] },
      {
        kind: 'upgrades',
        buildings: ['hearthfire', 'hedge', 'moat', 'stone-wall', 'emberwood-palisade', 'ice-wall'],
      },
    ]);
    const ember = itemEffects('emberwood');
    expect(ember).toContainEqual({
      kind: 'fuel',
      buildings: ['hearthfire', 'jack-o-lantern-hearthfire'],
    });
    expect(ember).toContainEqual(expect.objectContaining({ kind: 'recipes' }));
    expect(itemEffects('heartdust')).toEqual([{ kind: 'care', actions: ['heart-snack'] }]);
    expect(itemEffects('treats')).toContainEqual({ kind: 'care', actions: ['feed'] });
    // Something a recipe also makes says so, from the recipe data.
    const makers = GAME_DATA.recipes.filter((r) => r.output.resource === 'treats').map((r) => r.id);
    expect(makers.length).toBeGreaterThan(0);
    expect(itemEffects('treats')).toContainEqual({ kind: 'made-from', recipes: makers });
    expect(itemEffects('heart-charm')).not.toContainEqual(
      expect.objectContaining({ kind: 'made-from' }),
    );
    const timber = itemEffects('timber').find((e) => e.kind === 'build-with');
    expect(timber?.kind === 'build-with' && timber.buildings).toContain('hearthfire');
  });

  it('calls a seasonal thing with no use yet a keepsake', () => {
    expect(itemEffects('fireworks')).toEqual([{ kind: 'keepsake', season: 'new-year' }]);
  });

  it('knows nothing about an unknown id', () => {
    expect(itemEffects('nope')).toEqual([]);
  });

  it('gives every crafted thing a purpose line and at least one chip', () => {
    const crafted = GAME_DATA.resources.filter((r) => r.kind === 'crafted');
    expect(crafted.length).toBeGreaterThan(0);
    for (const r of crafted) {
      expect(r.description.trim(), r.id).not.toBe('');
      expect(itemEffects(r.id).length, r.id).toBeGreaterThan(0);
    }
  });

  it('gives every bag item at least one chip', () => {
    for (const r of GAME_DATA.resources) expect(itemEffects(r.id).length, r.id).toBeGreaterThan(0);
  });

  it('works out effects from the data it is given', () => {
    const level = (cost: Record<string, number>) => ({ cost, capacity: 2, xpPerHour: 1 });
    const grounds = GAME_DATA.buildings.find((b) => b.kind === 'training-grounds');
    if (grounds?.kind !== 'training-grounds') throw new Error('no training grounds');
    const data = {
      resources: [
        { id: 'goo', name: 'Goo', description: 'Gooey.', kind: 'gathered' as const },
        { id: 'blob', name: 'Blob', description: 'A blob.', kind: 'crafted' as const },
      ],
      recipes: [
        {
          id: 'blobbing',
          name: 'Blobbing',
          description: 'Blob it.',
          inputs: { goo: 2 },
          output: { resource: 'blob', quantity: 1 },
          craftSeconds: 1,
        },
      ],
      buildings: [
        { ...grounds, id: 'gym', levels: [level({ blob: 1, goo: 1 }), level({ goo: 5 })] },
      ],
      careActions: [],
    };
    expect(itemEffects('goo', data)).toEqual([
      { kind: 'build-with', buildings: ['gym'] },
      { kind: 'recipes', recipes: ['blobbing'] },
    ]);
    // One material among several: it helps build, it doesn't "build" it.
    expect(itemEffects('blob', data)).toEqual([{ kind: 'build-with', buildings: ['gym'] }]);
    expect(
      itemEffects('goo', { ...data, resources: data.resources, recipes: [], buildings: [] }),
    ).toEqual([]);
  });
});
