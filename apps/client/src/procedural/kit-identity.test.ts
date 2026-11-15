import { createHash } from 'node:crypto';
import {
  BODIES,
  GAME_DATA,
  PartShapeSchema,
  visualRegistry,
  type PartShape,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { FIXED_COLORS, LOD } from './config.js';
import { DRAFT_BODIES, DRAFT_PARTS, draftLooks } from './gallery/boss-drafts.js';
import { squishyParams, type PartPlacement } from './params.js';
import { bentProportions, bentTip, partArrays } from './part-shapes.js';
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

describe('ring splay and the metal role (#234 round 8)', () => {
  // A leaf-rake fan (round 8's variant B, dropped in round 11) keeps ring `splay` tested.
  const fanPart = {
    id: 'test-fan-tines',
    slot: 'fangs' as const,
    shape: 'bent' as const,
    size: [0.06, 0.52, 0.1] as [number, number, number],
    color: 'metal' as const,
    layout: { kind: 'ring' as const, count: 11, spread: 40 },
    around: 0,
    up: -22,
    tilt: -82,
    splay: 40,
    sink: 0.1,
    jitter: 0,
  };
  const drafts = visualRegistry({
    bodies: [...GAME_DATA.bodies, ...DRAFT_BODIES],
    parts: [...GAME_DATA.parts, ...DRAFT_PARTS, fanPart],
  });
  const lookOf = (id: string) => {
    const look = draftLooks().find((l) => l.id === id);
    if (!look) throw new Error(`no look ${id}`);
    return look;
  };
  const tinesOf = (id: string, visual = lookOf(id).visual) => {
    const params = squishyParams({ id, visual }, 'kit-ring', drafts);
    const tines = params.parts.find((p) => p.slot === 'fangs');
    if (!tines) throw new Error(`no tines on ${id}`);
    return tines;
  };

  it('fans a ring out with splay: mirrored, growing towards the ends', () => {
    const rakelet = lookOf('draft-rakelet').visual;
    const visual = {
      ...rakelet,
      parts: rakelet.parts.map((id) => (id === 'draft-rake-tool-tines' ? fanPart.id : id)),
    };
    const fan = tinesOf('test-fan', visual).placements;
    expect(fan).toHaveLength(11);
    const middle = fan[5];
    expect(middle?.splay).toBe(0);
    expect(middle?.side).toBe(0);
    for (let i = 0; i < 5; i++) {
      const left = fan[i];
      const right = fan[10 - i];
      expect(left?.side).toBe(-1);
      expect(right?.side).toBe(1);
      expect(left?.splay).toBeCloseTo(right?.splay ?? NaN);
      expect(left?.splay ?? 0).toBeGreaterThan(fan[i + 1]?.splay ?? 0);
    }
    expect(fan[0]?.splay).toBeLessThan((40 * Math.PI) / 180);
  });

  it('keeps a ring without splay or grow parallel and the same size', () => {
    // Rakeling's rivets set neither.
    const rivets = squishyParams(
      { id: 'draft-rakeling', visual: lookOf('draft-rakeling').visual },
      'kit-ring',
      drafts,
    ).parts.find((p) => p.slot === 'horns');
    expect(rivets?.placements).toHaveLength(4);
    for (const p of rivets?.placements ?? []) {
      expect([p.splay, p.side]).toEqual([0, 0]);
      expect(p.size).toEqual(rivets?.placements[0]?.size);
    }
  });

  it('makes outer copies of a ring with grow bigger, symmetrically (#234 round 11b)', () => {
    const tines = tinesOf('draft-rakelet').placements;
    expect(tines).toHaveLength(5);
    const length = tines.map((p) => p.size[1]);
    expect(length[0]).toBeCloseTo(length[4] ?? NaN);
    expect(length[1]).toBeCloseTo(length[3] ?? NaN);
    expect(length[0] ?? 0).toBeGreaterThan(length[1] ?? 0);
    expect(length[1] ?? 0).toBeGreaterThan(length[2] ?? 0);
    // grow 0.22: the outermost (offset 4/5) is 1 + 0.22 * 0.8 times the middle.
    expect((length[0] ?? 0) / (length[2] ?? 1)).toBeCloseTo(1.176, 6);
    // Each copy scales whole, so the dowel stays round.
    for (const p of tines)
      expect(p.size[0] / p.size[1]).toBeCloseTo(tines[2]!.size[0] / tines[2]!.size[1], 9);
  });

  it('colours metal parts the fixed metal grey', () => {
    const [r, g, b] = tinesOf('draft-rakelet').color;
    const hex = FIXED_COLORS.metal;
    expect([r, g, b].map((c) => Math.round(c * 255))).toEqual([
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ]);
  });

  it('keeps metal parts and the rake bar (a mouth stand-in) plain, without the vinyl finish', () => {
    expect(tinesOf('draft-rakelet').plain).toBe(true);
    const bar = squishyParams(
      { id: 'draft-rakelet', visual: lookOf('draft-rakelet').visual },
      'kit-ring',
      drafts,
    ).parts.find((p) => p.slot === 'mane');
    // v14: under the boss shimmer the wooden bar read salmon pink.
    expect(bar?.plain).toBe(true);
  });
});

describe('bent tine proportions (#234 round 11b)', () => {
  it('ends in a gentle forward arc, not a hook', () => {
    const [width, length, thickness] = bentProportions();
    // The tip's forward reach (thickness less the dowel) is under the dowel's
    // own thickness: a leaf-rake tip, not a return curl.
    expect(thickness - width).toBeGreaterThan(0);
    expect((thickness - width) / width).toBeLessThan(1);
    expect(length / width).toBeGreaterThan(6);
  });

  it('stops the arc at 30 degrees and runs straight on for the last tenth, so the tip never flicks up (v14)', () => {
    const { turn, foot } = bentTip();
    expect(turn).toBeLessThanOrEqual(30);
    expect(foot).toBeGreaterThanOrEqual(0.1);
  });

  it('tapers towards the tip', () => {
    const mesh = partArrays('bent', LOD.high);
    // Half-width in x near the root vs near the tip (y in the unit box).
    let root = 0;
    let tip = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = Math.abs(mesh.positions[i] ?? 0);
      const y = mesh.positions[i + 1] ?? 0;
      if (y < -0.3) root = Math.max(root, x);
      if (y > 0.3) tip = Math.max(tip, x);
    }
    expect(tip / root).toBeLessThan(0.8);
    expect(tip / root).toBeGreaterThan(0.4);
  });

  it("sizes Rakelet's tines in the dowel's own proportions, so they stay round", () => {
    const [w, l, t] = bentProportions();
    for (const part of DRAFT_PARTS.filter((p) => p.shape === 'bent' && p.anchor === 'front')) {
      const k = part.size[1] / l;
      expect(part.size[0] / k, part.id).toBeCloseTo(w, 1);
      expect(part.size[2] / k, part.id).toBeCloseTo(t, 1);
    }
  });
});

