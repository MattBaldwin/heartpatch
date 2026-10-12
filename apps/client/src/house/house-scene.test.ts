import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { describe, expect, it, vi } from 'vitest';
import { blend, fitHouse, kidPose, project, safeArea } from './house-camera.js';
import { HOUSE_GRID, HOUSE_KID } from './house-config.js';
import { sampleHouse, sampleLevels } from './house-fixtures.js';
import { yardPumpkins } from './house-models.js';
import { registerRoom, roomBuilder, type RoomKit } from './house-rooms.js';
import { buildHouse } from './house-test-scene.js';

// NullEngine has no 2D canvas: plain stand-ins for the painted textures.
vi.mock('../procedural/contact-shadow.js', () => ({
  createContactShadowMesh: (scene: Scene) =>
    CreateGround('test-shadow', { width: 1, height: 1 }, scene),
}));
vi.mock('./house-textures.js', async () => {
  const { StandardMaterial } = await import('@babylonjs/core/Materials/standardMaterial');
  return {
    duskPaneMaterial: (scene: Scene) => new StandardMaterial('test-pane', scene),
    signMaterial: (scene: Scene) => new StandardMaterial('test-sign', scene),
    radialTexture: () => null,
  };
});

describe('house scene', () => {
  it('builds every room of the level from its layout', () => {
    for (const level of [1, 2, 3, 4]) {
      const { scene, house } = buildHouse(level, 'low');
      const rooms = sampleHouse(level).view.rooms;
      expect(house.stats.rooms).toBe(rooms.length);
      // Every floor's planks, walls and furniture: one mesh per material per floor (B4).
      for (const floor of new Set(rooms.map((r) => r.layout.floor))) {
        expect(scene.getMeshByName(`house-f${String(floor)}-floor`)).not.toBeNull();
        expect(scene.getMeshByName(`house-f${String(floor)}-solid`)).not.toBeNull();
      }
      scene.getEngine().dispose();
    }
  });

  it('hands room builders the quality tier, so a room can pick lighter parts on low', () => {
    const snug = roomBuilder('snug');
    const seen: RoomKit['tier'][] = [];
    registerRoom('snug', (kit) => {
      seen.push(kit.tier);
      return snug(kit);
    });
    try {
      for (const tier of ['low', 'high'] as const) buildHouse(1, tier).scene.getEngine().dispose();
    } finally {
      registerRoom('snug', snug);
    }
    expect(seen).toEqual(['low', 'high']);
  });

  it('takes the open front off the dollhouse and keeps the other walls, merged into the floor’s solid', () => {
    const { scene } = buildHouse(1, 'low');
    expect(scene.getMeshByName('house-snug-wall-south')).toBeNull();
    expect(scene.getMeshByName('house-snug-wall-front')!.isEnabled()).toBe(false);
    for (const side of ['north', 'east', 'west'])
      expect(scene.getMeshByName(`house-snug-wall-${side}`)).toBeNull();
    // The back wall is there: the solid reaches the back grid line, full height.
    const solid = scene.getMeshByName('house-f0-solid')!;
    solid.computeWorldMatrix(true);
    const box = solid.getBoundingInfo().boundingBox;
    expect(box.maximumWorld.z).toBeGreaterThan(3 * HOUSE_GRID.cell);
    expect(box.maximumWorld.y).toBeGreaterThanOrEqual(HOUSE_GRID.storey);
    scene.getEngine().dispose();
  });

  it('puts residents in their rooms and leaves out one that is away', () => {
    const sample = sampleHouse(1);
    const { scene, house } = buildHouse(1, 'low', sample);
    expect(house.stats.residents).toBe(2);
    expect(house.stats.keeper).toBe(true);
    scene.getEngine().dispose();

    const away = structuredClone(sample);
    const first = away.view.rooms[0]!.residents[0]!;
    away.view.rooms[0]!.residents[0] = { ...first, away: 'gathering' };
    const again = buildHouse(1, 'low', away);
    expect(again.house.stats.residents).toBe(1);
    again.scene.getEngine().dispose();
  });

  it('draws the Keeper by the fire even when the beds are empty (residents land in PR C)', () => {
    const { scene, house } = buildHouse(1, 'low', sampleHouse(1, false));
    expect(house.stats.residents).toBe(0);
    expect(house.stats.keeper).toBe(true);
    scene.getEngine().dispose();
  });

  it('lights by tier: shadows and four lights on high, two lights and none on low', () => {
    const high = buildHouse(1, 'high');
    expect(high.house.stats.shadowMap).toBe(true);
    expect(high.house.stats.lights).toBe(4);
    high.scene.getEngine().dispose();
    const low = buildHouse(1, 'low');
    expect(low.house.stats.shadowMap).toBe(false);
    expect(low.house.stats.lights).toBe(2);
    low.scene.getEngine().dispose();
  });

  it('keeps squishies’ own colours: the fill lights only them, the warm lights leave them out', () => {
    const { scene } = buildHouse(1, 'high');
    scene.render();
    const fill = scene.getLightByName('house-fill')!;
    const cast = scene.meshes.filter((m) => /^squishy-(?!.*shadow)/.test(m.name));
    expect(cast.length).toBeGreaterThan(0);
    for (const m of cast) expect(fill.includedOnlyMeshes).toContain(m);
    expect(fill.includedOnlyMeshes.some((m) => m.name.startsWith('house-'))).toBe(false);
    for (const light of scene.lights) {
      if (light === fill || !light.isEnabled()) continue;
      for (const m of cast) expect(light.excludedMeshes).toContain(m);
    }
    scene.getEngine().dispose();
  });

  it('draws nothing by itself: no animations run while it sits idle', () => {
    const { scene, house } = buildHouse(1, 'high');
    house.setPose(fitHouse(house.bounds, { width: 390, height: 844, top: 80, bottom: 90 }));
    scene.render();
    expect(scene.animatables).toHaveLength(0);
    scene.getEngine().dispose();
  });

  it('shows the name sign in the dollhouse: enabled, in view, in front of the back wall', () => {
    const { scene, house } = buildHouse(1, 'high');
    house.setPose(fitHouse(house.bounds, { width: 390, height: 844, top: 80, bottom: 90 }));
    scene.render();
    // Unlit materials never get ready on a NullEngine, so place every mesh by hand.
    for (const m of scene.meshes) m.computeWorldMatrix(true);
    const sign = scene.getMeshByName('house-sign')!;
    expect(sign.isEnabled()).toBe(true);
    expect(sign.isInFrustum(scene.frustumPlanes)).toBe(true);
    // Its whole box stands clear of the back wall's inside face (it was inside the wall, PR B1).
    const room = sampleHouse(1).view.rooms[0]!;
    const backInside = (room.layout.gy + room.layout.d) * HOUSE_GRID.cell - HOUSE_GRID.wall / 2;
    const box = sign.getBoundingInfo().boundingBox;
    expect(box.maximumWorld.z).toBeLessThan(backInside);
    // And nothing of the room stands in front of it: the front is open, only the cut lip.
    expect(box.minimumWorld.y).toBeGreaterThan(HOUSE_GRID.cut);
    scene.getEngine().dispose();
  });

  it('puts the Heart Seed keepsake on the mantel as glossy vinyl, not a flat glow', () => {
    const { scene } = buildHouse(1, 'low');
    const seeds = scene.getMeshByName('house-heart-seeds')!;
    expect(seeds.isEnabled()).toBe(true);
    expect(seeds.material?.name).toBe('heart-seed-mat');
    scene.getEngine().dispose();
  });

  it('has no front walls in the dollhouse, veils them on the way in and takes them away at kid height', () => {
    const { scene, house } = buildHouse(1, 'low');
    const vp = { width: 390, height: 844, top: 80, bottom: 150 };
    const front = scene.getMeshByName('house-snug-wall-front')!;
    const porch = scene.getMeshByName('house-snug-porch')!;
    house.setPose(fitHouse(house.bounds, vp), 0);
    expect(front.isEnabled()).toBe(false);
    expect(porch.isEnabled()).toBe(false);
    expect(house.stats.frontWallAlpha).toBeNull();
    // Passing the wall on the way in: a faint veil.
    const doll = fitHouse(house.bounds, vp);
    const kid = kidPose(house.focusRoom!, vp);
    house.setPose(blend(doll, kid, 0.75), 0.75);
    expect(front.isEnabled()).toBe(true);
    expect(house.stats.frontWallAlpha!).toBeGreaterThan(0);
    expect(house.stats.frontWallAlpha!).toBeLessThanOrEqual(HOUSE_KID.fadedAlpha);
    // Standing in the room: gone, not drawn at all (no seams through the squishies).
    house.setPose(kid, 1);
    expect(front.isEnabled()).toBe(false);
    expect(porch.isEnabled()).toBe(true);
    expect(house.stats.frontWallAlpha).toBe(0);
    scene.getEngine().dispose();
  });

  it('turns on only the focus room’s extras at kid height in a house of many rooms', () => {
    const vp = { width: 390, height: 844, top: 80, bottom: 150 };
    const { scene, house } = buildHouse(3, 'low');
    expect(house.stats.rooms).toBe(3);
    house.setPose(kidPose(house.focusRoom!, vp), 1);
    // Kid height walks in on the ground floor: only its rooms have a ceiling to show.
    expect(scene.getMeshByName('house-kitchen-ceiling')).toBeNull();
    expect(scene.getMeshByName('house-playroom-ceiling')?.isEnabled()).toBe(false);
    const extras = scene.meshes
      .filter((m) => /^house-.*-(porch|ceiling|ceiling-glow|wall-front)$/.test(m.name))
      .filter((m) => m.isEnabled())
      .map((m) => m.name);
    // The Snug's beamed ceiling stands in for the Kitchen's floor the cut took away.
    expect(extras).toEqual(['house-snug-porch', 'house-snug-ceiling']);
    scene.getEngine().dispose();
  });

  it('shows the yard pumpkins in the dollhouse and keeps them out of the kid-height frame', () => {
    const viewports = {
      iPhone: { width: 390, height: 844, top: 80, bottom: 150 },
      iPad: { width: 820, height: 1180, top: 70, bottom: 90 },
    };
    for (const level of sampleLevels()) {
      const { scene, house } = buildHouse(level, 'low');
      const b = house.bounds;
      for (const [device, vp] of Object.entries(viewports)) {
        const aspect = vp.width / vp.height;
        const doll = fitHouse(b, vp);
        const kid = kidPose(house.focusRoom!, vp);
        const safe = safeArea(vp);
        for (const pumpkin of yardPumpkins(b.minX, b.maxX, b.minZ)) {
          const at = `level ${String(level)} ${device} pumpkin x ${pumpkin.at[0].toFixed(2)}`;
          const [x, y, z] = pumpkin.at;
          const r = pumpkin.d / 2;
          // The dollhouse: the whole pumpkin inside the safe area (clear of the HUD).
          for (const p of [
            { x: x - r, y, z },
            { x: x + r, y, z },
            { x, y: y + r, z: z - r },
            { x, y: y - r, z: z + r },
          ]) {
            const q = project(doll, aspect, p);
            expect(q.x, at).toBeGreaterThan(safe.left);
            expect(q.x, at).toBeLessThan(safe.right);
            expect(q.y, at).toBeLessThan(safe.top);
            expect(q.y, at).toBeGreaterThan(safe.bottom);
          }
          // Kid height: its inner edge (a whole diameter in, to be safe) still past the side.
          const edge = x < kid.eye.x ? x + pumpkin.d : x - pumpkin.d;
          const q = project(kid, aspect, { x: edge, y, z });
          expect(Math.abs(q.x), at).toBeGreaterThan(1);
        }
      }
      scene.getEngine().dispose();
    }
  });

  it('draws the nearest residents smooth on the low tier from frontFrom on, none extra on high', () => {
    const vp = { width: 390, height: 844, top: 80, bottom: 150 };
    const low = buildHouse(1, 'low');
    const doll = fitHouse(low.house.bounds, vp);
    const kid = kidPose(low.house.focusRoom!, vp);
    low.house.setPose(doll, 0);
    expect(low.house.stats.heroes).toBe(0);
    low.house.setPose(blend(doll, kid, HOUSE_KID.frontFrom), HOUSE_KID.frontFrom);
    expect(low.house.stats.heroes).toBe(2);
    expect(low.house.stats.residents).toBe(2);
    low.house.setPose(doll, 0);
    expect(low.house.stats.heroes).toBe(0);
    low.scene.getEngine().dispose();
    const high = buildHouse(1, 'high');
    high.house.setPose(kidPose(high.house.focusRoom!, vp), 1);
    expect(high.house.stats.heroes).toBe(0);
    high.scene.getEngine().dispose();
  });

  describe('the floor cut (B4)', () => {
    const enabled = (scene: Scene, re: RegExp) =>
      scene.meshes.filter((m) => re.test(m.name) && m.isEnabled() && m.getTotalIndices() > 0);

    for (const level of [3, 4]) {
      it(`level ${String(level)}: the ground floor draws nothing of upstairs, and the Keeper's room is open`, () => {
        const { scene, house } = buildHouse(level, 'low');
        house.setRoof(1);
        expect(house.floors).toEqual([0, 1]);
        expect(house.floor).toBe(0);
        expect(house.stats.floor).toBe(0);
        expect(enabled(scene, /^house-(f1-|glow-f1)/)).toEqual([]);
        expect(enabled(scene, /^house-kitchen-/)).toEqual([]);
        expect(scene.getMeshByName('house-f0-solid')!.isEnabled()).toBe(true);
        // The Kitchen's two residents aren't drawn; the Keeper and the rest are.
        const all = sampleHouse(level).view.rooms.flatMap((r) => r.residents).length;
        expect(house.stats.residents).toBe(all - 2);
        expect(house.stats.keeper).toBe(true);
        // Its two beds aren't drawn either (thin instances, one per bed).
        const beds = scene.getMeshByName('house-beds') as Mesh;
        const allBeds = sampleHouse(level).view.rooms.reduce((n, r) => n + r.beds, 0);
        expect(beds.thinInstanceCount).toBe(allBeds - 2);
        scene.getEngine().dispose();
      });

      it(`level ${String(level)}: upstairs keeps the ground floor and the Hall's glow, and leaves out who's under the Kitchen`, () => {
        const { scene, house } = buildHouse(level, 'high');
        house.setRoof(1);
        house.setFloor(1);
        expect(house.floor).toBe(1);
        for (const name of ['house-f0-solid', 'house-f0-floor', 'house-f1-solid', 'house-f1-floor'])
          expect(scene.getMeshByName(name)!.isEnabled(), name).toBe(true);
        if (level === 4) expect(scene.getMeshByName('house-glow-f0')!.isEnabled()).toBe(true);
        // Every bed is back.
        const beds = scene.getMeshByName('house-beds') as Mesh;
        const allBeds = sampleHouse(level).view.rooms.reduce((n, r) => n + r.beds, 0);
        expect(beds.thinInstanceCount).toBe(allBeds);
        // The Snug's two and the Keeper sit under the Kitchen's floor: not drawn.
        const all = sampleHouse(level).view.rooms.flatMap((r) => r.residents).length;
        expect(house.stats.residents).toBe(all - 2);
        expect(house.stats.keeper).toBe(false);
        // And back down: as before.
        house.setFloor(0);
        expect(enabled(scene, /^house-(f1-|glow-f1)/)).toEqual([]);
        expect(house.stats.keeper).toBe(true);
        scene.getEngine().dispose();
      });
    }

    it('fades upstairs away with the roof in the entry glide', () => {
      const { scene, house } = buildHouse(4, 'low');
      const upstairs = scene.getMeshByName('house-f1-solid')!;
      house.setRoof(0.3);
      expect(upstairs.isEnabled()).toBe(true);
      expect(upstairs.visibility).toBeCloseTo(0.7);
      house.setRoof(1);
      expect(upstairs.isEnabled()).toBe(false);
      scene.getEngine().dispose();
    });

    it('fits the shown floor: level 3’s ground floor is one storey tall, upstairs the whole house', () => {
      const { scene, house } = buildHouse(3, 'low');
      expect(house.frameBounds.maxY).toBe(HOUSE_GRID.storey);
      house.setFloor(1);
      expect(house.frameBounds).toEqual(house.bounds);
      scene.getEngine().dispose();
    });

    it('has one floor and no switch below level 3', () => {
      for (const level of [1, 2]) {
        const { scene, house } = buildHouse(level, 'low');
        expect(house.floors).toEqual([0]);
        house.setFloor(1);
        expect(house.floor).toBe(0);
        scene.getEngine().dispose();
      }
    });

    it('stands the sign on the Snug’s low back wall once the Heart Hall is behind it, not in the air', () => {
      const { scene } = buildHouse(4, 'low');
      const sign = scene.getMeshByName('house-sign')!;
      sign.computeWorldMatrix(true);
      const box = sign.getBoundingInfo().boundingBox;
      expect(box.minimumWorld.y).toBeGreaterThan(HOUSE_GRID.cut);
      expect(box.maximumWorld.y).toBeLessThan(HOUSE_GRID.cut + 0.8);
      scene.getEngine().dispose();
    });
  });

  it('lifts the roof away for the entry glide', () => {
    const { scene, house } = buildHouse(1, 'low');
    const roof = scene.getMeshByName('house-roof')!;
    house.setRoof(0);
    expect(roof.isEnabled()).toBe(true);
    house.setRoof(0.5);
    expect(roof.position.y).toBeGreaterThan(0);
    house.setRoof(1);
    expect(roof.isEnabled()).toBe(false);
    expect(house.stats.roof).toBe(1);
    scene.getEngine().dispose();
  });
});
