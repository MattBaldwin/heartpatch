import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import { GAME_DATA, visualRegistry, type CrookedHouseView, type Species } from '@heartpatch/shared';
import { kitMesh } from '../../explore/kit-mesh.js';
import type { SquishyLod } from '../../procedural/config.js';
import { SquishyField, type SquishyHandle } from '../../procedural/squishy-field.js';
import { chestBase, chestLid, CHEST_SIZE, leafMote, mote } from './crooked-bonus-kit.js';
import { chestOpened, chestPoint, chestRooms } from './crooked-bonus.js';
import { roomOf, type FloorPoint } from './crooked-plan.js';

// The bonus rooms' moments (#306 6e), drawn beside the house's own scene:
// each bonus room's chest (its lid swings open), the team friend who pops in
// to wake a sleeping door with its element's flourish, and a chest's rare
// friend hopping out. Motes are one glowing kit shape per colour, instanced;
// the squishies are one small field. Reduced motion: no flight and no hops,
// a still glow, and the lid simply open.

/** Each element's flourish: its colours and how its motes travel to the door. */
interface PowerFx {
  readonly colours: readonly string[];
  readonly path: Path;
  /** Leaves, not round motes. */
  readonly leaf?: boolean;
}

const POWER_FX: Readonly<Record<string, PowerFx>> = {
  fire: { colours: ['#ffb347', '#ff7a3d', '#ffd27a'], path: 'flicker' }, // TUNE: all of them
  leaf: { colours: ['#7fd09b', '#4f9d6b', '#c8f0a0'], path: 'twirl', leaf: true },
  water: { colours: ['#7bbcf2', '#cfe9ff', '#ffffff'], path: 'arc' },
  light: { colours: ['#fff6c7', '#f2d05a', '#ffffff'], path: 'beam' },
};
const OTHER_FX: PowerFx = { colours: ['#ffffff', '#ffd27a'], path: 'arc' };
/** A chest's burst. */
const CHEST_FX = ['#ffd27a', '#f7a1c4', '#ffffff', '#8ecae6'] as const;

type Path = 'flicker' | 'twirl' | 'arc' | 'beam';

const TIMING = {
  /** The friend pops in beside the Keeper, s. */
  popIn: 0.35,
  /** …then its flourish flies to the door, s. The door wakes at the end. */
  flourish: 1.0,
  /** …and it waves and pops away again, s. */
  popOut: 0.8,
  /** Reduced motion: a still glow this long before the door wakes, s. */
  still: 0.6,
  /** The lid swings open, s. */
  lid: 0.5,
  /** A chest's sparkles rise and fade, s. */
  sparkle: 1.4,
  /** A chest's friend hops out, s. */
  hop: 0.7,
} as const; // TUNE

/** Motes in flight at once, and the most of one colour (its thin-instance buffer). */
const MOTES = { power: 18, pop: 8, wake: 12, chest: 16, perColour: 32 } as const; // TUNE
/** A friend's pop-in sparkles: white and gold, whatever its element (a dark friend still shows). */
const POP_FX = ['#ffffff', '#ffd27a'] as const;
/** A squishy in the house stands about this tall, metres (the Keeper is about 1.2). */
const SQUISHY_HEIGHT = 0.75; // TUNE
/** A squishy drawn off stage for the first frames, so the field's program is compiled before a moment needs it. */
const WARM_SPECIES = 'puddlepuff';
/** The squishies' material (the field's own; the Keeper's is `keeper-vinyl`). */
const SQUISHY_MATERIAL = 'squishy-vinyl';
/** The lid's open angle (radians, back over the hinge). */
const LID_OPEN = -1.95; // TUNE

interface Mote {
  /** Its colour's thin-instanced mesh. */
  readonly source: MoteSource;
  readonly from: Vector3;
  readonly to: Vector3;
  readonly start: number;
  readonly life: number;
  readonly path: Path;
  readonly phase: number;
}

interface MoteSource {
  readonly mesh: Mesh;
  readonly data: Float32Array;
  count: number;
}

interface Chest {
  readonly room: string;
  readonly base: Mesh;
  readonly lid: Mesh;
  /** The lid's swing, from this time (ms), or null at rest. */
  opening: number | null;
}

