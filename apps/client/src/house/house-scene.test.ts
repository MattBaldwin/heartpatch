import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Scene } from '@babylonjs/core/scene';
import { describe, expect, it, vi } from 'vitest';
import { blend, fitHouse, kidPose } from './house-camera.js';
import { HOUSE_GRID, HOUSE_KID } from './house-config.js';
import { sampleHouse } from './house-fixtures.js';
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
      for (const room of rooms) {
        expect(scene.getMeshByName(`house-${room.id}-floor`)).not.toBeNull();
      }
      scene.getEngine().dispose();
    }
  });

  it('takes the open front off the dollhouse and keeps the other walls', () => {
    const { scene } = buildHouse(1, 'low');
    expect(scene.getMeshByName('house-snug-wall-south')).toBeNull();
    expect(scene.getMeshByName('house-snug-wall-front')!.isEnabled()).toBe(false);
    for (const side of ['north', 'east', 'west'])
      expect(scene.getMeshByName(`house-snug-wall-${side}`)).not.toBeNull();
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
