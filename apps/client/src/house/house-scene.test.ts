import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Scene } from '@babylonjs/core/scene';
import { describe, expect, it, vi } from 'vitest';
import { fitHouse } from './house-camera.js';
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
