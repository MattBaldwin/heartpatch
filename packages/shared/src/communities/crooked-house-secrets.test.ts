import { describe, expect, it } from 'vitest';
import { CROOKED_HOUSE } from '../data/crooked-house.js';
import { CLOTHING_BY_ID } from '../data/clothing.js';
import { GAME_DATA } from '../data/index.js';
import { RESOURCES } from '../data/resources.js';
import { CROOKED_HOUSE_SECRETS } from '../data/server/crooked-house.js';
import { FAR_HOLLOW_FINDS } from '../data/server/hollowed-finds.js';
import { SPAWN_TABLES } from '../data/server/spawn-tables.js';
import { exploreFindTable } from '../explore/finds.js';
import { deriveSeed } from '../rng/index.js';
import { CrookedHouseSecretsSchema } from '../schemas/data/crooked-house-secrets.js';
import { crookedHouseSecrets } from './crooked-house-secrets.js';
import { reachWithKeys } from './crooked-house.js';

const seeds = Array.from({ length: 200 }, (_, i) => deriveSeed('crooked-test', i));

describe('CROOKED_HOUSE_SECRETS (#306 6b)', () => {
  it('parse, and name only real things', () => {
    expect(CrookedHouseSecretsSchema.parse(CROOKED_HOUSE_SECRETS)).toEqual(CROOKED_HOUSE_SECRETS);
    const rooms = CROOKED_HOUSE.rooms;
    // A bloom table for exactly the rooms that bloom, each one real.
    expect(Object.keys(CROOKED_HOUSE_SECRETS.blooms).sort()).toEqual(
      rooms
        .filter((r) => r.things.length > 0)
        .map((r) => r.id)
        .sort(),
    );
    // A story scrap for every room that blooms (#306 6f), and no other.
    expect(Object.keys(CROOKED_HOUSE_SECRETS.scraps).sort()).toEqual(
      Object.keys(CROOKED_HOUSE_SECRETS.blooms).sort(),
    );
    for (const spot of Object.values(CROOKED_HOUSE_SECRETS.blooms)) {
      expect(exploreFindTable(FAR_HOLLOW_FINDS, spot.kind, spot.terrain)).toBeDefined();
    }
    // A chest for exactly the bonus rooms.
    expect(Object.keys(CROOKED_HOUSE_SECRETS.chests).sort()).toEqual(
      rooms
        .filter((r) => r.kind === 'bonus')
        .map((r) => r.id)
        .sort(),
    );
    const resources = new Set(RESOURCES.map((r) => r.id));
    const piles = [
      CROOKED_HOUSE_SECRETS.attic.items,
      ...Object.values(CROOKED_HOUSE_SECRETS.chests).flatMap((c) => c.loot.map((l) => l.items)),
    ];
    for (const pile of piles)
      for (const id of Object.keys(pile)) expect(resources.has(id), id).toBe(true);
  });

  it('give friends that spawn in the wild, of their room’s element', () => {
    const species = new Map(GAME_DATA.species.map((s) => [s.id, s]));
    const spawns = new Set(SPAWN_TABLES.flatMap((t) => t.entries.map((e) => e.species)));
    for (const [room, chest] of Object.entries(CROOKED_HOUSE_SECRETS.chests)) {
      const door = CROOKED_HOUSE.doors.find((d) => d.b.room === room || d.a.room === room);
      for (const { species: id } of chest.friend.species) {
        expect(spawns.has(id), id).toBe(true);
        expect(species.get(id)?.element).toBe(door?.power);
      }
    }
  });

  it('keep the attic keepsake a found-only, untradable Legendary (owner decision 4)', () => {
    const cloak = CLOTHING_BY_ID.get(CROOKED_HOUSE_SECRETS.attic.keepsake);
    expect(cloak).toMatchObject({ rarity: 'legendary', sources: ['found'], tradable: false });
    expect(CROOKED_HOUSE_SECRETS.attic.items).toEqual({ heartdust: 10, glimmer: 25 });
  });
});

describe('crookedHouseSecrets (#306 6b, owner decision 8)', () => {
  it('is the same house for the same seed, and shuffles between seeds', () => {
    expect(crookedHouseSecrets(seeds[0]!)).toEqual(crookedHouseSecrets(seeds[0]!));
    const spots = new Set(seeds.map((s) => JSON.stringify(crookedHouseSecrets(s).keys)));
    expect(spots.size).toBeGreaterThan(50);
  });

  it('hides each key in a thing of one of its rooms, never a puzzle, never two in one thing', () => {
    const rooms = new Map(CROOKED_HOUSE.rooms.map((r) => [r.id, r]));
    const seen = new Map<string, Set<string>>();
    for (const seed of seeds) {
      const { keys } = crookedHouseSecrets(seed);
      const things = Object.values(keys).map((k) => `${k.room}/${k.thing}`);
      expect(new Set(things).size).toBe(CROOKED_HOUSE.keys.length);
      CROOKED_HOUSE.keys.forEach((key, i) => {
        const spot = keys[key.id]!;
        expect(key.hidesIn).toContain(spot.room);
        const thing = rooms.get(spot.room)!.things.find((t) => t.id === spot.thing);
        expect(thing?.kind).not.toBe('relight');
        // Never behind its own door: the keys before it reach the room.
        expect(reachWithKeys(CROOKED_HOUSE, i).has(spot.room)).toBe(true);
        seen.set(key.id, (seen.get(key.id) ?? new Set()).add(spot.room));
      });
    }
    // Over many seasons every room a key may hide in gets a turn.
    for (const key of CROOKED_HOUSE.keys) expect(seen.get(key.id)).toEqual(new Set(key.hidesIn));
  });

  it('gives every echo a phase and every bonus chest loot, with a friend about as often as the odds', () => {
    let friends = 0;
    let chests = 0;
    for (const seed of seeds) {
      const season = crookedHouseSecrets(seed);
      for (const loop of CROOKED_HOUSE.echoLoops) {
        const phase = season.echoes[loop.id]!;
        expect(phase.offset).toBeGreaterThanOrEqual(0);
        expect(phase.offset).toBeLessThan(1);
        expect([1, -1]).toContain(phase.direction);
      }
      for (const [room, chest] of Object.entries(season.chests)) {
        const rules = CROOKED_HOUSE_SECRETS.chests[room]!;
        expect(rules.loot.map((l) => l.items)).toContainEqual(chest.items);
        chests += 1;
        if (!chest.friend) continue;
        friends += 1;
        expect(rules.friend.species.map((s) => s.species)).toContain(chest.friend.speciesId);
        expect(chest.friend.level).toBeGreaterThanOrEqual(rules.friend.level.min);
        expect(chest.friend.level).toBeLessThanOrEqual(rules.friend.level.max);
      }
    }
    const chance = CROOKED_HOUSE_SECRETS.chests['pantry']!.friend.chance / 100;
    expect(friends / chests).toBeGreaterThan(chance * 0.6);
    expect(friends / chests).toBeLessThan(chance * 1.4);
  });
});
