// PROTOTYPE ONLY (#306 Crooked House design lane). Never merged. Builds one
// mockup moment of the Crooked House for a screenshot: the rooms around it,
// the Keeper with the lantern, the lights, an echo, a locked door, a key…
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { defaultKeeperConfig, GAME_DATA, KEEPER_DATA, visualRegistry } from '@heartpatch/shared';
import type { QualityTier } from '../../engine/config.js';
import type { SceneContent } from '../../engine/stage.js';
import { KeeperField } from '../../procedural/keeper/keeper-field.js';
import { keeperItems } from '../../procedural/keeper/keeper-items.js';
import { lodFor } from '../../procedural/motion.js';
import type { SquishySpecies } from '../../procedural/params.js';
import { SquishyField } from '../../procedural/squishy-field.js';
import { buildBigChest, buildBigLid, hingeOf } from '../cellar-kit.js';
import {
  armchair, attic, blk, bookshelf, build, candelabra, clock, counterWithJar, door, echoBody, echoEyes,
  fireplace, flames, joyed, key, page, picture, rug, shell, sideTable, sparkle, stove, tube, type V3,
} from './proto-kit.js';
import type { Part } from '../../explore/kit-mesh.js';

export type Shot = 'dark' | 'lit' | 'echo' | 'caught' | 'door' | 'key' | 'bonus' | 'attic' | 'plan' | 'plan-up';

export interface ShotResult extends SceneContent {
  /** Where the lantern is (world), for the DOM dark overlay; null: no lantern dark. */
  readonly lantern: Vector3 | null;
  readonly lanternRadius: number;
}

interface Room {
  id: string;
  name: string;
  x: number;
  z: number;
  w: number;
  d: number;
  openings: { side: 'n' | 's' | 'e' | 'w'; at: number; width: number }[];
  paper?: string;
  floor?: string;
}

/** Ground floor (metres; x east, z north). The house is crooked: nothing lines up quite. */
const G: Record<string, Room> = {
  frontHall: { id: 'frontHall', name: 'Front Hall', x: 0, z: 0, w: 4.2, d: 4.6, openings: [{ side: 'w', at: 0.3, width: 1.3 }, { side: 'e', at: -0.2, width: 1.3 }, { side: 'n', at: 0.2, width: 1.3 }, { side: 's', at: 0, width: 1.6 }], paper: '#efd9c4' },
  parlour: { id: 'parlour', name: 'Parlour', x: -5.6, z: 0.2, w: 6.2, d: 5.2, openings: [{ side: 'e', at: 0.1, width: 1.3 }, { side: 'n', at: 1.2, width: 1.3 }] },
  conservatory: { id: 'conservatory', name: 'Conservatory', x: 5.6, z: -0.1, w: 6.0, d: 5.0, openings: [{ side: 'w', at: 0, width: 1.3 }, { side: 'n', at: -1.0, width: 1.3 }], paper: '#d8eadf', floor: '#9b948c' },
  stairHall: { id: 'stairHall', name: 'Stair Hall', x: 0.1, z: 5.6, w: 4.2, d: 5.8, openings: [{ side: 's', at: 0.1, width: 1.3 }, { side: 'w', at: -0.6, width: 1.3 }, { side: 'e', at: -0.4, width: 1.3 }, { side: 'n', at: -0.3, width: 1.3 }], paper: '#e9cfe2' },
  dining: { id: 'dining', name: 'Dining Room', x: -5.7, z: 5.9, w: 6.2, d: 5.6, openings: [{ side: 'e', at: -0.9, width: 1.3 }, { side: 's', at: 1.0, width: 1.3 }, { side: 'n', at: -0.5, width: 1.3 }], paper: '#f3dcd0' },
  library: { id: 'library', name: 'Library', x: 5.7, z: 5.7, w: 6.0, d: 5.4, openings: [{ side: 'w', at: -0.5, width: 1.3 }, { side: 's', at: -1.2, width: 1.3 }], paper: '#d9d2ef' },
  kitchen: { id: 'kitchen', name: 'Kitchen', x: -5.6, z: 11.5, w: 6.2, d: 5.2, openings: [{ side: 's', at: -0.5, width: 1.3 }, { side: 'e', at: 0.2, width: 1.3 }], paper: '#dfeaf3', floor: '#9b948c' },
  scullery: { id: 'scullery', name: 'Scullery Passage', x: 0.1, z: 11.2, w: 4.2, d: 4.6, openings: [{ side: 's', at: -0.1, width: 1.3 }, { side: 'w', at: 0, width: 1.3 }, { side: 'e', at: 0.1, width: 1.3 }], paper: '#e6d5c4', floor: '#9b948c' },
  pantry: { id: 'pantry', name: 'Pantry (bonus)', x: 5.6, z: 11.4, w: 5.6, d: 4.8, openings: [{ side: 'w', at: 0.1, width: 1.3 }], paper: '#f1e0c0', floor: '#9b948c' },
  inglenook: { id: 'inglenook', name: 'Inglenook (bonus)', x: -10.7, z: 0.6, w: 3.2, d: 3.6, openings: [{ side: 'e', at: 0.4, width: 1.3 }], paper: '#f7e2c8' },
};

