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
import { squishyParams } from './params.js';
import { bentProportions, bentTip, partArrays } from './part-shapes.js';
import { partMatrix } from './placement.js';

/**
 * Byte-identity guard for the procedural kit (#234 kit extension): adding
 * new opt-in options (the `box` shape, `replaces`) must
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

  it.each(['low', 'high', 'hero'] as const)(
    'builds the original part shapes byte-identically at %s detail',
    (lod) => {
      const got = Object.fromEntries(
        ORIGINAL_SHAPES.map((shape) => {
          const m = partArrays(shape, LOD[lod]);
          return [shape, hash([...m.positions, ...m.normals, ...m.indices])];
        }),
      );
      expect(got).toEqual(GOLDEN_SHAPES[lod]);
    },
  );

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
    const root = zAt((y) => y < -0.4);
    const upper = zAt((y) => y > -0.3 && y < -0.2);
    const mid = zAt((y) => y > 0.1 && y < 0.2);
    const tip = zAt((y) => y > 0.42);
    expect(upper - root).toBeCloseTo(0, 2); // the top 40% is straight
    // v16: one even curve, not a hook at the very end: well before the tip
    // it is already turning forwards (v15's hook was still straight here).
    expect(mid - root).toBeGreaterThan(0.05);
    expect(tip - root).toBeGreaterThan(0.3); // the tip turns towards the front
  });
});

// Taken from origin/main's part-shapes.ts (before the kit extension) at each detail level.
const GOLDEN_SHAPES: Record<'low' | 'high' | 'hero', Record<string, string>> = {
  low: {
    ellipsoid: '48180fb1eeaa4afa',
    capsule: '5a126ce9c7126f75',
    cone: '55857b7438f449bc',
    teardrop: '5ea6bf1eb41fe5d6',
    arc: '8c43809456cf97c0',
  },
  high: {
    ellipsoid: 'f71d034af6a69a4a',
    capsule: 'b5debf2de3153011',
    cone: 'b68ffb78f73145e1',
    teardrop: 'eac6d8c7c9b19a23',
    arc: '98b102a9a5f19af0',
  },
  hero: {
    ellipsoid: '4606ea917dc80cbf',
    capsule: 'b03832654766d236',
    cone: '6a72af0cc743aeee',
    teardrop: '251046e5a6c8b471',
    arc: 'ead50646549b00ab',
  },
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

  it('keeps a ring without splay parallel and the same size', () => {
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

  it('gives every stage matching tines: the same size, evenly fanned (v15)', () => {
    for (const id of ['draft-pileup', 'draft-rakeling', 'draft-rakelet']) {
      const tines = tinesOf(id).placements;
      for (const p of tines) expect(p.size, id).toEqual(tines[0]!.size);
      // Mirrored fan, the middle (or middle pair) least splayed.
      const n = tines.length;
      for (let i = 0; i < n; i++) expect(tines[i]!.splay, id).toBeCloseTo(tines[n - 1 - i]!.splay);
    }
  });

  it('gives each stage two-tone tines: a lighter steel toe on the same placements (v16)', () => {
    const luma = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    for (const id of ['draft-pileup', 'draft-rakeling', 'draft-rakelet']) {
      const tines = tinesOf(id);
      expect(tines.accent?.mesh, id).toBe('bent-toe');
      // #b4bdc8: clearly lighter than the shaft's steel.
      expect(
        tines.accent!.color.map((c) => Math.round(c * 255)),
        id,
      ).toEqual([180, 189, 200]);
      expect(luma(tines.accent!.color), id).toBeGreaterThan(luma(tines.color) * 1.4);
    }
    // A one-mesh part stays exactly as it was: no accent key at all.
    const params = squishyParams(
      { id: 'draft-rakelet', visual: lookOf('draft-rakelet').visual },
      'kit-ring',
      drafts,
    );
    for (const p of params.parts.filter((p) => p.slot !== 'fangs'))
      expect('accent' in p, p.id).toBe(false);
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
  it('ends in a big forward hook: the toe juts well in front of the shaft (v15)', () => {
    const mesh = partArrays('bent', LOD.high);
    const [, length, thickness] = bentProportions();
    // The shaft's own front-to-back thickness, low down near the root.
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const y = mesh.positions[i + 1] ?? 0;
      if (y > -0.2 || y < -0.3) continue;
      zMin = Math.min(zMin, (mesh.positions[i + 2] ?? 0) * thickness);
      zMax = Math.max(zMax, (mesh.positions[i + 2] ?? 0) * thickness);
    }
    // v14's 30° arc jutted ~8% of its length past the shaft; the hook over 10%.
    expect((thickness - (zMax - zMin)) / length).toBeGreaterThan(0.1);
  });

  it('turns 60-75 degrees in one even curve over its lower 55-65%, with no straight foot (v16)', () => {
    const { turn, hook, foot } = bentTip();
    expect(turn).toBeGreaterThanOrEqual(60);
    expect(turn).toBeLessThanOrEqual(75);
    expect(hook).toBeGreaterThanOrEqual(0.55);
    expect(hook).toBeLessThanOrEqual(0.65);
    expect(foot).toBe(0);
  });

  it("never turns the toe up: each stage's lean plus the hook stays under 90 degrees (no J)", () => {
    const { turn } = bentTip();
    for (const part of DRAFT_PARTS.filter((p) => p.shape === 'bent' && p.anchor === 'front'))
      expect((part.tilt ?? 0) + turn, part.id).toBeLessThan(88);
  });

  it('is a flat strip, wider than it is thick', () => {
    const mesh = partArrays('bent', LOD.high);
    const [w, , t] = bentProportions();
    // Just under the hook (unit-box y < 0), the strip's sideways half-width
    // against its front-to-back half-thickness, in unfitted units.
    let x = 0;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const y = mesh.positions[i + 1] ?? 0;
      if (y > -0.2 || y < -0.3) continue;
      x = Math.max(x, Math.abs(mesh.positions[i] ?? 0) * w);
      zMin = Math.min(zMin, (mesh.positions[i + 2] ?? 0) * t);
      zMax = Math.max(zMax, (mesh.positions[i + 2] ?? 0) * t);
    }
    expect(x / ((zMax - zMin) / 2)).toBeGreaterThan(1.3);
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
    expect(tip / root).toBeLessThan(0.9); // v15: a big toe, so only a light taper
    expect(tip / root).toBeGreaterThan(0.6);
  });

  it("sizes the tines in the strip's own proportions, so the curve stays true", () => {
    const [w, l, t] = bentProportions();
    for (const part of DRAFT_PARTS.filter((p) => p.shape === 'bent' && p.anchor === 'front')) {
      const k = part.size[1] / l;
      // Length against depth carries the curve: exact.
      expect(part.size[2] / k, part.id).toBeCloseTo(t, 2);
      // Width is sideways only, so it may widen with a chunky bar (v16 Pileup) without bending the curve.
      expect(part.size[0] / k / w, part.id).toBeGreaterThanOrEqual(0.98);
      expect(part.size[0] / k / w, part.id).toBeLessThanOrEqual(1.3);
    }
  });

  it("widens Pileup's tines with its bar, so they're never hair-thin beside Rakelet's (v16)", () => {
    const widthOverBar = (tines: string, bar: string) => {
      const t = DRAFT_PARTS.find((p) => p.id === tines)!;
      const b = DRAFT_PARTS.find((p) => p.id === bar)!;
      return t.size[0] / b.size[2]; // the bar's size[2] is its height on the face
    };
    const rakelet = widthOverBar('draft-rake-tool-tines', 'draft-rake-tool-bar');
    expect(widthOverBar('draft-rake-tines-small', 'draft-rake-bar-small')).toBeGreaterThan(
      rakelet * 0.8,
    );
    expect(widthOverBar('draft-rake-tines-mid', 'draft-rake-bar')).toBeGreaterThan(rakelet * 0.8);
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

  it('curls every copy the same way, towards the viewer, so the hooks share one parallel arc (v15)', () => {
    const copy = (side: -1 | 0 | 1) =>
      partMatrix(
        orb,
        scale,
        { ...part, standoff: 0.1 },
        {
          around: 0,
          up: (-20 * Math.PI) / 180,
          size: [0.05, 0.4, 0.05],
          tilt: (20 * Math.PI) / 180,
          splay: side === 0 ? 0 : (15 * Math.PI) / 180,
          side,
        },
      );
    const unit = (m: readonly number[], k: number) => {
      const v = [m[k * 4]!, m[k * 4 + 1]!, m[k * 4 + 2]!];
      const n = Math.hypot(v[0]!, v[1]!, v[2]!);
      return v.map((c) => c / n);
    };
    for (const side of [-1, 1] as const) {
      const m = copy(side);
      const y = unit(m, 1);
      const z = unit(m, 2);
      // The curl direction (local z) has no sideways part beyond what the
      // shaft's own fan forces on it: it lies in the plane of the shaft and
      // the camera's forward axis, never turned out like a tusk.
      // The curl direction (local z) is the camera's forward axis flattened
      // against the shaft: the same for every copy, never turned out sideways.
      const f = [0, 0, -1];
      const dot = f[0]! * y[0]! + f[1]! * y[1]! + f[2]! * y[2]!;
      const flat = [f[0]! - dot * y[0]!, f[1]! - dot * y[1]!, f[2]! - dot * y[2]!];
      const fl = Math.hypot(flat[0]!, flat[1]!, flat[2]!);
      for (let k = 0; k < 3; k++) expect(z[k]!, `side ${side}`).toBeCloseTo(flat[k]! / fl, 6);
    }
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
