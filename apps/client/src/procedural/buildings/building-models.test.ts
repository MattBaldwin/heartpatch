import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { GAME_DATA } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILDING_COLORS, LEVEL_SCALE } from './building-config.js';
import { buildBuildingModel, levelScale } from './building-models.js';

const RESOURCE = GAME_DATA.buildings.filter((b) => b.kind === 'resource').map((b) => b.id);

describe('resource building models (#601 PR 7)', () => {
  const engine = new NullEngine({
    renderWidth: 390,
    renderHeight: 844,
    textureSize: 1,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  afterEach(() => {
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  const vertices = (scene: Scene, id: string, level: number, look: 'plain' | 'out' = 'plain') => {
    const { body, glow } = buildBuildingModel(scene, id, look, level);
    return { body: body.getTotalVertices(), glow: glow?.getTotalVertices() ?? 0, mesh: body };
  };

  it('gives LEVEL_SCALE a fourth step, each taller than the last', () => {
    expect(LEVEL_SCALE).toHaveLength(4);
    expect(levelScale(4).up).toBeGreaterThan(levelScale(3).up);
    expect(levelScale(9)).toEqual(levelScale(4));
  });

  it('has its own model for each of the seven, not the plain marker', () => {
    const scene = new Scene(engine);
    const marker = vertices(scene, 'no-such-building', 1).body;
    expect(RESOURCE).toHaveLength(7);
    for (const id of RESOURCE) expect(vertices(scene, id, 1).body, id).toBeGreaterThan(marker);
  });

  it('adds detail at every level, L1 to L4, and stands taller', () => {
    const scene = new Scene(engine);
    for (const id of RESOURCE) {
      const sizes = [1, 2, 3, 4].map((l) => {
        const v = vertices(scene, id, l);
        return { parts: v.body + v.glow, height: v.mesh.getBoundingInfo().boundingBox.maximum.y };
      });
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i]?.parts, `${id} L${String(i + 1)}`).toBeGreaterThan(
          sizes[i - 1]?.parts ?? 0,
        );
        expect(sizes[i]?.height, `${id} L${String(i + 1)}`).toBeGreaterThan(
          sizes[i - 1]?.height ?? 0,
        );
      }
    }
  });

  it('glows while it works and goes dark while it naps', () => {
    const scene = new Scene(engine);
    for (const id of RESOURCE) {
      expect(vertices(scene, id, 1, 'plain').glow, id).toBeGreaterThan(0);
      expect(vertices(scene, id, 1, 'out').glow, id).toBe(0);
    }
  });

  it('draws the Warehouse (PR 9) as its own toy that glows awake and goes dark asleep', () => {
    const scene = new Scene(engine);
    const marker = vertices(scene, 'no-such-building', 1).body;
    expect(vertices(scene, 'warehouse', 1).body).toBeGreaterThan(marker);
    expect(vertices(scene, 'warehouse', 1, 'plain').glow).toBeGreaterThan(0);
    expect(vertices(scene, 'warehouse', 1, 'out').glow).toBe(0);
    const before = scene.meshes.length;
    buildBuildingModel(scene, 'warehouse', 'plain', 1);
    expect(scene.meshes.length - before).toBeLessThanOrEqual(2);
  });

  it('is one body mesh and at most one glow mesh, so a kind is one or two draw calls', () => {
    const scene = new Scene(engine);
    const before = scene.meshes.length;
    buildBuildingModel(scene, 'greenhouse', 'plain', 4);
    expect(scene.meshes.length - before).toBeLessThanOrEqual(2);
  });
});

describe('Wild Isle travel models (#621 W1-6)', () => {
  const engine = new NullEngine({
    renderWidth: 390,
    renderHeight: 844,
    textureSize: 1,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  afterEach(() => {
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  it('builds a bridge that lies along +x and a dock with a lamp, not the plain box', () => {
    const scene = new Scene(engine);
    const plain = buildBuildingModel(scene, 'mystery', 'plain', 1).body;
    const bridge = buildBuildingModel(scene, 'bridge', 'plain', 1);
    const dock = buildBuildingModel(scene, 'ferry-dock', 'plain', 1);
    expect(bridge.body.getTotalVertices()).toBeGreaterThan(plain.getTotalVertices());
    expect(dock.body.getTotalVertices()).toBeGreaterThan(plain.getTotalVertices());
    // The lamps glow.
    expect(bridge.glow).not.toBeNull();
    expect(dock.glow).not.toBeNull();
    // Longer than wide, so the map can turn it bank to bank.
    const size = bridge.body.getBoundingInfo().boundingBox.extendSize;
    expect(size.x).toBeGreaterThan(size.z * 2);
  });
});

describe('Wild Isle works models (#621 W1-10)', () => {
  const engine = new NullEngine({
    renderWidth: 390,
    renderHeight: 844,
    textureSize: 1,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  afterEach(() => {
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  /** Every Wild Isle building that stands on a homestead spot (bridges sit on rivers). */
  const WILD = GAME_DATA.buildings
    .filter(
      (b) => b.patchTypes?.includes('wild-isle') && b.id !== 'bridge' && b.id !== 'ferry-dock',
    )
    .map((b) => b.id);
  const WORKS = GAME_DATA.buildings.filter((b) => b.kind === 'works').map((b) => b.id);
  /** TUNE: about the Greenhouse's; a homestead shows a handful at once. */
  const TRIANGLE_CAP = 6000;

  const triangles = (m: { body: Mesh; glow: Mesh | null }) =>
    (m.body.getTotalIndices() + (m.glow?.getTotalIndices() ?? 0)) / 3;

  it('has its own model for each, not the plain marker', () => {
    const scene = new Scene(engine);
    const marker = buildBuildingModel(
      scene,
      'no-such-building',
      'plain',
      1,
    ).body.getTotalVertices();
    expect(WILD).toHaveLength(11);
    for (const id of WILD) {
      expect(buildBuildingModel(scene, id, 'plain', 1).body.getTotalVertices(), id).toBeGreaterThan(
        marker,
      );
    }
  });

  it('gives every one its own shape (no two the same size and part count)', () => {
    const scene = new Scene(engine);
    const shapes = new Map<string, string>();
    for (const id of [...WILD, 'water-well']) {
      const { body } = buildBuildingModel(scene, id, 'plain', 1);
      const e = body.getBoundingInfo().boundingBox.extendSize;
      const shape = [body.getTotalVertices(), e.x, e.y, e.z].map((n) => n.toFixed(2)).join(',');
      expect(shapes.get(shape), `${id} looks like ${shapes.get(shape) ?? ''}`).toBeUndefined();
      shapes.set(shape, id);
    }
  });

  it('adds detail at every level of a works, L1 to L4, and stands taller', () => {
    const scene = new Scene(engine);
    expect(WORKS).toHaveLength(6);
    for (const id of WORKS) {
      let last = { parts: 0, height: 0 };
      for (const l of [1, 2, 3, 4]) {
        const m = buildBuildingModel(scene, id, 'plain', l);
        const now = {
          parts: m.body.getTotalVertices() + (m.glow?.getTotalVertices() ?? 0),
          height: m.body.getBoundingInfo().boundingBox.maximum.y,
        };
        expect(now.parts, `${id} L${String(l)}`).toBeGreaterThan(last.parts);
        expect(now.height, `${id} L${String(l)}`).toBeGreaterThan(last.height);
        last = now;
      }
    }
  });

  it('lights its lamp while it works and goes dark while it naps', () => {
    const scene = new Scene(engine);
    for (const id of WILD.filter((i) => i !== 'canal' && i !== 'levee')) {
      expect(buildBuildingModel(scene, id, 'plain', 1).glow, id).not.toBeNull();
      // A napping works' only glow is its lilac "z z"; the rest go fully dark.
      const out = buildBuildingModel(scene, id, 'out', 1).glow;
      if (!WORKS.includes(id)) {
        expect(out, id).toBeNull();
        continue;
      }
      const colors = out?.getVerticesData(VertexBuffer.ColorKind) ?? [];
      const z = Color3.FromHexString(BUILDING_COLORS.napZ).toLinearSpace();
      expect(colors.length, id).toBeGreaterThan(0);
      for (let i = 0; i < colors.length; i += 4) {
        expect(colors[i], id).toBeCloseTo(z.r, 4);
        expect(colors[i + 2], id).toBeCloseTo(z.b, 4);
      }
    }
  });

  it('dims a napping works and floats its "z z" above its top, at every level', () => {
    const scene = new Scene(engine);
    for (const id of WORKS) {
      for (const l of [1, 4]) {
        const awake = buildBuildingModel(scene, id, 'plain', l).body;
        const { body, glow } = buildBuildingModel(scene, id, 'out', l);
        const brightness = (m: Mesh) => {
          const c = m.getVerticesData(VertexBuffer.ColorKind) ?? [];
          let sum = 0;
          for (let i = 0; i < c.length; i += 4)
            sum += (c[i] ?? 0) + (c[i + 1] ?? 0) + (c[i + 2] ?? 0);
          return sum / Math.max(1, c.length / 4);
        };
        expect(brightness(body), `${id} L${String(l)}`).toBeLessThan(brightness(awake) * 0.9);
        const top = body.getBoundingInfo().boundingBox.maximum.y;
        expect(glow?.getBoundingInfo().boundingBox.minimum.y ?? 0, id).toBeGreaterThan(top);
      }
    }
  });

  it('stays one or two meshes and under the triangle cap at its biggest', () => {
    // Level 4 for the works; one-level buildings (the Seawall, the Canal…) add no
    // detail past L1, so their count is the same.
    const scene = new Scene(engine);
    for (const id of WILD) {
      const before = scene.meshes.length;
      const m = buildBuildingModel(scene, id, 'plain', 4);
      expect(scene.meshes.length - before, id).toBeLessThanOrEqual(2);
      expect(triangles(m), id).toBeLessThanOrEqual(TRIANGLE_CAP);
    }
  });
});
