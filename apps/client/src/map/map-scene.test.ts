import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { hexToWorld, type MapView } from '@heartpatch/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { HEX_SIZE, type PropKind } from './map-config.js';
import { findHomeBases } from './map-layout.js';
import { buildProp, MapScene, type MapSceneOptions } from './map-scene.js';
import { testView, userId } from './test-view.js';

describe('MapScene', () => {
  const engine = new NullEngine({
    renderWidth: 400,
    renderHeight: 800,
    textureSize: 1,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  afterEach(() => {
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  function build(view: MapView = testView(1), options: MapSceneOptions = {}) {
    const scene = new Scene(engine);
    const map = new MapScene(scene, view, options);
    const mesh = (name: string) => scene.getMeshByName(name) as Mesh | null;
    const instances = (name: string) => {
      const m = mesh(name);
      return m?.isEnabled() ? m.thinInstanceCount : 0;
    };
    return { scene, map, mesh, instances };
  }

  it('draws every tile with one instanced mesh per terrain look', () => {
    const { scene, map } = build();
    const tileMeshes = scene.meshes.filter((m) => m.name.startsWith('tiles-')) as Mesh[];
    expect(map.stats.tiles).toBe(469);
    expect(tileMeshes).toHaveLength(map.stats.tileMeshes);
    // 8 terrains plus home tiles, however many tiles there are.
    expect(tileMeshes.length).toBeLessThanOrEqual(9);
    expect(tileMeshes.reduce((n, m) => n + m.thinInstanceCount, 0)).toBe(469);
    expect(scene.getMeshByName('tiles-home')).toBeTruthy();
  });

  it('keeps the whole map to a few dozen meshes (draw calls)', () => {
    // About 30 before the terrain visual pass; its props, motes and backdrop
    // add one each per kind, however many tiles.
    for (const halloween of [false, true]) {
      const { scene } = build(testView(4), { halloween });
      expect(scene.meshes.filter((m) => m.isEnabled()).length).toBeLessThan(55);
    }
  });

  it('keeps the triangles drawn near what the map drew before its dressing', () => {
    // About 570k on this 4-player map before the terrain visual pass; small
    // parts use few segments so twice the props cost about a fifth more.
    for (const halloween of [false, true]) {
      const { scene } = build(testView(4), { halloween });
      let triangles = 0;
      for (const m of scene.meshes as Mesh[]) {
        if (!m.isEnabled()) continue;
        triangles += (m.getTotalIndices() / 3) * (m.hasThinInstances ? m.thinInstanceCount : 1);
      }
      expect(triangles).toBeLessThan(720_000);
    }
  });

  it('starts still under reduced motion and off on the low tier, before any frame', () => {
    expect(build(testView(1), { reducedMotion: true }).map.stats).toMatchObject({
      ambient: 'still',
      motes: { sparkles: expect.any(Number) as number },
    });
    expect(build(testView(1), { reducedMotion: true }).map.stats.motes.pollen).toBeUndefined();
    expect(build(testView(1), { tier: 'low' }).map.stats).toMatchObject({
      ambient: 'off',
      motes: {},
    });
  });

  it('dresses the map with many kinds of prop, one mesh per kind', () => {
    const { scene, map } = build();
    expect(map.stats.props).toBeGreaterThan(1000);
    expect(map.stats.propKinds).toBeGreaterThanOrEqual(18);
    for (const kind of ['flowers', 'grass', 'lily-pad', 'reeds', 'pine', 'snow-peak', 'crystal']) {
      const mesh = scene.getMeshByName(kind) as Mesh | null;
      expect(mesh?.thinInstanceCount ?? 0, kind).toBeGreaterThan(0);
    }
  });

  it('builds every prop kind (the battle arenas use these too)', () => {
    const scene = new Scene(engine);
    const kinds: PropKind[] = [
      'tree',
      'old-tree',
      'rock',
      'peak',
      'pumpkin',
      'pine',
      'tall-tree',
      'stump',
      'log',
      'bush',
      'grass',
      'flowers',
      'mushroom',
      'lily-pad',
      'reeds',
      'stones',
      'dock',
      'snow-peak',
      'crystal',
      'hay-bale',
      'jack-o-lantern',
    ];
    for (const kind of kinds) {
      const { mesh, shadow } = buildProp(scene, kind);
      expect(mesh.getTotalVertices(), kind).toBeGreaterThan(0);
      expect(shadow, kind).toBeGreaterThanOrEqual(0);
    }
  });

  it('draws wild land muted, and brings the colour back as land is claimed', () => {
    const { map } = build(testView(1));
    const muted = map.stats.mutedTiles;
    const mutedProps = () => map.stats.mutedProps;
    const before = mutedProps();
    // Everything but the home ring and the Gap is wild.
    expect(muted).toBe(469 - 7 - 7);
    expect(before).toBeGreaterThan(0);
    // Someone claims a forest tile: it and its trees come back in colour.
    const view = testView(1);
    const forest = view.tiles.find((t) => t.terrain === 'forest' && t.homeSlot === null)!;
    const claimed = {
      ...view,
      tiles: view.tiles.map((t) => (t === forest ? { ...t, ownerUserId: userId(1) } : t)),
    };
    map.update(claimed);
    expect(map.stats.mutedTiles).toBe(muted - 1);
    expect(mutedProps()).toBeLessThan(before);
    // Lost again: muted again.
    map.update(testView(1));
    expect(map.stats.mutedTiles).toBe(muted);
    expect(mutedProps()).toBe(before);
  });

  it("dresses for Halloween only while it's on", () => {
    const off = build(testView(1), { halloween: false });
    expect(off.map.stats.halloween).toBe(false);
    expect(off.mesh('jack-o-lantern')).toBeNull();
    expect(off.map.stats.motes.bats ?? 0).toBe(0);
    expect(off.map.stats.motes.fog ?? 0).toBe(0);

    const on = build(testView(1), { halloween: true });
    expect(on.map.stats.halloween).toBe(true);
    expect(on.instances('jack-o-lantern')).toBeGreaterThan(0);
    expect(on.map.stats.motes.bats ?? 0).toBeGreaterThan(0);
    expect(on.map.stats.motes.fog ?? 0).toBeGreaterThan(0);
  });

  it('swaps daytime motes for fireflies at night', () => {
    const { map } = build();
    expect(map.stats.motes.pollen ?? 0).toBeGreaterThan(0);
    expect(map.stats.motes.fireflies ?? 0).toBe(0);
    map.setNight(true);
    expect(map.stats).toMatchObject({ night: true });
    expect(map.stats.motes.pollen ?? 0).toBe(0);
    expect(map.stats.motes.fireflies ?? 0).toBeGreaterThan(0);
  });

  it('runs ambient life by tier and reduced motion, asking for frames only while live', () => {
    const { map } = build();
    expect(map.setAmbient('high', false)).toBe(false);
    expect(map.stats.ambient).toBe('live');
    expect(map.tick(1000)).toBe(true);

    // Reduced motion: still. Nothing drifts and nothing asks for frames.
    expect(map.setAmbient('high', true)).toBe(true);
    expect(map.stats.ambient).toBe('still');
    expect(map.stats.motes.pollen ?? 0).toBe(0);
    expect(map.tick(2000)).toBe(false);

    // Medium: live with fewer motes; low: off, no motes at all.
    map.setAmbient('high', false);
    const all = map.stats.motes.pollen ?? 0;
    map.setAmbient('medium', false);
    expect(map.stats.motes.pollen ?? 0).toBeLessThan(all);
    map.setAmbient('low', false);
    expect(map.stats.ambient).toBe('off');
    expect(Object.keys(map.stats.motes)).toEqual([]);
    expect(map.tick(3000)).toBe(false);
  });

  it('tints each player’s land in their slot colour', () => {
    const { map, instances } = build(testView(1));
    expect(map.stats.tinted).toBe(7);
    expect(instances('tint-0')).toBe(7);

    map.update(testView(2));
    expect(map.stats.tinted).toBe(14);
    expect(instances('tint-0')).toBe(7);
    expect(instances('tint-1')).toBe(7);
  });

  it('clears a leaver’s tint when their land goes wild', () => {
    const { map, instances } = build(testView(2));
    map.update(testView(1));
    expect(map.stats.tinted).toBe(7);
    expect(instances('tint-1')).toBe(0);
  });

  it('leaves tiles owned by someone outside the member list untinted', () => {
    const view = testView(1);
    const stray = {
      ...view,
      tiles: view.tiles.map((t) => (t.homeSlot === 2 ? { ...t, ownerUserId: userId(7) } : t)),
    };
    const { map } = build(stray);
    expect(map.stats.tinted).toBe(7);
  });

  it('marks claimed home bases with a Heart Seed and free ones with an empty plot', () => {
    const { map, instances } = build(testView(1));
    expect(map.stats).toMatchObject({ homes: 4, claimedHomes: 1 });
    expect(instances('heart-seed')).toBe(1);
    expect(instances('home-plot')).toBe(3);
    map.update(testView(4));
    expect(instances('heart-seed')).toBe(4);
    expect(instances('home-plot')).toBe(0);
  });

  it('stands each member’s Keeper by their Heart Seed, and only theirs', () => {
    const { scene, map } = build(testView(1));
    expect(map.stats.keepers).toBe(1);
    map.update(testView(3));
    expect(map.stats.keepers).toBe(3);
    // A member who hasn't picked one (the gate switched off) shows no Keeper.
    const view = testView(3);
    const noKeeper = {
      ...view,
      members: view.members.map((m, i) => (i === 1 ? { ...m, keeper: null } : m)),
    };
    map.update(noKeeper);
    expect(map.stats.keepers).toBe(2);
    map.update(testView(1));
    expect(map.stats.keepers).toBe(1);
    // Instanced: Keepers share a handful of meshes, however many there are.
    const keeperMeshes = scene.meshes.filter((m) => m.name.startsWith('keeper-'));
    expect(keeperMeshes.length).toBeLessThanOrEqual(5);
  });

  it('starts the camera at my Heart Seed, or the centre for a visitor', () => {
    const view = testView(2);
    const { map } = build(view);
    const seed = findHomeBases(view.tiles).find((h) => h.slot === 1)!.seed;
    expect(map.homeOf(view, userId(2))).toEqual(hexToWorld(seed, HEX_SIZE));
    expect(map.homeOf(view, null)).toEqual({ x: 0, z: 0 });
  });

  it('picks the tile under a screen point', () => {
    const view = testView(1);
    const { scene, map } = build(view);
    const seed = findHomeBases(view.tiles)[0]!.seed;
    const p = hexToWorld(seed, HEX_SIZE);
    const camera = new TargetCamera('cam', new Vector3(p.x, 12, p.z - 6), scene);
    camera.setTarget(new Vector3(p.x, 0.27, p.z));
    scene.activeCamera = camera;
    const picked = map.pick(200, 400);
    expect(picked).toMatchObject({ q: seed.q, r: seed.r });
    // Looking at the sky (top edge, far off the island) picks nothing.
    camera.setTarget(new Vector3(p.x, 12, p.z + 50));
    expect(map.pick(200, 0)).toBeNull();
  });

  it('rings the selected tile', () => {
    const view = testView(1);
    const { map, mesh } = build(view);
    map.select(view.tiles[10]!);
    expect(mesh('selection')!.isEnabled()).toBe(true);
    map.select(null);
    expect(mesh('selection')!.isEnabled()).toBe(false);
  });

  it('puts Juniper’s Gap’s tree on the centre tile', () => {
    const { mesh } = build();
    expect(mesh('junipers-gap-tree')).toBeTruthy();
  });
});