/** Upstairs. */
const U: Record<string, Room> = {
  landing: { id: 'landing', name: 'Landing', x: 0, z: 5.6, w: 4.2, d: 5.8, openings: [{ side: 'w', at: -1.5, width: 1.3 }, { side: 'w', at: 1.3, width: 1.3 }, { side: 'e', at: -1.2, width: 1.3 }, { side: 'e', at: 1.4, width: 1.3 }], paper: '#e9cfe2' },
  blueBedroom: { id: 'blueBedroom', name: 'Blue Bedroom', x: -5.6, z: 3.0, w: 6.2, d: 5.4, openings: [{ side: 'e', at: 1.1, width: 1.3 }, { side: 'w', at: 0.5, width: 1.1 }], paper: '#cfe0f5' },
  nursery: { id: 'nursery', name: 'Nursery', x: -5.6, z: 8.6, w: 6.2, d: 5.4, openings: [{ side: 'e', at: -1.7, width: 1.3 }], paper: '#f9e3ec' },
  musicRoom: { id: 'musicRoom', name: 'Music Room', x: 5.6, z: 3.0, w: 6.0, d: 5.4, openings: [{ side: 'w', at: 1.4, width: 1.3 }], paper: '#efe3c8' },
  sewingRoom: { id: 'sewingRoom', name: 'Sewing Room', x: 5.6, z: 8.6, w: 6.0, d: 5.4, openings: [{ side: 'w', at: -1.6, width: 1.3 }], paper: '#e3f1e0' },
  lanternCloset: { id: 'lanternCloset', name: 'Lantern Closet (bonus)', x: -10.2, z: 3.3, w: 2.8, d: 3.0, openings: [{ side: 'e', at: 0.2, width: 1.1 }], paper: '#3a3550', floor: '#2a2535' },
};

const glowMat = (scene: Scene, name: string, hex: string, strength: number): StandardMaterial => {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveColor = Color3.FromHexString(hex).toLinearSpace().scale(strength);
  return m;
};

const roomParts = (r: Room, joy: number, extra: Part[] = []): Part[] =>
  [...shell(r.w, r.d, joy, { openings: r.openings, paper: r.paper, floor: r.floor }).map((p) => {
    const pos = p.data.positions ?? [];
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] = (pos[i] ?? 0) + r.x;
      pos[i + 2] = (pos[i + 2] ?? 0) + r.z;
    }
    return p;
  }), ...extra];

/** Parts offset by a room's origin (for props placed in room-local metres). */
const inRoom = (r: Room, parts: Part[]): Part[] =>
  parts.map((p) => {
    const pos = p.data.positions ?? [];
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] = (pos[i] ?? 0) + r.x;
      pos[i + 2] = (pos[i + 2] ?? 0) + r.z;
    }
    return p;
  });