describe("anchor: 'front' (#234 round 11)", () => {
  const orb = BODIES.find((b) => b.id === 'orb');
  if (!orb) throw new Error('no orb body');
  const scale: [number, number, number] = [1, 1, 1];
  const part = { surface: false, sink: 0, lift: 0, flip: false, anchor: 'front' as const };
  const at = (around: number, tilt = 0, standoff = 0.1) =>
    partMatrix(
      orb,
      scale,
      { ...part, standoff },
      {
        around: (around * Math.PI) / 180,
        up: (-20 * Math.PI) / 180,
        size: [0.05, 0.4, 0.05],
        tilt: (tilt * Math.PI) / 180,
        splay: 0,
        side: 0,
      },
    );
  const root = (m: readonly number[]) => [
    (m[12] ?? 0) - (m[4] ?? 0) / 2,
    (m[13] ?? 0) - (m[5] ?? 0) / 2,
    (m[14] ?? 0) - (m[6] ?? 0) / 2,
  ];

  it('roots copies on one straight line in front of the face, evenly spaced', () => {
    const roots = [-60, -30, 0, 30, 60].map((a) => root(at(a)));
    const face = roots[2]!;
    for (const r of roots) {
      expect(r[2]).toBeCloseTo(face[2] ?? NaN, 9); // one straight line, not the face's curve
      expect(r[1]).toBeCloseTo(face[1] ?? NaN, 9);
    }
    const gaps = roots.slice(1).map((r, i) => (r[0] ?? 0) - (roots[i]![0] ?? 0));
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0] ?? NaN, 9);
    // `standoff` moves the line towards the viewer (-z).
    expect(root(at(0, 0, 0.2))[2]).toBeCloseTo((face[2] ?? 0) - 0.1, 9);
  });

  it('grows straight down, leaning towards the viewer by tilt, all parallel', () => {
    const m = at(0, 30);
    expect(m[4]).toBeCloseTo(0);
    expect(-(m[5] ?? 0) / 0.4).toBeCloseTo(Math.cos(Math.PI / 6));
    expect(-(m[6] ?? 0) / 0.4).toBeCloseTo(Math.sin(Math.PI / 6));
    expect(at(60, 30).slice(0, 12)).toEqual(m.slice(0, 12));
    // Straight out towards the viewer (a rivet) still has a finite frame.
    expect(at(0, 90).every(Number.isFinite)).toBe(true);
  });

  it("turns a fanned copy's curl outwards with its fan, as a rotation, mirrored left and right (v14)", () => {
    const copy = (side: -1 | 0 | 1) =>
      partMatrix(
        orb,
        scale,
        { ...part, standoff: 0.1 },
        {
          around: 0,
          up: (-20 * Math.PI) / 180,
          size: [0.05, 0.4, 0.05],
          tilt: (42 * Math.PI) / 180,
          splay: side === 0 ? 0 : (15 * Math.PI) / 180,
          side,
        },
      );
    const zOf = (m: readonly number[]) => [m[8]! / 0.05, m[9]! / 0.05, m[10]! / 0.05];
    const [l, mid, r] = [copy(-1), copy(0), copy(1)].map(zOf);
    expect(mid![0]).toBeCloseTo(0); // the middle tine curls straight forward
    expect(r![0]).toBeGreaterThan(0.3); // outwards, to the right
    expect(l![0]).toBeCloseTo(-r![0]!);
    expect(l![1]).toBeCloseTo(r![1]!);
    expect(l![2]).toBeCloseTo(r![2]!);
    // Still a rotation (right-handed), so no copy turns inside out.
    const m = copy(1);
    const det =
      m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) -
      m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!) +
      m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!);
    expect(det).toBeGreaterThan(0);
  });

  it('holds the rake bar still on every squishy, so it never slides off its rivets (v14)', () => {
    const registry = visualRegistry({
      bodies: [...GAME_DATA.bodies, ...DRAFT_BODIES],
      parts: [...GAME_DATA.parts, ...DRAFT_PARTS],
    });
    const look = draftLooks().find((l) => l.id === 'draft-pileup')!;
    const bars = ['kit-front', 'gallery-1', 'abc'].map(
      (iid) =>
        squishyParams({ id: look.id, visual: look.visual }, iid, registry).parts.find(
          (p) => p.slot === 'mane',
        )!.placements[0],
    );
    for (const b of bars) expect(b).toEqual(bars[0]);
  });

  it("roots Rakelet's tines on each stage's bar front face, under a rivet set into it", () => {
    const registry = visualRegistry({
      bodies: [...GAME_DATA.bodies, ...DRAFT_BODIES],
      parts: [...GAME_DATA.parts, ...DRAFT_PARTS],
    });
    const luma = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    for (const id of ['draft-pileup', 'draft-rakeling', 'draft-rakelet']) {
      const look = draftLooks().find((l) => l.id === id)!;
      const params = squishyParams({ id, visual: look.visual }, 'kit-front', registry);
      const head = params.head!;
      const body = registry.bodies.get(look.visual.head!.body)!;
      const bar = params.parts.find((p) => p.slot === 'mane')!;
      const tines = params.parts.find((p) => p.slot === 'fangs')!;
      const rivets = params.parts.find((p) => p.slot === 'horns')!;
      const cavity = params.parts.find((p) => p.slot === 'cheeks')!;
      const b = partMatrix(body, head.scale, bar, bar.placements[0]!, head.offset);
      const axis = (k: number) => [b[k * 4]!, b[k * 4 + 1]!, b[k * 4 + 2]!];
      // Where a point sits on the bar, in bar sizes from its centre: axis 1
      // is out of the face (0.5 is the front face), axis 2 its height.
      const on = (p: number[]) => {
        const d = [p[0]! - b[12]!, p[1]! - b[13]!, p[2]! - b[14]!];
        return [0, 1, 2].map((k) => {
          const a = axis(k);
          return (
            (d[0]! * a[0]! + d[1]! * a[1]! + d[2]! * a[2]!) / (a[0]! ** 2 + a[1]! ** 2 + a[2]! ** 2)
          );
        });
      };
      expect(rivets.placements).toHaveLength(tines.placements.length);
      tines.placements.forEach((p, i) => {
        const t = on(root(partMatrix(body, head.scale, tines, p, head.offset)));
        const rm = partMatrix(body, head.scale, rivets, rivets.placements[i]!, head.offset);
        const r = on([rm[12]!, rm[13]!, rm[14]!]);
        for (const [what, at] of [
          ['tine root', t],
          ['rivet', r],
        ] as const) {
          expect(Math.abs(at[0]!), `${id} ${what}`).toBeLessThan(0.5); // within the bar's width
          // On the visible front face itself, not floating in front of it (a
          // floating rivet drifts up or down the face as the camera moves, v14).
          expect(Math.abs(at[1]! - 0.5), `${id} ${what}`).toBeLessThan(0.1);
          expect(Math.abs(at[2]!), `${id} ${what}`).toBeLessThan(0.1); // mid-height
        }
        // The rivet sits over the tine's root and is wider than the tine, so
        // the tine's round end can't poke up above it towards the bar's top.
        expect(Math.abs(t[0]! - r[0]!), id).toBeLessThan(0.02);
        expect(rivets.placements[i]!.size[0], id).toBeGreaterThan(p.size[0]);
      });
      // A rivet, not a hole: lighter than the dark mouth behind the tines.
      expect(luma(rivets.color), id).toBeGreaterThan(luma(cavity.color) * 2);
    }
  });
});
