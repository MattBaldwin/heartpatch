/// <reference types="node" />
import {
  forecastLine,
  hexDistance,
  hexKey,
  isWaterTerrain,
  type Hex,
  type HomeResponse,
  type MapView,
  type MyBuilding,
  type PublicBuilding,
  type PublicTile,
  type WeatherDay,
  type WeatherFront,
} from '@heartpatch/shared';
import { heartSeedOf } from '../../src/hollow/dark-land.js';
import { testWildIsle } from '../../src/map/test-view.js';

// The ONE world every weather shot draws (#621 W1-9): `testWildIsle()` named
// "Drizzle Cove", the signed-in player as Keeper 1, a Woodcutter's Hut on a
// tile of mine (a storm can knock it about), and a Weather Vane that is only
// placed in the frames that have one. Printed as JSON for shoot.mjs, which
// serves it for the view, the weather plan and my home.
// Run: `tsx --conditions=@heartpatch/source fixture.ts '<{"member":…,"mapId":…,"seq":…,"nowMs":…}>'`.

interface Input {
  member: MapView['members'][number];
  mapId: string;
  seq: number;
  /** The pinned game clock: noon in the map's time zone. */
  nowMs: number;
}

const input = JSON.parse(process.argv[2] ?? '{}') as Input;
const base = testWildIsle();
const fixtureMember = base.members[0];
if (!fixtureMember) throw new Error('no member 1');
const fixtureMe = fixtureMember.user.id;
const me = input.member.user.id;

const view: MapView = {
  ...base,
  map: { ...base.map, id: input.mapId, name: 'Drizzle Cove' },
  members: [input.member, ...base.members.slice(1)],
  tiles: base.tiles.map((t) => ({
    ...t,
    ownerUserId: t.ownerUserId === fixtureMe ? me : t.ownerUserId,
    buildings: [...t.buildings],
  })),
  seq: input.seq,
};
const seed = heartSeedOf(view, me);
if (!seed) throw new Error('no heart seed');
const dist = (a: Hex, b: Hex) => hexDistance(a, b);

const mine = view.tiles.filter(
  (t) => t.ownerUserId === me && t.homeSlot === null && !isWaterTerrain(t.terrain),
);
const hutTile = [...mine]
  .filter((t) => t.buildings.length === 0 && t.terrain !== 'junipers-gap' && dist(t, seed) >= 2)
  .sort((a, b) => dist(a, seed) - dist(b, seed) || a.q - b.q || a.r - b.r)[0];
if (!hutTile) throw new Error('no tile for the hut');
const vaneTile = view.tiles
  .filter((t) => t.homeSlot === 0 && t.q !== seed.q && t.r !== seed.r)
  .sort((a, b) => dist(a, seed) - dist(b, seed) || a.q - b.q || a.r - b.r)[0];
if (!vaneTile) throw new Error('no home tile for the vane');

const building = (buildingId: string, kind: PublicBuilding['kind'], n: number, spot: number) =>
  ({
    id: `0190a8c4-0000-7000-8000-e${String(n).padStart(11, '0')}`,
    buildingId,
    kind,
    level: 1,
    spot,
    lit: null,
    safeRadius: null,
  }) satisfies PublicBuilding;
const hut = building('woodcutters-hut', 'resource', 1, 1);
const vane = building('weather-vane', 'vane', 2, 2);

// --- Today's and tomorrow's skies, all over my Heart Seed. ---
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const at = (dq: number, dr: number): Hex => ({ q: seed.q + dq, r: seed.r + dr });
let nth = 0;
const front = (
  kind: WeatherFront['kind'],
  from: Hex,
  to: Hex,
  startH: number,
  endH: number,
  radius = 3,
  day = '2026-10-25',
): WeatherFront => ({
  id: `${day}-${String(++nth)}`,
  kind,
  from,
  to,
  startAt: iso(input.nowMs + startH * HOUR),
  endAt: iso(input.nowMs + endH * HOUR),
  radius,
});
const TODAY = '2026-10-25';
const TOMORROW = '2026-10-26';
// A front crossing the island is over my home in the middle of its trip.
const rain = front('rain', at(-8, 0), at(8, 0), -3, 3);
const storm = front('storm', at(0, -8), at(0, 8), 5, 8);
const fog = front('fog', at(8, -4), at(-8, 4), -9, -4);
// The same kinds of sky centred on home right now, for the map frames.
const stormNow = front('storm', at(0, -8), at(0, 8), -2, 2);
const fogNow = front('fog', at(8, -4), at(-8, 4), -2, 2);
const day = (fronts: WeatherFront[], day = TODAY): WeatherDay => ({ day, fronts });
const tomorrow: WeatherDay = day(
  [
    front('fog', at(8, 0), at(-8, 0), 14, 17, 3, TOMORROW),
    front('rain', at(-8, 4), at(8, -4), 20, 24, 3, TOMORROW),
  ],
  TOMORROW,
);
// Tomorrow began 04:00 UTC the day after (EDT), the line a player without a Vane gets.
const tomorrowStartMs = Date.parse(`${TOMORROW}T04:00:00Z`);

// What fixing a knocked hut asks; the same on the card and the bag.
const repairCost = { timber: 6, stone: 2 };
const placed: MyBuilding = {
  ...hut,
  q: hutTile.q,
  r: hutTile.r,
  nightsLeft: null,
  fuelSpace: null,
  capacity: null,
  residents: null,
};
const homeTiles = view.tiles.filter((t) => t.homeSlot === 0 && t.communityId === null);
const home = (knocked: boolean): HomeResponse => ({
  tiles: homeTiles.map((t) => ({
    q: t.q,
    r: t.r,
    heartSeed: hexKey(t) === hexKey(seed),
    nodeResource: null,
  })),
  buildings: [knocked ? { ...placed, knocked: true, repairCost } : placed],
  squishies: [],
  speciesDefs: [],
  items: { timber: 40, stone: 30, glimmer: 3 },
  seasons: [],
  tonight: TODAY,
  now: iso(input.nowMs),
});

const tileOf = (t: PublicTile) => ({ q: t.q, r: t.r });
process.stdout.write(
  JSON.stringify({
    view,
    plans: {
      rain: day([rain]),
      storm: day([stormNow]),
      fog: day([fogNow]),
      clear: day([]),
      // The sheet's day: fog this morning, rain right now, a storm tonight.
      sheet: day([fog, rain, storm]),
    },
    tomorrow,
    tomorrowSummary: forecastLine(tomorrow, tomorrowStartMs),
    hut: { tile: tileOf(hutTile), building: hut },
    vane: { tile: tileOf(vaneTile), building: vane },
    home: { plain: home(false), knocked: home(true) },
    seed,
    repairCost,
  }),
);