export function buildShot(scene: Scene, shot: Shot, tier: QualityTier): ShotResult {
  const vinyl = new PBRMaterial('crooked-vinyl', scene);
  vinyl.albedoColor = Color3.White();
  vinyl.metallic = 0;
  vinyl.roughness = 0.5;
  vinyl.clearCoat.isEnabled = true;
  vinyl.clearCoat.intensity = 0.6;
  vinyl.clearCoat.roughness = 0.25;
  vinyl.maxSimultaneousLights = 8;
  const night = Color3.FromHexString('#0b0912').toLinearSpace();
  scene.clearColor = Color4.FromColor3(night, 1);
  scene.environmentIntensity = shot === 'plan' || shot === 'plan-up' ? 0.4 : 0.05;
  const sun = scene.getLightByName('sun');
  if (sun) sun.intensity = shot === 'plan' || shot === 'plan-up' ? 0.25 : 0.0;

  const litMeshes: Mesh[] = [];
  const dark: Mesh[] = [];
  const lights: PointLight[] = [];
  let lantern: Vector3 | null = null;
  let lanternRadius = 3.1;
  let keeperAt: V3 = [0, 0, 0];
  let keeperYaw = 0;
  let focus = { x: 0, z: 0 };
  let distance = 15;
  let pitch = (56 * Math.PI) / 180;
  const extraBuilt: (() => void)[] = [];

  const addRoom = (r: Room, joy: number, extra: Part[] = [], lit = joy >= 0.99): Mesh => {
    const m = build(scene, `crooked-${shot}-${r.id}-${joy}`, roomParts(r, joy, extra));
    m.material = vinyl;
    (lit ? litMeshes : dark).push(m);
    return m;
  };
  const addGlow = (name: string, parts: Part[], hex: string, strength: number): Mesh => {
    const m = build(scene, `crooked-${shot}-${name}`, parts);
    m.material = glowMat(scene, `glow-${name}`, hex, strength);
    return m;
  };
  const point = (at: V3, hex: string, intensity: number, range: number): PointLight => {
    const l = new PointLight(`pl-${lights.length}`, new Vector3(...at), scene);
    l.diffuse = Color3.FromHexString(hex);
    l.specular = l.diffuse.scale(0.3);
    l.intensity = intensity;
    l.range = range;
    lights.push(l);
    return l;
  };
  const roomLamp = (r: Room): void => {
    point([r.x, 2.6, r.z], '#ffe2b8', 14, 9);
  };
  const lanternAt = (at: V3): void => {
    lantern = new Vector3(at[0] + 0.5, 0.95, at[2] - 0.1);
    point([lantern.x, lantern.y, lantern.z], '#ffb866', 7, 5.2);
  };

  // Parlour dressing at each state.
  const parlourProps = (joy: number, o: { fire: boolean; askew: boolean; toppled: boolean; candles: boolean }): Part[] => [
    ...fireplace([-3.0, 0, -0.2], joy, o.fire),
    ...picture([0.5, 1.5, 2.44], joy, o.askew),
    ...armchair([0.9, 0, 1.0], joy, o.toppled, 0.5),
    ...armchair([-1.4, 0, 1.3], joy, false, -0.4),
    ...rug([-0.2, 0, -0.3], 1.4, joy),
    ...clock([2.6, 0, 2.2], joy),
    ...candelabra([2.4, 0, -1.6], joy),
    ...sideTable([-2.2, 0, 2.1], joy, o.candles),
  ];

  switch (shot) {
    case 'dark': {
      addRoom(G.parlour!, 0, inRoom(G.parlour!, parlourProps(0, { fire: false, askew: true, toppled: true, candles: false })));
      addRoom(G.frontHall!, 1, inRoom(G.frontHall!, rug([0, 0, 0.3], 1.0, 1)));
      roomLamp(G.frontHall!);
      addRoom(G.inglenook!, 0, [], false);
      keeperAt = [G.parlour!.x + 0.2, 0, G.parlour!.z + 0.6];
      keeperYaw = 0.5;
      lanternAt(keeperAt);
      focus = { x: G.parlour!.x, z: G.parlour!.z + 0.3 };
      break;
    }
    case 'lit': {
      addRoom(G.parlour!, 1, inRoom(G.parlour!, parlourProps(1, { fire: false, askew: false, toppled: false, candles: true })));
      addRoom(G.frontHall!, 1, inRoom(G.frontHall!, rug([0, 0, 0.3], 1.0, 1)));
      roomLamp(G.parlour!);
      point([G.parlour!.x + 2.4, 1.7, G.parlour!.z - 1.6], '#ffd9a0', 4, 4);
      const cf = inRoom(G.parlour!, [...flames([2.1, 1.55, -1.6], 0.35), ...flames([2.4, 1.55, -1.6], 0.35), ...flames([2.7, 1.55, -1.6], 0.35)]);
      addGlow('candles', cf, '#ffd27a', 1.9);
      addRoom(G.inglenook!, 0, [], false);
      keeperAt = [G.parlour!.x + 0.3, 0, G.parlour!.z + 0.4];
      keeperYaw = 0.4;
      focus = { x: G.parlour!.x, z: G.parlour!.z + 0.3 };
      break;
    }
    case 'echo':
    case 'caught': {
      addRoom(G.stairHall!, 0, ([] as Part[]).concat(
        blk(1.4, 0.3, 3.0, [G.stairHall!.x + 1.0, 0.15, G.stairHall!.z + 1.2], joyed('#8a5a3c', 0), { round: 0.3 }),
        ...[0, 1, 2, 3, 4, 5].map((i) => blk(1.3, 0.22, 0.42, [G.stairHall!.x + 1.0, 0.3 + i * 0.22, G.stairHall!.z + 0.1 + i * 0.44], joyed('#a67c52', 0), { round: 0.3 })),
        ...candelabra([G.stairHall!.x - 1.5, 0, G.stairHall!.z + 2.2], 0),
      ));
      addRoom(G.frontHall!, 1, inRoom(G.frontHall!, rug([0, 0, 0.3], 1.0, 1)));
      roomLamp(G.frontHall!);
      addRoom(G.dining!, 0, inRoom(G.dining!, [blk(3.2, 0.12, 1.2, [0, 0.78, 0], joyed('#8a5a3c', 0), { round: 0.5 }), ...[[-1.3, 0.4], [0, 0.4], [1.3, 0.4], [-1.3, -0.4], [1.3, -0.4]].map(([x, z]) => tube(0.75, 0.1, 0.1, [x ?? 0, 0.37, z ?? 0], joyed('#8a5a3c', 0)))]));
      addRoom(G.library!, 0, inRoom(G.library!, bookshelf([0.5, 0, 2.4], 0, true)));
      keeperAt = [G.stairHall!.x - 0.8, 0, G.stairHall!.z - 1.4];
      keeperYaw = 0.1;
      lanternAt(keeperAt);
      // The echo drifts down the hall towards the lantern's edge.
      const e: V3 = [G.stairHall!.x - 0.9, 0.9, G.stairHall!.z + 1.6];
      const body = build(scene, 'crooked-echo-body', echoBody(e));
      const em = new StandardMaterial('echo-mat', scene);
      em.diffuseColor = Color3.FromHexString('#2a1f45').toLinearSpace();
      em.emissiveColor = Color3.FromHexString('#4a3a7a').toLinearSpace().scale(0.9);
      em.specularColor = Color3.Black();
      em.alpha = 0.82;
      body.material = em;
      addGlow('echo-eyes', echoEyes(e), '#d8c6ff', 2.2);
      // A faint trail behind it.
      const trail = build(scene, 'crooked-echo-trail', [
        ...echoBody([e[0] + 0.5, e[1] + 0.1, e[2] + 1.0]).map((p) => p),
      ]);
      const tm = em.clone('echo-trail-mat');
      tm.alpha = 0.35;
      trail.material = tm;
      point([e[0], e[1], e[2]], '#8f6fff', 1.6, 4);
      focus = { x: G.stairHall!.x - 0.3, z: G.stairHall!.z + 0.1 };
      break;
    }
    case 'door': {
      addRoom(G.frontHall!, 1, inRoom(G.frontHall!, [...rug([0, 0, 0.3], 1.0, 1), ...door([0.2, 0, 2.3], 'n', 1.3, 1, 'locked'), ...sideTable([-1.5, 0, 1.6], 1, true), ...picture([1.3, 1.5, 2.3], 1, false)]));
      roomLamp(G.frontHall!);
      addRoom(G.stairHall!, 0, [], false);
      addRoom(G.parlour!, 0, inRoom(G.parlour!, parlourProps(0, { fire: false, askew: true, toppled: true, candles: false })));
      addRoom(G.conservatory!, 0, [], false);
      keeperAt = [G.frontHall!.x + 0.3, 0, G.frontHall!.z + 0.9];
      keeperYaw = Math.PI;
      focus = { x: G.frontHall!.x, z: G.frontHall!.z + 0.9 };
      distance = 13;
      break;
    }
    case 'key': {
      addRoom(G.kitchen!, 0, inRoom(G.kitchen!, [...counterWithJar([-0.6, 0, 2.2], 0), ...stove([2.1, 0, 2.1], 0), ...rug([0.2, 0, -0.6], 1.1, 0)]));
      addRoom(G.scullery!, 0, [], false);
      keeperAt = [G.kitchen!.x + 0.2, 0, G.kitchen!.z + 1.1];
      keeperYaw = 0.6;
      lanternAt(keeperAt);
      const k: V3 = [G.kitchen!.x - 0.9, 1.9, G.kitchen!.z + 1.4];
      const km = build(scene, 'crooked-key', key(k, 0.5));
      const keyMat = new PBRMaterial('key-mat', scene);
      keyMat.albedoColor = Color3.FromHexString('#ffd27a').toLinearSpace();
      keyMat.metallic = 0.6;
      keyMat.roughness = 0.3;
      keyMat.emissiveColor = Color3.FromHexString('#ffb340').toLinearSpace().scale(0.6);
      km.material = keyMat;
      addGlow('key-sparkle', [...sparkle([k[0] + 0.5, k[1] + 0.3, k[2] - 0.2], 0.3), ...sparkle([k[0] - 0.5, k[1] + 0.45, k[2] - 0.1], 0.22), ...sparkle([k[0] + 0.1, k[1] - 0.4, k[2] - 0.3], 0.18)], '#fff2c0', 2.4);
      point(k, '#ffd27a', 7, 4.5);
      focus = { x: G.kitchen!.x - 0.3, z: G.kitchen!.z + 1.2 };
      break;
    }
    case 'bonus': {
      // The Parlour put right, and Emberbun has just lit the cold fireplace: the Inglenook beyond glows.
      addRoom(G.parlour!, 1, inRoom(G.parlour!, parlourProps(1, { fire: true, askew: false, toppled: false, candles: true })));
      roomLamp(G.parlour!);
      const fp: V3 = [G.parlour!.x - 3.0, 0.3, G.parlour!.z - 0.75];
      addGlow('fire', [...flames([fp[0], fp[1], fp[2]], 1.1), ...flames([fp[0] + 0.35, fp[1] + 0.05, fp[2] - 0.15], 0.7), ...flames([fp[0] - 0.3, fp[1], fp[2] - 0.1], 0.6)], '#ff9a3c', 1.8);
      point([fp[0] + 0.5, 1.0, fp[2] - 0.6], '#ff9a3c', 9, 6);
      addRoom(G.inglenook!, 1, inRoom(G.inglenook!, [...rug([0, 0, 0], 0.9, 1), blk(0.9, 0.6, 0.7, [-0.6, 0.3, 0.8], '#8a5a3c', { round: 0.5 }), blk(0.7, 0.1, 0.5, [-0.6, 0.65, 0.8], '#ffd27a', { round: 0.5 }), ...armchair([0.6, 0, -0.6], 1, false, 2.4)]));
      point([G.inglenook!.x, 2.2, G.inglenook!.z], '#ffd9a0', 7, 6);
      addRoom(G.frontHall!, 1, inRoom(G.frontHall!, rug([0, 0, 0.3], 1.0, 1)));
      keeperAt = [G.parlour!.x - 1.5, 0, G.parlour!.z + 0.5];
      keeperYaw = -1.1;
      focus = { x: G.parlour!.x - 3.2, z: G.parlour!.z + 0.1 };
      distance = 14;
      extraBuilt.push(() => {
        const sf = new SquishyField(scene, { registry: visualRegistry(GAME_DATA), lod: lodFor('closeUp', tier), breathing: false });
        const sp = GAME_DATA.species.find((s) => s.id === 'emberbun') as unknown as SquishySpecies | undefined;
        if (sp) sf.add(sp, 'proto-emberbun', { x: fp[0] + 1.3, z: fp[2] - 1.0, y: 0, yaw: 1.2, scale: 0.75 });
        (sf as unknown as { flush?: () => void }).flush?.();
      });
      break;
    }
    case 'attic': {
      const W = 7.2;
      const D = 6.4;
      const am = build(scene, 'crooked-attic', attic(W, D));
      am.material = vinyl;
      litMeshes.push(am);
      addGlow('attic-page', page([1.6, 1.08, -0.4]), '#fff0b8', 1.6);
      point([1.6, 1.8, -0.9], '#ffe9b0', 4, 4);
      point([0, 2.8, 1.0], '#9fc4ff', 5, 9);
      point([-1.2, 1.4, -1.6], '#ffb866', 7, 5.5);
      // The big chest (the cellar's own) in the middle, open with its lid back.
      const chest = buildBigChest(scene);
      chest.mesh.position.set(-0.6, 0, -0.8);
      chest.mesh.material = vinyl;
      const lid = buildBigLid(scene);
      const h = hingeOf(true);
      lid.position.set(-0.6, h.y, -0.8 + h.z);
      lid.rotation.x = -2.0;
      lid.material = vinyl;
      addGlow('attic-beam', [tube(2.2, 1.2, 0.35, [-0.6, 1.5, -0.8], '#fff6d6')], '#fff2c0', 0.55);
      addGlow('attic-sparkles', [...sparkle([-0.2, 1.3, -1.2], 0.26), ...sparkle([-1.1, 1.7, -0.5], 0.3), ...sparkle([-0.5, 2.1, -0.9], 0.2), ...sparkle([0.2, 1.9, -0.4], 0.16)], '#fff2c0', 2.2);
      keeperAt = [-1.6, 0, -2.3];
      keeperYaw = 0.6;
      focus = { x: 0.2, z: -0.3 };
      distance = 15;
      pitch = (56 * Math.PI) / 180;
      break;
    }
    case 'plan':
    case 'plan-up': {
      // Dollhouse view: the whole floor; put-right rooms in colour, the rest grey.
      const rooms = shot === 'plan' ? G : U;
      const litIds = shot === 'plan' ? new Set(['frontHall', 'parlour', 'conservatory', 'inglenook']) : new Set(['landing']);
      for (const r of Object.values(rooms)) {
        const joy = litIds.has(r.id) ? 1 : 0;
        const props: Part[] = r.id === 'parlour' ? inRoom(r, parlourProps(1, { fire: true, askew: false, toppled: false, candles: true })) : [];
        if (r.id === 'kitchen') props.push(...inRoom(r, [...counterWithJar([-0.6, 0, 2.2], 0), ...stove([2.1, 0, 2.1], 0)]));
        if (r.id === 'library') props.push(...inRoom(r, bookshelf([0.5, 0, 2.4], 0, true)));
        if (r.id === 'dining') props.push(...inRoom(r, [blk(3.2, 0.12, 1.2, [0, 0.78, 0], joyed('#8a5a3c', 0), { round: 0.5 })]));
        if (r.id === 'conservatory') props.push(...inRoom(r, [tube(0.5, 0.5, 0.4, [-1.8, 0.25, 1.6], '#e76f51'), tube(0.5, 0.5, 0.4, [1.6, 0.25, 1.8], '#e76f51'), ...rug([0, 0, -0.5], 1.2, 1)]));
        if (r.id === 'scullery') props.push(...inRoom(r, [blk(2.0, 0.08, 1.2, [0, 0.04, 1.0], joyed('#5a3a2a', 0))]));
        addRoom(r, joy, props, litIds.has(r.id));
        if (litIds.has(r.id)) roomLamp(r);
      }
      if (shot === 'plan') {
        // The scullery's fire, and the lantern in the stair hall where the Keeper stands.
        const fp: V3 = [G.scullery!.x, 0.1, G.scullery!.z + 1.0];
        addGlow('plan-fire', [...flames([fp[0] - 0.5, fp[1], fp[2]], 0.8), ...flames([fp[0] + 0.4, fp[1], fp[2] + 0.2], 0.7), ...flames([fp[0], fp[1], fp[2] - 0.4], 0.6)], '#ff9a3c', 1.6);
        point([fp[0], 1.2, fp[2]], '#ff9a3c', 6, 5);
        keeperAt = [G.stairHall!.x - 0.5, 0, G.stairHall!.z - 1.2];
        lanternAt(keeperAt);
        // Echoes in the dark halls.
        const es: V3[] = [[G.stairHall!.x + 0.4, 0.9, G.stairHall!.z + 1.8], [G.dining!.x + 1.5, 0.9, G.dining!.z - 1.0]];
        es.forEach((e, i) => {
          const b = build(scene, `plan-echo-${i}`, echoBody(e));
          const em = new StandardMaterial(`plan-echo-mat-${i}`, scene);
          em.diffuseColor = Color3.FromHexString('#2a1f45').toLinearSpace();
          em.emissiveColor = Color3.FromHexString('#4a3a7a').toLinearSpace().scale(0.9);
          em.alpha = 0.8;
          b.material = em;
          addGlow(`plan-echo-eyes-${i}`, echoEyes(e), '#d8c6ff', 2.0);
        });
        focus = { x: 0, z: 5.6 };
        distance = 34;
        pitch = (72 * Math.PI) / 180;
      } else {
        keeperAt = [U.landing!.x, 0, U.landing!.z - 1.8];
        lanternAt(keeperAt);
        const e: V3 = [U.landing!.x + 0.6, 0.9, U.landing!.z + 1.6];
        const b = build(scene, 'plan-up-echo', echoBody(e));
        const em = new StandardMaterial('plan-up-echo-mat', scene);
        em.diffuseColor = Color3.FromHexString('#2a1f45').toLinearSpace();
        em.emissiveColor = Color3.FromHexString('#4a3a7a').toLinearSpace().scale(0.9);
        em.alpha = 0.8;
        b.material = em;
        addGlow('plan-up-echo-eyes', echoEyes(e), '#d8c6ff', 2.0);
        focus = { x: 0, z: 5.6 };
        distance = 32;
        pitch = (72 * Math.PI) / 180;
      }
      break;
    }
  }

  // Put-right rooms get a soft warm fill of their own; the dark rooms keep only what the lantern reaches.
  if (litMeshes.length) {
    const fill = new HemisphericLight('room-fill', new Vector3(0.2, 1, -0.3), scene);
    fill.diffuse = Color3.FromHexString('#fff1dc');
    fill.groundColor = Color3.FromHexString('#4a3a55');
    fill.intensity = shot === 'plan' || shot === 'plan-up' ? 0.75 : 0.9;
    fill.includedOnlyMeshes = litMeshes;
  }
  if (dark.length) {
    const dim = new HemisphericLight('dark-fill', new Vector3(0, 1, 0), scene);
    dim.diffuse = Color3.FromHexString('#2a2440');
    dim.groundColor = Color3.FromHexString('#120f1c');
    dim.intensity = shot === 'plan' || shot === 'plan-up' ? 1.4 : 0.1;
    dim.includedOnlyMeshes = dark;
  }

  // The Keeper with the lantern in hand.
  if (shot !== 'attic' || true) {
    const kf = new KeeperField(scene, { data: KEEPER_DATA, lod: lodFor('closeUp', tier) });
    const base = KEEPER_DATA.bases[0];
    if (base) kf.add(defaultKeeperConfig(base), { x: keeperAt[0], z: keeperAt[2], y: 0, yaw: keeperYaw, lean: 0.3 }, keeperItems([]));
    kf.flush();
    if (lantern !== null || shot === 'attic' || shot === 'lit' || shot === 'door' || shot === 'bonus') {
      const l = lantern ?? new Vector3(keeperAt[0] + 0.5, 0.95, keeperAt[2] - 0.1);
      const frame = build(scene, `crooked-lantern-frame-${shot}`, [
        blk(0.3, 0.42, 0.3, [l.x, l.y, l.z], '#3b2a22', { round: 0.5 }),
        blk(0.34, 0.06, 0.34, [l.x, l.y + 0.26, l.z], '#3b2a22', { round: 0.5 }),
        tube(0.3, 0.03, 0.03, [l.x, l.y + 0.45, l.z], '#3b2a22'),
        tube(0.22, 0.22, 0.22, [l.x, l.y + 0.62, l.z], '#3b2a22', [Math.PI / 2, 0, 0]),
      ]);
      frame.material = vinyl;
      addGlow(`lantern-glass-${shot}`, [blk(0.24, 0.3, 0.24, [l.x, l.y, l.z], '#ffd27a', { round: 0.6 })], '#ffc46b', 2.4);
      if (lantern === null) point([l.x, l.y, l.z], '#ffb866', 4, 4);
    }
  }
  for (const f of extraBuilt) f();
  for (const m of scene.materials) {
    if (m instanceof PBRMaterial || m instanceof StandardMaterial) m.maxSimultaneousLights = 8;
  }

  const aspect = scene.getEngine().getRenderWidth() / Math.max(1, scene.getEngine().getRenderHeight());
  // Fit the room across a portrait phone: a 6.2 m room plus margins.
  if (shot !== 'plan' && shot !== 'plan-up' && aspect < 0.9) distance = Math.max(distance, (3.3 / Math.tan(0.4)) / aspect);
  if ((shot === 'plan' || shot === 'plan-up') && aspect < 0.9) distance = Math.max(distance, (9.6 / Math.tan(0.4)) / aspect);
  const overlay = shot === 'plan' || shot === 'plan-up' ? null : lantern;
  return {
    bounds: { minX: -16, maxX: 16, minZ: -6, maxZ: 18 },
    start: focus,
    maxDistance: 64,
    lantern: overlay,
    lanternRadius,
    // Pure data for the page: the camera the page should pin.
    ...({ distance, pitch } as object),
  } as ShotResult;
}