export interface CrookedBonusFxOptions {
  readonly lod: SquishyLod;
  readonly reducedMotion: boolean;
}

/** What the dev hook reads. */
export interface CrookedBonusFxStats {
  readonly chests: readonly { room: string; open: boolean; x: number; z: number }[];
  readonly helper: string | null;
  readonly friend: string | null;
  readonly motes: number;
}

export class CrookedBonusFx {
  readonly #scene: Scene;
  readonly #options: CrookedBonusFxOptions;
  readonly #chestMat: PBRMaterial;
  readonly #fill: HemisphericLight;
  readonly #field: SquishyField;
  readonly #moteSources = new Map<string, MoteSource>();
  readonly #chests = new Map<string, Chest>();
  #motes: Mote[] = [];
  #helper: {
    handle: SquishyHandle;
    id: string;
    at: FloorPoint;
    yaw: number;
    /** Its scale at full size (every kind the same height in the house). */
    size: number;
    start: number;
    wake: number;
    end: number;
    woke: (() => void) | null;
    /** Where its flourish lands (the door), and the element's look. */
    door: Vector3;
    fx: PowerFx;
  } | null = null;
  #friend: {
    handle: SquishyHandle;
    species: string;
    size: number;
    landed: boolean;
    from: FloorPoint;
    to: FloorPoint;
    start: number;
  } | null = null;
  #view: CrookedHouseView | null = null;
  /** The field's squishies changed: the fill's list is rebuilt once their meshes exist. */
  #lightDirty = false;
  /** A chest drawn off stage while its program compiles with the fill (`#warm`). */
  #probe: Mesh | null = null;

  constructor(scene: Scene, options: CrookedBonusFxOptions) {
    this.#scene = scene;
    this.#options = options;
    // The chests are lit by their own soft fill (the rooms' fills light only room meshes).
    const m = new PBRMaterial('crooked-chest', scene);
    m.albedoColor = Color3.White();
    m.metallic = 0;
    m.roughness = 0.55;
    m.maxSimultaneousLights = 6;
    this.#chestMat = m;
    this.#fill = new HemisphericLight('crooked-chest-fill', new Vector3(0.2, 1, -0.4), scene);
    this.#fill.diffuse = Color3.FromHexString('#fff1dc');
    this.#fill.groundColor = Color3.FromHexString('#4a3a55');
    this.#fill.intensity = 0.85;
    this.#fill.setEnabled(false);
    this.#field = new SquishyField(scene, {
      registry: visualRegistry(GAME_DATA),
      lod: options.lod,
      breathing: false,
    });
    // The field makes its meshes as it flushes, before each draw (its own
    // observer, added first, runs first): the fill's list follows right after,
    // so a new squishy is lit, and compiled lit, from its first frame.
    const lighting = scene.onBeforeRenderObservable.add(() => {
      if (!this.#lightDirty) return;
      this.#lightDirty = false;
      this.#light();
    });
    scene.onDisposeObservable.addOnce(() => {
      scene.onBeforeRenderObservable.remove(lighting);
      // A lost context mid-moment still opens its door (the screen rebuilds the scene).
      const h = this.#helper;
      this.#helper = null;
      h?.woke?.();
      this.#field.dispose();
    });
    this.#warm();
  }

  /**
   * Builds every mote colour and the chest, and puts a squishy far off
   * stage for the first frames, then compiles them all, one at a time, so a
   * power or a chest compiles nothing as it plays (#501 D1, as the cellar's
   * chests and explore's props do).
   */
  #warm(): void {
    const scene = this.#scene;
    const colours: [string, boolean][] = [
      ...Object.values(POWER_FX).flatMap((fx) =>
        fx.colours.map((c): [string, boolean] => [c, fx.leaf ?? false]),
      ),
      ...[...OTHER_FX.colours, ...POP_FX, ...CHEST_FX].map((c): [string, boolean] => [c, false]),
    ];
    const motes = colours.map(([hex, leaf]) => this.#mote(hex, leaf).mesh);
    const probe = this.#kit('crooked-chest-base', chestBase);
    probe.position.set(0, -50, 0);
    this.#probe = probe;
    const species = speciesOf(WARM_SPECIES);
    const warm = species
      ? this.#field.add(species, 'crooked-warm', { x: 0, y: -50, z: 0, scale: 0.01 })
      : null;
    // The probe (and the warm squishy, once flushed) are lit by the fill, as in a moment.
    this.#lightDirty = true;
    void (async () => {
      for (const mesh of motes) {
        try {
          await mesh.material?.forceCompilationAsync(mesh, { useInstances: true });
        } catch {
          // Compiled on first draw instead, as before.
        }
        if (scene.isDisposed) return;
      }
      try {
        await this.#chestMat.forceCompilationAsync(probe);
      } catch {
        // As above.
      }
      if (scene.isDisposed) return;
      this.#probe = null;
      probe.dispose();
      this.#lightDirty = true;
    })();
    if (!warm) return;
    // The squishies' program compiles, lit by the fill, on the frames that draw it off stage.
    let frames = 0;
    const observer = scene.onAfterRenderObservable.add(() => {
      const drawn = scene.meshes.filter((m) => m.material?.name === SQUISHY_MATERIAL);
      if (++frames < 240 && !(drawn.length > 0 && drawn.every((m) => m.isReady(true)))) return;
      scene.onAfterRenderObservable.remove(observer);
      this.#field.remove(warm);
      this.#lightDirty = true;
    });
  }

  /** Draws the chests of the bonus rooms in `rooms` (ids shown now), open once opened. */
  show(view: CrookedHouseView, rooms: readonly string[]): void {
    this.#view = view;
    const wanted = new Set(rooms);
    for (const [id, chest] of this.#chests) {
      if (wanted.has(id)) continue;
      chest.base.dispose();
      chest.lid.dispose();
      this.#chests.delete(id);
    }
    for (const room of chestRooms()) {
      if (!wanted.has(room.id) || this.#chests.has(room.id)) continue;
      // Kit meshes share the page's buffers; disposing one frees only its own.
      const base = this.#kit('crooked-chest-base', chestBase);
      const lid = this.#kit('crooked-chest-lid', chestLid);
      const p = chestPoint(room);
      base.position.set(p.x, 0, p.z);
      lid.position.set(p.x, CHEST_SIZE.h, p.z + CHEST_SIZE.d / 2);
      this.#chests.set(room.id, { room: room.id, base, lid, opening: null });
    }
    for (const chest of this.#chests.values()) {
      if (chest.opening !== null) continue;
      const r = roomOf(chest.room);
      chest.lid.rotation.x = r && chestOpened(r, view) ? LID_OPEN : 0;
    }
    this.#light();
  }

  /**
   * The soft fill lights the chests and the field's squishies, never the
   * rooms. With nothing to light it's off: an empty `includedOnlyMeshes`
   * would mean every mesh.
   */
  #light(): void {
    const meshes = [
      ...[...this.#chests.values()].flatMap((c) => [c.base, c.lid]),
      ...(this.#probe ? [this.#probe] : []),
      ...this.#scene.meshes.filter((m) => m.material?.name === SQUISHY_MATERIAL),
    ];
    if (meshes.length === 0) {
      // Off first: setting an empty list on a live light would light everything for a moment.
      this.#fill.setEnabled(false);
      return;
    }
    this.#fill.includedOnlyMeshes = meshes;
    this.#fill.setEnabled(true);
  }

  #sizeOf(handle: SquishyHandle): number {
    return SQUISHY_HEIGHT / Math.max(0.1, this.#field.heightOf(handle));
  }

  /** A chest part on this scene. */
  #kit(name: string, build: () => ReturnType<typeof chestBase>): Mesh {
    const mesh = kitMesh(this.#scene, name, build);
    mesh.material = this.#chestMat;
    return mesh;
  }

  /**
   * A team friend wakes a sleeping door: it pops in beside the Keeper, its
   * element's flourish flies to the door, and `woke` runs as it lands (the
   * door opens then). The friend pops away again after.
   */
  power(
    helper: { id: string; speciesId: string; element: string },
    keeper: FloorPoint,
    door: FloorPoint,
    woke: () => void,
  ): void {
    this.#clearHelper();
    const species = speciesOf(helper.speciesId);
    const toward = unit(door.x - keeper.x, door.z - keeper.z);
    // In front of the Keeper (towards the camera), a little back from the door, so it shows.
    const at = {
      x: keeper.x - toward.x * 0.3,
      z: keeper.z - toward.z * 0.3 - 0.85,
    };
    const now = performance.now();
    const still = this.#options.reducedMotion;
    const wake = now + (still ? TIMING.still : TIMING.popIn + TIMING.flourish) * 1000;
    const fx = POWER_FX[helper.element] ?? OTHER_FX;
    const from = new Vector3(at.x, 0.55, at.z);
    const to = new Vector3(door.x, 1.0, door.z);
    if (species) {
      const yaw = yawTo(at, door);
      const handle = this.#field.add(species, helper.id, { x: at.x, z: at.z, yaw, scale: 0.01 });
      this.#lightDirty = true;
      this.#helper = {
        handle,
        id: helper.id,
        at,
        yaw,
        size: this.#sizeOf(handle),
        start: now,
        wake,
        end: wake + TIMING.popOut * 1000,
        woke,
        door: to,
        fx,
      };
    } else {
      // A species this client doesn't know: the door still wakes.
      this.#helper = null;
      setTimeout(woke, wake - now);
    }
    if (still) {
      // A still glow at the door, no flight.
      this.#burst(fx.colours, to, 6, now, TIMING.still, 'beam', fx.leaf);
      return;
    }
    // It pops in with a ring of sparkles.
    this.#burst(POP_FX, new Vector3(at.x, 0.3, at.z), MOTES.pop, now, TIMING.popIn * 2, 'arc');
    for (let i = 0; i < MOTES.power; i++) {
      const colour = fx.colours[i % fx.colours.length] ?? '#ffffff';
      this.#motes.push({
        source: this.#mote(colour, fx.leaf ?? false),
        from,
        to,
        start: now + (TIMING.popIn + (i / MOTES.power) * TIMING.flourish * 0.6) * 1000,
        life: TIMING.flourish * 0.7,
        path: fx.path,
        phase: i * 2.399,
      });
    }
  }

  /** A chest swings open with a burst of sparkles; a rare friend, if any, hops out. */
  openChest(roomId: string, friend: { speciesId: string; instanceId: string } | null): void {
    const room = roomOf(roomId);
    const chest = this.#chests.get(roomId);
    if (!room) return;
    const now = performance.now();
    const p = chestPoint(room);
    if (chest) {
      chest.opening = this.#options.reducedMotion ? null : now;
      if (this.#options.reducedMotion) chest.lid.rotation.x = LID_OPEN;
    }
    const top = new Vector3(p.x, CHEST_SIZE.h + 0.2, p.z);
    this.#burst(
      CHEST_FX,
      top,
      this.#options.reducedMotion ? 6 : MOTES.chest,
      now + TIMING.lid * 500,
      TIMING.sparkle,
      this.#options.reducedMotion ? 'beam' : 'flicker',
    );
    this.#clearFriend();
    const species = friend ? speciesOf(friend.speciesId) : null;
    if (friend && species) {
      // Out of the chest and onto the floor in front of it (towards the camera).
      const to = { x: p.x + 0.35, z: p.z - CHEST_SIZE.d - 0.45 };
      const still = this.#options.reducedMotion;
      const from = still ? to : { x: p.x, z: p.z };
      this.#lightDirty = true;
      const handle = this.#field.add(species, friend.instanceId, {
        x: from.x,
        z: from.z,
        yaw: 0,
        scale: 0.01,
      });
      const size = this.#sizeOf(handle);
      // Reduced motion: it's simply there, in front of the chest.
      if (still) this.#field.move(handle, { x: to.x, z: to.z, yaw: 0, scale: size });
      this.#friend = {
        handle,
        species: friend.speciesId,
        size,
        landed: still,
        from,
        to,
        start: now + TIMING.lid * 800,
      };
    }
  }

  /** The friend's card closed: it goes (to its battle, or back into the chest's shadows). */
  clearFriend(): void {
    this.#clearFriend();
  }

  #clearFriend(): void {
    if (this.#friend) this.#field.remove(this.#friend.handle);
    this.#friend = null;
    this.#lightDirty = true;
  }

  #clearHelper(): void {
    const h = this.#helper;
    if (!h) return;
    this.#field.remove(h.handle);
    this.#helper = null;
    this.#lightDirty = true;
    // A moment cut short still opens its door.
    h.woke?.();
  }

  /** `count` motes rising out of `at` and fading, from `start` (ms) for `life` s. */
  #burst(
    colours: readonly string[],
    at: Vector3,
    count: number,
    start: number,
    life: number,
    path: Path,
    leaf = false,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = i * 2.399;
      const spread = path === 'beam' ? 0.25 : 0.7;
      this.#motes.push({
        source: this.#mote(colours[i % colours.length] ?? '#ffffff', leaf),
        from: at,
        to: at.add(new Vector3(Math.cos(a) * spread, 0.9 + (i % 3) * 0.25, Math.sin(a) * spread)),
        start: start + (i % 4) * 60,
        life,
        path: path === 'beam' ? 'beam' : 'arc',
        phase: a,
      });
    }
  }

  /** The thin-instanced mesh for motes of `hex` (one glowing kit shape a colour, made once). */
  #mote(hex: string, leaf: boolean): MoteSource {
    const name = `crooked-mote-${leaf ? 'leaf' : 'dot'}-${hex}`;
    let source = this.#moteSources.get(name);
    if (!source) {
      const mesh = kitMesh(
        this.#scene,
        leaf ? 'crooked-leaf-mote' : 'crooked-mote',
        leaf ? leafMote : mote,
      );
      const m = new StandardMaterial(name, this.#scene);
      m.disableLighting = true;
      m.emissiveColor = Color3.FromHexString(hex).toLinearSpace().scale(1.8);
      mesh.material = m;
      const data = new Float32Array(16 * MOTES.perColour);
      mesh.thinInstanceSetBuffer('matrix', data, 16, false);
      mesh.thinInstanceCount = 0;
      mesh.setEnabled(false);
      source = { mesh, data, count: 0 };
      this.#moteSources.set(name, source);
    }
    return source;
  }

  /** Steps every moment; true while anything still moves (keep drawing). */
  step(now: number): boolean {
    let moving = false;
    // The motes: each colour's thin instances, rewritten in place.
    for (const source of this.#moteSources.values()) source.count = 0;
    // Spent motes drop out in place (no array a frame).
    let live = 0;
    for (const m of this.#motes) if (now < m.start + m.life * 1000) this.#motes[live++] = m;
    this.#motes.length = live;
    for (const m of this.#motes) {
      moving = true;
      const t = (now - m.start) / (m.life * 1000);
      const src = m.source;
      if (t < 0 || src.count >= MOTES.perColour) continue;
      placeMote(m, t, src.data, src.count * 16);
      src.count += 1;
    }
    for (const source of this.#moteSources.values()) {
      source.mesh.setEnabled(source.count > 0);
      source.mesh.thinInstanceCount = source.count;
      if (source.count > 0) source.mesh.thinInstanceBufferUpdated('matrix');
    }
    // The chests' lids.
    for (const chest of this.#chests.values()) {
      if (chest.opening === null) continue;
      const t = Math.min(1, (now - chest.opening) / (TIMING.lid * 1000));
      chest.lid.rotation.x = LID_OPEN * backOut(t);
      if (t >= 1) chest.opening = null;
      else moving = true;
    }
    // The team friend: pops in, waits for its flourish, waves, pops away.
    const h = this.#helper;
    if (h) {
      const s = (now - h.start) / 1000;
      if (h.woke && now >= h.wake) {
        const woke = h.woke;
        h.woke = null;
        woke();
        this.#field.play(h.handle, 'bounce', now);
        // The door wakes in its element's colours.
        if (!this.#options.reducedMotion) {
          this.#burst(h.fx.colours, h.door, MOTES.wake, now, 0.9, 'arc', h.fx.leaf);
        }
      }
      if (now >= h.end) {
        this.#field.remove(h.handle);
        this.#helper = null;
        this.#lightDirty = true;
      } else {
        const out = Math.max(0, (now - (h.end - 250)) / 250);
        const grow = this.#options.reducedMotion ? 1 : Math.min(1, s / TIMING.popIn);
        const hop = this.#options.reducedMotion
          ? 0
          : Math.sin(Math.min(1, s / TIMING.popIn) * Math.PI) * 0.5;
        this.#field.move(h.handle, {
          x: h.at.x,
          z: h.at.z,
          lift: hop,
          scale: Math.max(0.01, backOut(grow) * (1 - out) * h.size),
          yaw: h.yaw,
        });
        moving = true;
      }
    }
    // A chest's friend: up out of the chest and down in front of it.
    const f = this.#friend;
    if (f && !f.landed) {
      const t = Math.min(1, Math.max(0, (now - f.start) / (TIMING.hop * 1000)));
      this.#field.move(f.handle, {
        x: f.from.x + (f.to.x - f.from.x) * t,
        z: f.from.z + (f.to.z - f.from.z) * t,
        lift: Math.sin(t * Math.PI) * 1.1 + (1 - t) * CHEST_SIZE.h * 0.5,
        scale: Math.max(0.01, backOut(Math.min(1, t * 2)) * f.size),
        yaw: 0,
      });
      if (t >= 1) {
        // Landed: a happy wobble.
        f.landed = true;
        this.#field.play(f.handle, 'wobble', now);
      }
      moving = true;
    }
    moving = this.#field.update(now) || moving;
    // A squishy came or went: draw again, so the fill's list follows (before that draw).
    if (this.#lightDirty) moving = true;
    return moving;
  }

  get stats(): CrookedBonusFxStats {
    const view = this.#view;
    return {
      chests: [...this.#chests.keys()].map((room) => {
        const r = roomOf(room);
        const at = r ? chestPoint(r) : { x: 0, z: 0 };
        return { room, open: view !== null && r !== null && chestOpened(r, view), ...at };
      }),
      helper: this.#helper?.id ?? null,
      friend: this.#friend?.species ?? null,
      motes: this.#motes.length,
    };
  }
}

