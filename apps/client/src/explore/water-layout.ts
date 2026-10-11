import type { WorldPoint } from '@heartpatch/shared';
import { seededRandom } from './explore-world.js';
import type { Growth, MoteHome } from './land-layout.js';
import { hexReach, softNoise, type LandField } from './land-shape.js';
import { WATER_MOTION, type WaterLook } from './lake-config.js';

// What lives in the lake (#335 art reset), pure and seeded from the tile like
// the meadow's layout, so every device sees the same water. World units.
// Kelp stands in a ring round the tile and in groves on the far bed, never
// in front of the tile (towards the camera, which looks along +z); coral
// lines the tile's edge like the meadow's hedge; fish circle over the tile;
// bubbles rise over the bubble springs and across the water.

/** A fish: where it circles (`orbit` drift), how big, and its colour. */
export interface FishHome extends MoteHome {
  /** The circle's radius and its speed. */
  readonly radius: number;
  readonly speed: number;
  readonly color: number;
}

/** A bubble: its home (the foot of its rise), how high it rises and how fast. */
export interface BubbleHome extends MoteHome {
  readonly rise: number;
  readonly speed: number;
}

export interface WaterLayout {
  readonly kelp: readonly Growth[];
  readonly coral: readonly Growth[];
  readonly fish: readonly FishHome[];
  readonly bubbles: readonly BubbleHome[];
}

export interface WaterLayoutInput {
  readonly look: WaterLook;
  readonly land: LandField;
  readonly seed: number;
  /** The tile's size: middle to corner, world units. */
  readonly size: number;
  /** Where the Keeper starts (kept clear), and the bubble springs. */
  readonly start: WorldPoint;
  readonly springs: readonly WorldPoint[];
  /** How many fish colours there are. */
  readonly fishColors: number;
}

/** Kelp and trees' rule: nothing tall in front of the tile within this half-width. */
const FRONT_CLEAR = 9; // TUNE
/** The far kelp's ring, world units from the middle. */
const FAR = { from: 13, to: 40 } as const; // TUNE

export function waterLayout(input: WaterLayoutInput): WaterLayout {
  const { look, land, seed, size, start, springs } = input;
  const rand = seededRandom(seed ^ 0x1a4e);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const reach = (x: number, z: number) => hexReach({ x, z }, size);
  const inFront = (x: number, z: number) => z < -size * 0.55 && Math.abs(x) < FRONT_CLEAR;
  const onPath = (x: number, z: number, wide: number) => Math.abs(x - land.pathX(z)) < wide;
  const at = (x: number, z: number, scale: number): Growth => ({
    x,
    z,
    yaw: rand() * Math.PI * 2,
    scale,
  });

  // Kelp: a ring just outside the tile, then groves on the far bed (where the noise is high).
  const kelp: Growth[] = [];
  const placed: WorldPoint[] = [];
  for (let tries = 0; kelp.length < look.kelp.near && tries < 800; tries++) {
    const angle = rand() * Math.PI * 2;
    const out = between(size * 1.2, size * 2);
    const x = Math.cos(angle) * out;
    const z = Math.sin(angle) * out;
    if (inFront(x, z) || reach(x, z) < 1.12 || onPath(x, z, 1.4)) continue;
    if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 2 ** 2)) continue;
    placed.push({ x, z });
    kelp.push(at(x, z, between(0.85, 1.25)));
  }
  const nearKelp = kelp.length;
  for (
    let tries = 0;
    kelp.length - nearKelp < look.kelp.far && tries < look.kelp.far * 30;
    tries++
  ) {
    const angle = rand() * Math.PI * 2;
    const out = between(FAR.from, FAR.to);
    const x = Math.cos(angle) * out;
    const z = Math.sin(angle) * out;
    if (z < -size * 1.2 || softNoise(x * 0.09, z * 0.09, seed + 11) < 0.05 || onPath(x, z, 2)) {
      continue;
    }
    kelp.push(at(x, z, between(0.9, 1.6)));
  }

  // Coral: a soft hedge along the tile's edge (a gap where the trail leaves), and scattered further out.
  const coral: Growth[] = [];
  for (let i = 0; i < look.coral.edge; i++) {
    const angle = ((i + rand() * 0.6) / look.coral.edge) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const out = (1 / Math.max(1e-6, reach(dx, dz))) * between(1.06, 1.2);
    const x = dx * out;
    const z = dz * out;
    if (land.pathMask(x, z, 0.1) > 0 || onPath(x, z, 1.1)) continue;
    coral.push(at(x, z, between(0.8, 1.2)));
  }
  for (let tries = 0, n = 0; n < look.coral.outside && tries < 400; tries++) {
    const angle = rand() * Math.PI * 2;
    const out = between(size * 1.25, size * 2.3);
    const x = Math.cos(angle) * out;
    const z = Math.sin(angle) * out;
    if (onPath(x, z, 1.2)) continue;
    coral.push(at(x, z, between(0.9, 1.5)));
    n++;
  }

  // Fish: circling over the tile, kept off the front so they never hide the Keeper's feet.
  const m = WATER_MOTION.fish;
  const fish: FishHome[] = [];
  for (let tries = 0; fish.length < look.fish && tries < 200; tries++) {
    const x = between(-size, size);
    const z = between(-size, size);
    if (reach(x, z) > 0.95 || (x - start.x) ** 2 + (z - start.z) ** 2 < 2 ** 2) continue;
    fish.push({
      x,
      y: land.height(x, z) + between(m.lift[0], m.lift[1]),
      z,
      size: between(m.size[0], m.size[1]),
      phase: rand() * Math.PI * 2,
      radius: between(m.radius[0], m.radius[1]),
      speed: between(m.speed[0], m.speed[1]),
      color: Math.floor(rand() * input.fishColors),
    });
  }

  // Bubbles: a stream over each spring, and loose ones across the water.
  const b = WATER_MOTION.bubble;
  const bubble = (x: number, z: number): BubbleHome => ({
    x,
    y: land.height(x, z) + 0.05,
    z,
    size: between(b.size[0], b.size[1]),
    phase: rand() * Math.PI * 2,
    rise: between(b.rise[0], b.rise[1]),
    speed: between(b.speed[0], b.speed[1]),
  });
  const bubbles: BubbleHome[] = [];
  for (const s of springs) {
    for (let i = 0; i < look.bubbles.perSpring; i++) {
      bubbles.push(bubble(s.x + between(-0.12, 0.12), s.z + between(-0.12, 0.12)));
    }
  }
  for (let i = 0; i < look.bubbles.ambient; i++) {
    const angle = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * size * 1.4;
    bubbles.push(bubble(Math.cos(angle) * d, Math.sin(angle) * d));
  }

  return { kelp, coral, fish, bubbles: shuffled(bubbles, rand) };
}

/** A stable shuffle, so the first n of the list (a lower tier's share) spread evenly. */
function shuffled<T>(list: T[], rand: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = list[i] as T;
    list[i] = list[j] as T;
    list[j] = a;
  }
  return list;
}
