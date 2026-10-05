import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { hexToWorld, type MapView } from '@heartpatch/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEX_SIZE } from './map-config.js';
import { findHomeBases } from './map-layout.js';
import { MapScene, tileScreenRectOf } from './map-scene.js';
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

  function build(view: MapView = testView(1)) {
    const scene = new Scene(engine);
    const map = new MapScene(scene, view);
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
    const { scene } = build(testView(4));
    expect(scene.meshes.filter((m) => m.isEnabled()).length).toBeLessThan(30);
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
  it('projects a tile to the screen for DOM overlays, and nothing behind the camera', () => {
    const { scene } = build();
    const view = testView(1);
    const middle = view.tiles.find((t) => t.q === 0 && t.r === 0)!;
    const camera = new TargetCamera('test', new Vector3(0, 40, -40), scene);
    camera.setTarget(Vector3.Zero());
    scene.activeCamera = camera;
    // NullEngine has no canvas: give it a phone-sized box to project onto.
    const box = { left: 0, top: 0, width: 400, height: 800 };
    vi.spyOn(scene.getEngine(), 'getRenderingCanvas').mockReturnValue({
      getBoundingClientRect: () => box,
    } as unknown as HTMLCanvasElement);
    scene.render();
    const rect = tileScreenRectOf(scene, middle);
    expect(rect).not.toBeNull();
    expect(rect!.width).toBeGreaterThan(0);
    // The middle tile under a camera looking at the middle sits mid-screen.
    expect(rect!.x + rect!.width / 2).toBeCloseTo(200, 0);
    camera.position = new Vector3(0, 40, 40);
    camera.setTarget(new Vector3(0, 40, 80));
    scene.render();
    expect(tileScreenRectOf(scene, middle)).toBeNull();
  });
});
