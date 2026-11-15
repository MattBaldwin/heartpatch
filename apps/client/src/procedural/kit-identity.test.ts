import { createHash } from 'node:crypto';
import {
  BODIES,
  GAME_DATA,
  PartShapeSchema,
  visualRegistry,
  type PartShape,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { LOD } from './config.js';
import { squishyParams, type PartPlacement } from './params.js';
import { partArrays } from './part-shapes.js';
import { partMatrix } from './placement.js';

/**
 * Byte-identity guard for the procedural kit (#234 kit extension): adding
 * new opt-in options (the `box` shape, `anchor: 'behind'`, `replaces`) must
 * not move a single vertex or matrix of any shipped species. The hashes were
 * taken on the code before the extension; if one changes, an existing
 * species renders differently.
 */

const registry = visualRegistry(GAME_DATA);

/** The shapes that existed before the extension. */
const ORIGINAL_SHAPES: readonly PartShape[] = ['ellipsoid', 'capsule', 'cone', 'teardrop', 'arc'];

function hash(values: readonly number[]): string {
  const h = createHash('sha256');
  h.update(new Float64Array(values));
  return h.digest('hex').slice(0, 16);
}

/** Every part matrix of every shipped species, in the order the field draws them. */
function rosterMatrices(): number[] {
  const out: number[] = [];
  for (const species of GAME_DATA.species) {
    const params = squishyParams(species, 'kit-identity', registry);
    const body = registry.bodies.get(species.visual.body);
    const head = species.visual.head ? registry.bodies.get(species.visual.head.body) : undefined;
    if (!body) throw new Error(`no body for ${species.id}`);
    out.push(...params.body.scale, params.lift, params.height);
    for (const part of params.parts) {
      const onHead = part.host === 'head' && params.head && head;
      const hostBody = onHead ? head : body;
      const hostScale = onHead ? params.head.scale : params.body.scale;
      const hostAt: [number, number, number] = onHead
        ? [...params.head.offset]
        : [0, params.lift, 0];
      for (const p of part.placements) {
        out.push(...partMatrix(hostBody, hostScale, part, p, hostAt));
      }
    }
  }
  return out;
}

describe('kit extension byte identity', () => {
  it('lists the original shapes first in the schema', () => {
    expect(PartShapeSchema.options.slice(0, ORIGINAL_SHAPES.length)).toEqual(ORIGINAL_SHAPES);
  });

  it('builds the original part shapes byte-identically', () => {
    const got = Object.fromEntries(
      ORIGINAL_SHAPES.map((shape) => {
        const m = partArrays(shape, LOD.high);
        return [shape, hash([...m.positions, ...m.normals, ...m.indices])];
      }),
    );
    expect(got).toEqual(GOLDEN_SHAPES);
  });

  it('places every shipped species part byte-identically', () => {
    expect(hash(rosterMatrices())).toBe(GOLDEN_ROSTER);
  });
});

describe('box shape', () => {
  it('has flat sides: its widest vertices reach its corners, unlike an ellipsoid', () => {
    const cornerish = (shape: PartShape) => {
      const p = partArrays(shape, LOD.high).positions;
      let n = 0;
      for (let i = 0; i < p.length; i += 3) {
        if (Math.abs(p[i] ?? 0) > 0.45 && Math.abs(p[i + 1] ?? 0) > 0.4) n++;
      }
      return n;
    };
    expect(cornerish('box')).toBeGreaterThan(0);
    expect(cornerish('ellipsoid')).toBe(0);
  });
});

describe('bent shape', () => {
  it('fills the unit box, stays straight at the root and kicks forward (+z) at the tip', () => {
    const p = partArrays('bent', LOD.high).positions;
    const zAt = (keep: (y: number) => boolean) => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < p.length; i += 3) {
        if (keep(p[i + 1] ?? 0)) {
          sum += p[i + 2] ?? 0;
          n++;
        }
      }
      return sum / n;
    };
    const extent = (k: number) => {
      const v = p.filter((_, i) => i % 3 === k);
      return Math.max(...v) - Math.min(...v);
    };
    expect(extent(0)).toBeCloseTo(1, 9);
    expect(extent(1)).toBeCloseTo(1, 9);
    expect(extent(2)).toBeCloseTo(1, 9);
    const root = zAt((y) => y < -0.2);
    const mid = zAt((y) => y > -0.1 && y < 0.1);
    const tip = zAt((y) => y > 0.42);
    expect(mid - root).toBeCloseTo(0, 2); // the root two-thirds are straight
    expect(tip - root).toBeGreaterThan(0.3); // the tip turns towards the front
  });
});

describe("anchor: 'behind'", () => {
  const orb = BODIES.find((b) => b.id === 'orb');
  if (!orb) throw new Error('no orb body');
  const scale: [number, number, number] = [1, 1, 1];
  const placement: PartPlacement = {
    around: 0,
    up: (-10 * Math.PI) / 180,
    size: [0.08, 1.4, 0.08],
    tilt: 0,
    splay: 0,
    side: 0,
  };
  const part = { surface: false, sink: 0, lift: 0, flip: false, anchor: 'behind' as const };
  type Rows = [number[], number[], number[], number[]];
  const rows = (m: readonly number[]): Rows => [
    m.slice(0, 3),
    m.slice(4, 7),
    m.slice(8, 11),
    m.slice(12, 15),
  ];

  it('stands clear of the back at the anchor height and grows straight up', () => {
    const [, y, , centre] = rows(partMatrix(orb, scale, part, placement));
    const back = (orb.depth / 2) * scale[2];
    const bottom = (centre[1] ?? 0) - (y[1] ?? 0) / 2;
    expect(y[0]).toBeCloseTo(0);
    expect(y[2]).toBeCloseTo(0);
    expect(centre[2]).toBeGreaterThan(back);
    // Its foot is at the face spot's height, in line with a bar on the mouth.
    const face = rows(
      partMatrix(orb, scale, { ...part, anchor: undefined, surface: true }, placement),
    )[3];
    expect(bottom).toBeCloseTo(face[1] ?? NaN, 1);
  });

  it('leans back with positive tilt', () => {
    const [, y] = rows(partMatrix(orb, scale, part, { ...placement, tilt: Math.PI / 12 }));
    expect(y[2]).toBeGreaterThan(0);
    expect(y[1]).toBeGreaterThan(0);
  });

  it('changes nothing when unset', () => {
    const plain = { surface: false, sink: 0, lift: 0, flip: false };
    expect(partMatrix(orb, scale, plain, placement)).toEqual(
      partMatrix(orb, scale, { ...plain, anchor: undefined }, placement),
    );
  });
});

const GOLDEN_SHAPES: Record<string, string> = {
  ellipsoid: 'f71d034af6a69a4a',
  capsule: 'b5debf2de3153011',
  cone: 'b68ffb78f73145e1',
  teardrop: 'eac6d8c7c9b19a23',
  arc: '98b102a9a5f19af0',
};
const GOLDEN_ROSTER = 'df66e5c157262849';
