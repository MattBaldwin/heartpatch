import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { hexToWorld, type MapView } from '@heartpatch/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BORDER, HEX_SIZE, MAP_DETAIL, type PropKind } from './map-config.js';
import { findHomeBases } from './map-layout.js';
import {
  buildProp,
  homeNodeShown,
  MapScene,
  tileScreenRectOf,
  type MapSceneOptions,
} from './map-scene.js';
import { testPatch, testView, userId } from './test-view.js';
import { wildMarkers } from './wild-markers.js';

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
    // At either detail (#318); the other level's meshes are switched off.
    const tileMeshes = scene.meshes.filter(
      (m) => m.name.startsWith('tiles-') && m.isEnabled(),
    ) as Mesh[];
    expect(map.stats.tiles).toBe(469);
    expect(tileMeshes).toHaveLength(map.stats.tileMeshes);
    // 9 terrains (trading posts too, #269) plus home tiles, however many tiles there are.
    expect(tileMeshes.length).toBeLessThanOrEqual(10);
    expect(scene.getMeshByName('tiles-trading-post')).toBeTruthy();
    expect(tileMeshes.reduce((n, m) => n + m.thinInstanceCount, 0)).toBe(469);
    expect(scene.getMeshByName('tiles-home')).toBeTruthy();
  });

  it('draws every wild-squishy tuft from one instanced mesh, swaying on the terrain clock (#209)', () => {
    const view = testView(1);
    const { scene, map, mesh, instances } = build(view);
    expect(instances('wild-tuft')).toBe(0);
    expect(mesh('wild-tuft')?.isEnabled()).toBe(false);
    const tiles = new Map(view.tiles.map((t) => [`${String(t.q)},${String(t.r)}`, t]));
    const hints = view.tiles.slice(0, 12).map(({ q, r }) => ({ q, r }));
    const before = scene.meshes.length;

    map.setWild(wildMarkers(hints, (key) => tiles.get(key)));
    expect(instances('wild-tuft')).toBe(12);
    expect(map.stats.wildMarkers).toBe(12);
    expect(scene.meshes.length).toBe(before);
    // Each tuft sways in the map's breeze: the terrain plugin's sway turns on
    // for a mesh with per-instance `terrainAmbient` (terrain-plugin.ts).
    expect(mesh('wild-tuft')!.isVerticesDataPresent('terrainAmbient')).toBe(true);

    // Fewer, then none: same mesh, nothing left over.
    map.setWild(wildMarkers(hints.slice(0, 3), (key) => tiles.get(key)));
    expect(instances('wild-tuft')).toBe(3);
    map.setWild([]);
    expect(instances('wild-tuft')).toBe(0);
    expect(map.stats.wildMarkers).toBe(0);
    expect(scene.meshes.length).toBe(before);
  });

  it('keeps the whole map to a few dozen meshes (draw calls)', () => {
    // About 30 before the terrain visual pass; its props, motes and backdrop
    // add one each per kind, however many tiles.
    for (const halloween of [false, true]) {
      const { scene } = build(testView(4), { halloween });
      // Trading posts (#269) add two: their tile look and the hut.
      expect(scene.meshes.filter((m) => m.isEnabled()).length).toBeLessThan(57);
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

  it('swaps to low-detail tiles and props when zoomed out, with the same draw calls (#318)', () => {
    const { scene, map } = build(testView(4));
    const camera = new TargetCamera('cam', new Vector3(0, 17, -10), scene);
    camera.setTarget(Vector3.Zero());
    scene.activeCamera = camera;
    const enabled = () => scene.meshes.filter((m) => m.isEnabled()) as Mesh[];
    const triangles = () =>
      enabled().reduce(
        (n, m) => n + (m.getTotalIndices() / 3) * (m.hasThinInstances ? m.thinInstanceCount : 1),
        0,
      );
    const at = (height: number) => {
      camera.position.y = height;
      scene.render();
      return map.stats.detail;
    };
    expect(map.stats.detail).toBe('near');
    expect(at(17)).toBe('near');
    const near = { meshes: enabled().length, triangles: triangles() };
    expect(scene.getMeshByName('prop-shadows')?.isEnabled()).toBe(true);

    // Zoomed out: every tile look and prop kind swaps mesh for mesh, the
    // speck-sized contact shadows go, and about half the triangles are left.
    expect(at(32)).toBe('far');
    expect(enabled()).toHaveLength(near.meshes - 1);
    expect(scene.getMeshByName('prop-shadows')?.isEnabled()).toBe(false);
    expect(scene.getMeshByName('tiles-meadow-far')?.isEnabled()).toBe(true);
    expect(scene.getMeshByName('tiles-meadow')?.isEnabled()).toBe(false);
    expect(triangles()).toBeLessThan(near.triangles * 0.6);
    expect(map.stats.props).toBeGreaterThan(1000); // the same props, drawn simpler

    // A pinch hovering near the switch doesn't flicker it.
    expect(at(MAP_DETAIL.farHeight - 1)).toBe('far');
    expect(at(MAP_DETAIL.farHeight - MAP_DETAIL.hysteresis - 0.5)).toBe('near');
    expect(at(MAP_DETAIL.farHeight + 1)).toBe('near');
    expect(at(MAP_DETAIL.farHeight + MAP_DETAIL.hysteresis + 0.5)).toBe('far');
    expect(map.stats.drawCalls).toBeGreaterThanOrEqual(0);
    expect(map.stats.activeTriangles).toBeGreaterThan(0);
  });

  it('mutes both detail levels together when land changes hands (#318)', () => {
    const view = testView(1);
    const { mesh, map } = build(view);
    const colors = (name: string) => mesh(name)?.getVerticesData('color');
    const tile = view.tiles.find((t) => t.ownerUserId === null && t.terrain === 'meadow')!;
    map.update({
      ...view,
      tiles: view.tiles.map((t) => (t === tile ? { ...t, ownerUserId: userId(1) } : t)),
    });
    expect(colors('tiles-meadow-far')).toEqual(colors('tiles-meadow'));
  });

  it('draws fence segments with one instanced mesh per look and level, in budget', () => {
    // Every home tile of a 4-player map fenced on all six edges, every look
    // and level in turn: far more fence than a real map carries.
    const looks = [
      'hedge',
      'moat',
      'stone-wall',
      'emberwood-palisade',
      'glimmer-rail',
      'lantern-fence',
      'bramble-hedge',
      'ice-wall',
    ];
    let n = 0;
    const base = testView(4);
    const view: MapView = {
      ...base,
      tiles: base.tiles.map((t) =>
        t.ownerUserId === null
          ? t
          : {
              ...t,
              fences: [0, 1, 2, 3, 4, 5].map((edge) => {
                n++;
                return {
                  id: `0190a8c4-0000-7000-8000-${String(n).padStart(12, '0')}`,
                  edge,
                  buildingId: looks[n % looks.length] ?? 'hedge',
                  level: (n % 3) + 1,
                  hp: 70,
                  maxHp: 70,
                };
              }),
            },
      ),
    };
    const { scene, map } = build(view);
    expect(n).toBeGreaterThan(24);
    expect(map.stats.fences).toBe(n);
    const fenceMeshes = scene.meshes.filter((m) => m.name.startsWith('fence-')) as Mesh[];
    expect(fenceMeshes.length).toBeLessThanOrEqual(24);
    expect(fenceMeshes.reduce((sum, m) => sum + m.thinInstanceCount, 0)).toBe(n);
    // Fences have their own budget on top of the map's: a few hundred
    // triangles a segment, so even this much fence costs under 50k.
    const triangles = fenceMeshes.reduce(
      (sum, m) => sum + (m.getTotalIndices() / 3) * m.thinInstanceCount,
      0,
    );
    expect(triangles).toBeLessThan(50_000);
    // Taking them all down clears every segment.
    map.update(base);
    expect(map.stats.fences).toBe(0);
    expect(fenceMeshes.reduce((sum, m) => sum + m.thinInstanceCount, 0)).toBe(0);
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
    // Everything but the home ring, the Gap and the 4 trading posts (#269) is wild.
    expect(muted).toBe(469 - 7 - 7 - 4);
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

  it('draws each player’s land in their slot colour, one border mesh each (#278)', () => {
    const { map, mesh } = build(testView(1));
    expect(map.stats).toMatchObject({ tinted: 7, borderMeshes: 1 });
    expect(mesh('border-0')?.isEnabled()).toBe(true);

    map.update(testView(2));
    expect(map.stats).toMatchObject({ tinted: 14, borderMeshes: 2 });
    expect(mesh('border-1')?.isEnabled()).toBe(true);
  });

  it('clears a leaver’s border when their land goes wild', () => {
    const { map, mesh } = build(testView(2));
    map.update(testView(1));
    expect(map.stats).toMatchObject({ tinted: 7, borderMeshes: 1 });
    expect(mesh('border-1')?.isEnabled()).toBe(false);
  });

  it('leaves tiles owned by someone outside the member list uncoloured', () => {
    const view = testView(1);
    const stray = {
      ...view,
      tiles: view.tiles.map((t) => (t.homeSlot === 2 ? { ...t, ownerUserId: userId(7) } : t)),
    };
    const { map } = build(stray);
    expect(map.stats).toMatchObject({ tinted: 7, borderMeshes: 1 });
  });

  it('keeps a busy 4-Keeper patch’s borders to 4 draw calls and about 33k triangles (#278)', () => {
    const view = testPatch();
    const { scene, map } = build(view);
    const owned = view.tiles.filter((t) => t.ownerUserId !== null).length;
    expect(owned).toBeGreaterThan(200);
    expect(map.stats.tinted).toBe(owned);
    const borders = scene.meshes.filter((m) => m.name.startsWith('border-') && m.isEnabled());
    expect(borders).toHaveLength(4);
    expect(map.stats.borderMeshes).toBe(4);
    // About 34k: one mesh each, never per tile, following the tile's top
    // closely enough to clear a lake's waves. The per-tile tint it replaced
    // drew 216 a tile (47.5k on this patch).
    expect(map.stats.borderTriangles).toBeLessThan(35_000);
    expect(map.stats.borderTriangles).toBeGreaterThan(20_000);
  });

  it('rebuilds only the borders whose land changed', () => {
    const view = testPatch();
    const { map, mesh } = build(view);
    const before = [0, 1, 2, 3].map((s) =>
      mesh(`border-${String(s)}`)?.getVerticesData('position'),
    );
    // Bramble (slot 1) loses a tile to the wild; nobody else's land changes.
    const lost = view.tiles.find((t) => t.ownerUserId === userId(2) && t.homeSlot === null);
    map.update({
      ...view,
      tiles: view.tiles.map((t) => (t === lost ? { ...t, ownerUserId: null } : t)),
    });
    const after = [0, 1, 2, 3].map((s) => mesh(`border-${String(s)}`)?.getVerticesData('position'));
    expect(after[1]).not.toBe(before[1]);
    for (const s of [0, 2, 3]) expect(after[s]).toBe(before[s]);
  });

  it('dims the borders at night, so the fire light reads (#277)', () => {
    const { map, mesh } = build(testView(1));
    const material = () => mesh('border-0')?.material as StandardMaterial;
    expect(material().emissiveColor.r).toBe(1);
    map.setNight(true);
    expect(material().emissiveColor.r).toBeCloseTo(1 - BORDER.night);
    map.setNight(false);
    expect(material().emissiveColor.r).toBe(1);
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

describe('homeNodeShown (owner decision 2026-10-06)', () => {
  it('shows year-round nodes always, and seasonal ones only in their season', () => {
    const october = new Set(['halloween']);
    expect(homeNodeShown('timber', new Set())).toBe(true);
    expect(homeNodeShown('pumpkins', october)).toBe(true);
    expect(homeNodeShown('pumpkins', new Set(['thanksgiving']))).toBe(false);
    expect(homeNodeShown('magic-fallen-leaves', october)).toBe(false);
    expect(homeNodeShown('magic-fallen-leaves', new Set(['thanksgiving']))).toBe(true);
  });
});
