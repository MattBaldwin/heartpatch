import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { describe, expect, it, vi } from 'vitest';
import {
  blend,
  boxesMeet,
  chevronBox,
  fitHouse,
  framedFocus,
  kidPose,
  project,
  residentBoxes,
  safeArea,
} from './house-camera.js';
import { HOUSE_GIFT, HOUSE_GRID, HOUSE_KID, HOUSE_PALETTE, HOUSE_TIMES } from './house-config.js';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { fillTilt } from './house-scene.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { sampleHouse, sampleLevels, withGift } from './house-fixtures.js';
import { houseLookAtMinute } from './house-light-look.js';
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
    paneMaterial: (scene: Scene, kind = 'dusk') =>
      scene.getMaterialByName(`test-${kind}-pane`) ??
      new StandardMaterial(`test-${kind}-pane`, scene),
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

    it('cuts the Snug–Playroom wall low with the Hall behind it: no post stands in front of the Hall (render check)', () => {
      const { scene, house } = buildHouse(4, 'low');
      house.setRoof(1);
      const tall = (name: string) => {
        const mesh = scene.getMeshByName(name)!;
        const pos = mesh.getVerticesData('position') ?? [];
        let n = 0;
        for (let i = 0; i < pos.length; i += 3) {
          const [x, y, z] = [pos[i]!, pos[i + 1]!, pos[i + 2]!];
          if (
            Math.abs(x - 3 * HOUSE_GRID.cell) < 0.2 &&
            z > 0.5 &&
            z < 4.5 &&
            y > HOUSE_GRID.cut + 0.2 &&
            y < HOUSE_GRID.storey
          )
            n += 1;
        }
        return n;
      };
      // Downstairs, the partition stops at the cut; its upper part goes with the Kitchen.
      expect(tall('house-f0-solid')).toBe(0);
      expect(tall('house-f1-solid')).toBeGreaterThan(0);
      scene.getEngine().dispose();
    });

    it('keeps upstairs clear of the Hall too: the Kitchen’s side wall over the Playroom is cut low (round 2)', () => {
      const { scene, house } = buildHouse(4, 'low');
      house.setRoof(1);
      house.setFloor(1);
      const mesh = scene.getMeshByName('house-f1-solid')!;
      const pos = mesh.getVerticesData('position') ?? [];
      let top = 0;
      for (let i = 0; i < pos.length; i += 3) {
        const [x, y, z] = [pos[i]!, pos[i + 1]!, pos[i + 2]!];
        if (Math.abs(x - 3 * HOUSE_GRID.cell) < 0.2 && z > 0.5 && z < 4.5) top = Math.max(top, y);
      }
      expect(top).toBeGreaterThan(HOUSE_GRID.storey); // there's a low wall
      expect(top).toBeLessThan(HOUSE_GRID.storey + HOUSE_GRID.cut + 0.2);
      // Every Hall resident drawn upstairs.
      expect(house.residentSpots.length).toBe(house.stats.residents);
      scene.getEngine().dispose();
    });

    it('caps an inside wall’s end at the open front in dark wood, not a plaster stub (B5a)', () => {
      const { scene } = buildHouse(2, 'low');
      const mesh = scene.getMeshByName('house-f0-solid')!;
      const pos = mesh.getVerticesData('position') ?? [];
      const colors = mesh.getVerticesData('color') ?? [];
      const cap = Color3.FromHexString(HOUSE_PALETTE.cap).toLinearSpace();
      const ys: number[] = [];
      for (let i = 0; i < pos.length / 3; i++) {
        const [x, y, z] = [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
        const dark =
          Math.abs(colors[i * 4]! - cap.r) < 0.01 && Math.abs(colors[i * 4 + 1]! - cap.g) < 0.01;
        // The partition between the Snug and the Playroom, just in front of its front end (z 0),
        // past the top edge's own cap (which reaches 2 cm out).
        if (dark && Math.abs(x - 3 * HOUSE_GRID.cell) < 0.2 && z < -0.03 && z > -0.05) ys.push(y);
      }
      expect(Math.min(...ys)).toBeLessThan(0.05);
      expect(Math.max(...ys)).toBeGreaterThan(HOUSE_GRID.storey);
      scene.getEngine().dispose();
    });

    it('lays a board just under the floor boards’ tops, so no gap reads as a dark slit (B5a)', () => {
      const { scene } = buildHouse(1, 'low');
      const floor = scene.getMeshByName('house-f0-floor')!;
      floor.computeWorldMatrix(true);
      const pos = floor.getVerticesData('position') ?? [];
      // Boards' tops at 0; the board under them its top a seam's depth down, right across the room.
      const under: number[] = [];
      for (let i = 0; i < pos.length; i += 3) {
        const y = pos[i + 1]!;
        if (Math.abs(y + HOUSE_GRID.seamDepth) < 0.001) under.push(pos[i]!);
      }
      expect(under.length).toBeGreaterThan(0);
      expect(Math.min(...under)).toBeLessThan(0.1);
      expect(Math.max(...under)).toBeGreaterThan(4.7);
      scene.getEngine().dispose();
    });

    it('stands the Snug’s side wall back up at kid height, closing the room in (round 2: the crown showed past it)', () => {
      const { scene } = buildHouse(4, 'low');
      const ceiling = scene.getMeshByName('house-snug-ceiling')!;
      const pos = ceiling.getVerticesData('position') ?? [];
      let wall = 0;
      for (let i = 0; i < pos.length; i += 3) {
        const [x, y] = [pos[i]!, pos[i + 1]!];
        if (Math.abs(x - 3 * HOUSE_GRID.cell) < 0.2 && y > HOUSE_GRID.cut + 0.3 && y < 2.6)
          wall += 1;
      }
      expect(wall).toBeGreaterThan(0);
      scene.getEngine().dispose();
    });

    it('frames a phone so no resident is cut by the screen’s edge, every face seen (round 3)', () => {
      const vp = { width: 390, height: 844, top: 70, bottom: 148, sheet: 68 };
      for (const [level, floor] of [
        [2, 0],
        [3, 0],
        [3, 1],
        [4, 0],
        [4, 1],
      ] as const) {
        const { scene, house } = buildHouse(level, 'high', sampleHouse(level), vp);
        house.setRoof(1);
        house.setFloor(floor);
        const focus = framedFocus(house.frameBounds, vp, house.focusRoom, house.residentSpots);
        house.setPose(fitHouse(house.frameBounds, vp, undefined, focus), 0);
        scene.render();
        for (const m of scene.meshes) m.computeWorldMatrix(true);
        const faces = house.faceReport();
        const at = `level ${String(level)} floor ${String(floor)}`;
        expect(faces.cut, at).toBe(0);
        // Every face in the frame is seen (B5a: a closer phone frame leaves the
        // next room's residents wholly off the edge, a sideways drag away).
        const inFrame = faces.boxes.filter((b) => b.x0 >= 0 && b.x1 <= 1).length;
        expect(inFrame, at).toBeGreaterThanOrEqual(2);
        expect(faces.visible, at).toBe(inFrame);
        // The chevron pills keep off every resident's face (round 4: one sat on the cyan's eye).
        const pose = fitHouse(house.frameBounds, vp, undefined, focus);
        const guess = residentBoxes(pose, vp, house.residentSpots);
        for (const side of ['left', 'right'] as const) {
          const pill = chevronBox(side, vp, guess);
          for (const b of faces.boxes) {
            const drawn = {
              x0: b.x0 * vp.width,
              x1: b.x1 * vp.width,
              y0: b.y0 * vp.height,
              y1: b.y1 * vp.height,
            };
            expect(boxesMeet(pill, drawn), `${at} ${side} pill`).toBe(false);
          }
        }
        scene.getEngine().dispose();
      }
    }, 30_000); // five houses built and drawn: 1.6 s alone, 6.2 s under load (#429)

    it('counts a face hidden when a wall stands in front of it, not just its middle', () => {
      const vp = { width: 390, height: 844 };
      const { scene, house } = buildHouse(4, 'high', sampleHouse(4), vp);
      house.setRoof(1);
      // From behind the Hall's back wall, looking in: every face is behind it.
      house.setPose(
        { eye: { x: 6, y: 1.2, z: 16 }, target: { x: 6, y: 0.6, z: 6 }, fov: 0.9, pitch: 0.06 },
        0,
      );
      scene.render();
      for (const m of scene.meshes) m.computeWorldMatrix(true);
      expect(house.faceReport().visible).toBe(0);
      scene.getEngine().dispose();
    });

    it('hangs the sign on a header over the Snug’s opening at kid height (level 4), back on the low wall outside', () => {
      const vp = { width: 820, height: 1180, top: 70, bottom: 90 };
      const { scene, house } = buildHouse(4, 'low');
      const sign = scene.getMeshByName('house-sign')!;
      house.setPose(kidPose(house.focusRoom!, vp), 1);
      expect(sign.position.y).toBeGreaterThan(HOUSE_GRID.storey - HOUSE_KID.header);
      expect(scene.getMeshByName('house-snug-ceiling')!.isEnabled()).toBe(true);
      house.setPose(fitHouse(house.bounds, vp), 0);
      expect(sign.position.y).toBeLessThan(HOUSE_GRID.cut + 0.6);
      scene.getEngine().dispose();
    });

    it('lights every squishy by the fill, the hero field’s smoother swap included (render check: grey on low)', () => {
      const vp = { width: 390, height: 844, top: 80, bottom: 150 };
      const { scene, house } = buildHouse(1, 'low');
      const doll = fitHouse(house.bounds, vp);
      house.setPose(doll, 0);
      scene.render();
      house.setPose(blend(doll, kidPose(house.focusRoom!, vp), 1), 1);
      scene.render();
      scene.render();
      const fill = scene.getLightByName('house-fill')!;
      const cast = scene.meshes.filter(
        (m) => /^squishy-(?!.*shadow)/.test(m.name) && m.isEnabled(),
      );
      expect(cast.some((m) => m.name.endsWith('-high'))).toBe(true);
      for (const m of cast) expect(fill.includedOnlyMeshes, m.name).toContain(m);
      scene.getEngine().dispose();
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

  describe('the living house (#381 H2)', () => {
    const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      Math.hypot(a.x - b.x, a.z - b.z);

    it('puts the wrapped gift by its giver’s bed, merged into the floor’s furniture', () => {
      for (const tier of ['low', 'high'] as const) {
        const sample = withGift(sampleHouse(2), { room: 'playroom', index: 0 });
        const { scene, house } = buildHouse(2, tier, sample);
        const at = house.giftPoint!;
        expect(at).not.toBeNull();
        const playroom = sample.view.rooms.find((r) => r.id === 'playroom')!;
        const x0 = playroom.layout.gx * HOUSE_GRID.cell;
        const z0 = playroom.layout.gy * HOUSE_GRID.cell;
        // Inside the Playroom, near its back wall where its first bed stands.
        expect(at.x).toBeGreaterThan(x0);
        expect(at.x).toBeLessThan(x0 + playroom.layout.w * HOUSE_GRID.cell);
        expect(at.z).toBeGreaterThan(z0 + (playroom.layout.d * HOUSE_GRID.cell) / 2);
        // No mesh of its own: one draw for the floor's furniture, gift and all.
        expect(scene.meshes.some((m) => /gift/.test(m.name))).toBe(false);
        expect(house.stats.gift).toBe(true);
        scene.getEngine().dispose();
      }
    });

    it('puts it by the hearth when its giver isn’t drawn, clear of the cast', () => {
      const sample = withGift(sampleHouse(1), { away: true });
      const { scene, house } = buildHouse(1, 'low', sample);
      const at = house.giftPoint!;
      const snug = sample.view.rooms[0]!;
      expect(at.x).toBeLessThan((snug.layout.w * HOUSE_GRID.cell) / 2);
      expect(at.z).toBeLessThan((snug.layout.d * HOUSE_GRID.cell) / 2);
      for (const spot of house.residentSpots) expect(dist(at, spot)).toBeGreaterThan(0.6);
      scene.getEngine().dispose();
    });

    it('takes the box away once it’s open, with no rebuild and no draw call change', () => {
      for (const tier of ['low', 'high'] as const) {
        const { scene, house } = buildHouse(1, tier, withGift(sampleHouse(1)));
        const meshes = scene.meshes.length;
        const shadows = scene.getMeshByName('house-contact-shadows') as Mesh | null;
        const before = shadows?.thinInstanceCount ?? 0;
        const at = house.giftPoint!;
        house.removeGift();
        expect(house.giftPoint).toBeNull();
        expect(house.stats.gift).toBe(false);
        expect(scene.meshes.length).toBe(meshes);
        // Low: its contact shadow went with it.
        if (tier === 'low') expect(shadows!.thinInstanceCount).toBe(before - 1);
        // Every vertex of the box folded to one point: nothing of it draws.
        const mesh = scene.getMeshByName(tier === 'low' ? 'house-f0-solid' : 'house-f0-small')!;
        const pos = mesh.getVerticesData('position')!;
        const last = pos.slice(-3);
        // …and they were the box's own (the merge keeps it last), where it stood.
        expect(Math.hypot(last[0]! - at.x, last[2]! - at.z)).toBeLessThan(HOUSE_GIFT.size);
        expect(Array.from(pos.slice(-30))).toEqual(
          Array.from({ length: 30 }, (_, i) => last[i % 3]),
        );
        house.removeGift(); // twice is harmless
        scene.getEngine().dispose();
      }
    });

    it('hides a gift upstairs with its floor, and shows it there', () => {
      const sample = withGift(sampleHouse(3), { room: 'kitchen' });
      const { scene, house } = buildHouse(3, 'low', sample);
      expect(house.giftPoint).toBeNull();
      house.setFloor(1);
      expect(house.giftPoint).not.toBeNull();
      expect(house.giftPoint!.y).toBeGreaterThan(HOUSE_GRID.storey);
      scene.getEngine().dispose();
    });

    it('relights for the time of day without a new light or mesh, and never touches the squishy fill', () => {
      for (const tier of ['low', 'high'] as const) {
        const { scene, house } = buildHouse(1, tier);
        const fill = scene.getLightByName('house-fill')!;
        const fillLook = [fill.intensity, fill.diffuse.toHexString()];
        const lights = scene.lights.length;
        const meshes = scene.meshes.length;
        const environment = scene.environmentIntensity;
        expect(house.stats.light).toEqual({ phase: 'dusk', lit: true });
        house.setLook(houseLookAtMinute(23 * 60));
        expect(house.stats.light).toEqual({ phase: 'night', lit: true });
        expect(scene.getMeshByName('house-f0-panes')!.material!.name).toBe('test-night-pane');
        expect(scene.clearColor.b).toBeGreaterThan(scene.clearColor.r);
        house.setLook(houseLookAtMinute(12 * 60));
        expect(house.stats.light).toEqual({ phase: 'day', lit: false });
        expect(scene.getMeshByName('house-f0-panes')!.material!.name).toBe('test-day-pane');
        expect(scene.lights.length).toBe(lights);
        expect(scene.meshes.length).toBe(meshes);
        expect([fill.intensity, fill.diffuse.toHexString()]).toEqual(fillLook);
        // Daylight brightens the house's own materials only: the scene's
        // image light, and so the squishies and the Keeper, stay as they are.
        scene.render();
        expect(scene.environmentIntensity).toBe(environment);
        const vinyl = scene.getMaterialByName('house-vinyl') as PBRMaterial;
        expect(vinyl.environmentIntensity).toBe(tier === 'low' ? 1 : HOUSE_TIMES.day.environment);
        const cast = scene.materials.filter((m) => /^(squishy|keeper)-/.test(m.name));
        expect(cast.length).toBeGreaterThan(0);
        for (const m of cast)
          if (m instanceof PBRMaterial) expect(m.environmentIntensity, m.name).toBe(1);
        expect(house.stats.lights).toBeLessThanOrEqual(tier === 'low' ? 2 : 4);
        scene.getEngine().dispose();
      }
    });

    it('lifts the rooms and the ceiling warm on high and medium, never the squishies, and fades the yard pools by day (B5a)', () => {
      for (const tier of ['medium', 'high'] as const) {
        const { scene, house } = buildHouse(2, tier);
        const hex = (m: string) => (scene.getMaterialByName(m) as PBRMaterial).ambientColor;
        const linear = (h: string) => Color3.FromHexString(h).toLinearSpace();
        for (const minute of [12 * 60, 18 * 60, 23 * 60]) {
          const look = houseLookAtMinute(minute);
          house.setLook(look);
          expect(hex('house-vinyl').equals(linear(look.lift)), `${tier} ${minute}`).toBe(true);
          expect(hex('house-floor').equals(linear(look.lift))).toBe(true);
          expect(hex('house-ceiling').equals(linear(look.ceiling))).toBe(true);
          expect(hex('house-lawn').equals(Color3.Black())).toBe(true);
          const cast = scene.materials.filter((m) => /^(squishy|keeper)-/.test(m.name));
          expect(cast.length).toBeGreaterThan(0);
          for (const m of cast)
            if (m instanceof PBRMaterial) expect(m.ambientColor.equals(Color3.Black()), m.name).toBe(true);
          // The yard's two lantern pools (built first, with the outside): none
          // by day, full at dusk and night; a room's always full.
          const pools = scene.getMeshByName('house-pools') as Mesh;
          // Babylon keeps a thin instance's `color` buffer as `instanceColor`.
          const data = pools._userThinInstanceBuffersStorage.data.instanceColor!;
          const colors = Array.from({ length: pools.thinInstanceCount }, (_, i) => data[i * 4]!);
          expect(colors.length).toBeGreaterThan(2);
          expect(colors.slice(0, 2), `${tier} ${minute} yard`).toEqual([look.yard, look.yard]);
          expect(colors.slice(2).every((c) => c === 1)).toBe(true);
        }
        // The ceiling's lift is warm only once the lamps are lit.
        expect(HOUSE_TIMES.day.ceiling).toBe('#000000');
        scene.getEngine().dispose();
      }
    });

    it('brings the squishy fill in flatter in the dollhouse than at kid height (B5a: Puddlepuff’s belly)', () => {
      expect(fillTilt(0).y).toBeGreaterThan(fillTilt(1).y);
      expect(fillTilt(HOUSE_KID.pitchFrom).y).toBeCloseTo(fillTilt(0).y);
      const { scene, house } = buildHouse(1, 'high');
      const fill = scene.getLightByName('house-fill') as DirectionalLight;
      const doll = fitHouse(house.bounds, { width: 820, height: 1180, top: 70, bottom: 150 });
      house.setPose(doll, 0);
      const dollY = fill.direction.y;
      house.setPose(kidPose(house.focusRoom!, { width: 820, height: 1180, top: 70, bottom: 150 }), 1);
      // Still from above, so every face is lit; flatter than the camera's own steep look down.
      expect(dollY).toBeLessThan(0);
      expect(dollY).toBeGreaterThan(Math.sin(-doll.pitch));
      expect(fill.direction.y).toBeLessThan(0);
      scene.getEngine().dispose();
    });

    it('builds in the look it’s given, and dims the lamps by day', () => {
      const night = buildHouse(1, 'high', sampleHouse(1), undefined, houseLookAtMinute(23 * 60));
      const day = buildHouse(1, 'high', sampleHouse(1), undefined, houseLookAtMinute(12 * 60));
      const fire = (s: typeof night.scene) => s.getLightByName('house-fire')!.intensity;
      expect(night.house.stats.light.phase).toBe('night');
      expect(fire(day.scene)).toBeLessThan(fire(night.scene));
      night.scene.getEngine().dispose();
      day.scene.getEngine().dispose();
    });

    it('flickers the fire on medium and high only, as the flicker says', () => {
      const low = buildHouse(1, 'low');
      expect(low.house.flickers).toBe(false);
      low.scene.getEngine().dispose();
      const { scene, house } = buildHouse(1, 'high');
      expect(house.flickers).toBe(true);
      const fire = scene.getLightByName('house-fire')!;
      const steady = fire.intensity;
      house.setFlicker(1.1, 1);
      expect(fire.intensity).toBeCloseTo(steady * 1.1);
      house.setFlicker(1, 1);
      expect(fire.intensity).toBeCloseTo(steady);
      scene.getEngine().dispose();
    });

    it('lets a resident in the Keeper’s room hop for welcome home, and nobody in an empty house', () => {
      const { scene, house } = buildHouse(1, 'low');
      expect(house.hop(performance.now())).toBe(true);
      scene.getEngine().dispose();
      const empty = buildHouse(1, 'low', sampleHouse(1, false));
      expect(empty.house.hop(performance.now())).toBe(false);
      empty.scene.getEngine().dispose();
    });
  });
});