const SPECIES = new Map<string, Species>(GAME_DATA.species.map((s) => [s.id, s]));
const speciesOf = (id: string): Species | null => SPECIES.get(id) ?? null;

function unit(x: number, z: number): FloorPoint {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}

/** Yaw 0 faces −z (the camera); this faces from `a` to `b`. */
function yawTo(a: FloorPoint, b: FloorPoint): number {
  return Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

/** Ease out with a little overshoot (a pop). */
function backOut(t: number): number {
  const c = 1.7;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

const MOTE_AT = new Vector3();
const MOTE_SIZE = new Vector3();
const MOTE_TURN = new Quaternion();
const MOTE_MATRIX = new Matrix();

/** A mote's matrix at `t` (0–1) along its path, written into `out` at `offset`. */
function placeMote(m: Mote, t: number, out: Float32Array, offset: number): void {
  const p = Vector3.LerpToRef(m.from, m.to, t, MOTE_AT);
  const swell = Math.sin(t * Math.PI);
  let turn = 0;
  if (m.path === 'arc') p.y += swell * 0.8;
  else if (m.path === 'flicker') {
    p.y += swell * 0.5 + Math.sin(t * 20 + m.phase) * 0.06;
    p.x += Math.sin(t * 13 + m.phase) * 0.08;
  } else if (m.path === 'twirl') {
    const r = swell * 0.45;
    p.x += Math.cos(t * 9 + m.phase) * r;
    p.z += Math.sin(t * 9 + m.phase) * r;
    p.y += swell * 0.3;
    turn = t * 6 + m.phase;
  }
  MOTE_SIZE.setAll(Math.max(0.001, swell * (m.path === 'beam' ? 1.3 : 1)));
  Quaternion.RotationYawPitchRollToRef(turn, 0, 0, MOTE_TURN);
  Matrix.ComposeToRef(MOTE_SIZE, MOTE_TURN, p, MOTE_MATRIX);
  MOTE_MATRIX.copyToArray(out, offset);
}
