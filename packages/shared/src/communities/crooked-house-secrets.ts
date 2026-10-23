import { CROOKED_HOUSE } from '../data/crooked-house.js';
import { CROOKED_HOUSE_SECRETS } from '../data/server/crooked-house.js';
import { deriveSeed, Rng, type Seed } from '../rng/index.js';
import type { CrookedHouse } from '../schemas/data/crooked-house.js';
import type { CrookedHouseSecrets } from '../schemas/data/crooked-house-secrets.js';
import type { ItemCounts } from '../gathering/index.js';
import type { EchoPhase } from './crooked-house.js';

// A season's Crooked House on a patch (#306 6b, owner decision 8): the
// fixed house, shuffled by the season's far-Hollow seed. Server-only (rule
// 6): exported from `@heartpatch/shared/server`, never the root entry. The
// client learns where a key hid only when a fix turns it up, and never
// learns a chest's odds.

/** Where a key hides: a crooked thing in a room. */
export interface CrookedSpot {
  readonly room: string;
  readonly thing: string;
}

/** A rare friend waiting in a chest, to befriend in a battle (Heart Charms work). */
export interface CrookedFriend {
  readonly speciesId: string;
  readonly level: number;
}

export interface CrookedHouseSeason {
  /** Key id → the thing it hides in. */
  readonly keys: Readonly<Record<string, CrookedSpot>>;
  /** Echo loop id → its phase (sent to the client, which draws it). */
  readonly echoes: Readonly<Record<string, EchoPhase>>;
  /** Bonus room id → its chest: the loot, and a friend or none. */
  readonly chests: Readonly<Record<string, { items: ItemCounts; friend: CrookedFriend | null }>>;
}

/**
 * The season's house: each key in a crooked thing of one of its `hidesIn`
 * rooms (never a Relight board, never two keys in one thing), each echo's
 * phase, and each bonus chest's loot and rare-friend roll. Pure: the same
 * seed always gives the same house.
 */
export function crookedHouseSecrets(
  seed: Seed,
  house: CrookedHouse = CROOKED_HOUSE,
  secrets: CrookedHouseSecrets = CROOKED_HOUSE_SECRETS,
): CrookedHouseSeason {
  const rooms = new Map(house.rooms.map((r) => [r.id, r]));

  const keys: Record<string, CrookedSpot> = {};
  const taken = new Set<string>();
  for (const key of house.keys) {
    const rng = Rng.fromSeed(deriveSeed(seed, 'crooked-house', 'key', key.id));
    const spots = key.hidesIn.flatMap((room) =>
      (rooms.get(room)?.things ?? [])
        .filter((t) => t.kind !== 'relight' && !taken.has(`${room}/${t.id}`))
        .map((t) => ({ room, thing: t.id })),
    );
    // Room first, then a thing in it, so a room of many things isn't likelier.
    const byRoom = [...new Set(spots.map((s) => s.room))];
    if (byRoom.length === 0) throw new Error(`crookedHouseSecrets: nowhere for ${key.id}`);
    const room = rng.pick(byRoom);
    const spot = rng.pick(spots.filter((s) => s.room === room));
    taken.add(`${spot.room}/${spot.thing}`);
    keys[key.id] = spot;
  }

  const echoes: Record<string, EchoPhase> = {};
  for (const loop of house.echoLoops) {
    const rng = Rng.fromSeed(deriveSeed(seed, 'crooked-house', 'echo', loop.id));
    echoes[loop.id] = { offset: rng.next(), direction: rng.chance(50) ? 1 : -1 };
  }

  const chests: Record<string, { items: ItemCounts; friend: CrookedFriend | null }> = {};
  for (const room of house.rooms.filter((r) => r.kind === 'bonus')) {
    const chest = secrets.chests[room.id];
    if (!chest) throw new Error(`crookedHouseSecrets: no chest for ${room.id}`);
    const rng = Rng.fromSeed(deriveSeed(seed, 'crooked-house', 'chest', room.id));
    const items = { ...rng.weighted(chest.loot).items };
    const { friend } = chest;
    const found = rng.chance(friend.chance);
    // Always rolled, so a tuned chance never shifts the friend a seed gives.
    const species = rng.weighted(friend.species).species;
    const level = rng.int(friend.level.min, friend.level.max);
    chests[room.id] = { items, friend: found ? { speciesId: species, level } : null };
  }

  return { keys, echoes, chests };
}