export const SHOT_HUD: Record<Shot, { room: string; keys: string; rooms: string; action: string | null; bubble?: string; card?: { title: string; body: string; button: string } }> = {
  dark: { room: 'Parlour 🕯️', keys: '🗝️ 0 of 6', rooms: '1 of 12 put right', action: 'Straighten it 🖼️', bubble: 'Something’s crooked here…' },
  lit: { room: 'Parlour ✨', keys: '🗝️ 1 of 6', rooms: '2 of 12 put right', action: null, card: { title: 'The Parlour is put right! 🌈', body: 'The colour came back. Your lantern will always burn here now.', button: 'Yay!' } },
  echo: { room: 'Stair Hall 🕯️', keys: '🗝️ 1 of 6', rooms: '2 of 12 put right', action: 'Tiptoe 🤫', bubble: 'Shh… an echo is drifting this way.' },
  caught: { room: 'Stair Hall 🕯️', keys: '🗝️ 1 of 6', rooms: '2 of 12 put right', action: null },
  door: { room: 'Front Hall ✨', keys: '🗝️ 0 of 6', rooms: '1 of 12 put right', action: 'Try the door 🔒', bubble: 'Locked tight! The Brass Key is somewhere in this house…' },
  key: { room: 'Kitchen 🕯️', keys: '🗝️ 2 of 6', rooms: '4 of 12 put right', action: null, card: { title: 'You found the Silver Key! 🗝️', body: 'It was in the cookie jar all along. It opens the stairs.', button: 'Keep it' } },
  bonus: { room: 'Parlour ✨', keys: '🗝️ 1 of 6', rooms: '2 of 12 put right', action: 'Light it 🔥', bubble: 'Emberbun lit the cold fireplace! A cozy nook opens up behind it.' },
  attic: { room: 'The Attic 🌙', keys: '🗝️ 6 of 6', rooms: '12 of 12 put right', action: null, card: { title: 'The attic! 📖', body: 'The Crooked House’s story, and a chest nobody has opened for a very long time.', button: 'Open the chest 👑' } },
  plan: { room: 'Crooked House · Ground', keys: '🗝️ 1 of 6', rooms: '4 of 12 put right', action: null },
  'plan-up': { room: 'Crooked House · Upstairs', keys: '🗝️ 4 of 6', rooms: '8 of 12 put right', action: null },
};
