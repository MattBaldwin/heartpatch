import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Scene } from '@babylonjs/core/scene';
import { GAME_DATA, visualRegistry, type PublicSearchSpot, type WorldPoint } from '@heartpatch/shared';
import { merged, overlayMaterial, painted, placeAt, setInstances } from '../map/map-scene.js';
import { linear } from '../map/map-props.js';
import { JOY_DISCS, type HollowedDrain } from '../map/terrain-plugin.js';
import type { SquishyLod } from '../procedural/config.js';
import { SquishyField, type SquishyHandle } from '../procedural/squishy-field.js';
import type { HollowedShow } from './hollowed-preview.js';

/*
 * PROTOTYPE (#306 plan): what a Hollowed tile adds to the explore scene.
 * - Joy sparks: every searched spot owns a joy disc in the shared drain
 *   (terrain-plugin.ts) that grows and colours the land back in; a burst of
 *   sparks (one thin-instanced mesh, one draw call while it plays) rises
 *   from the spot.
 * - An echo: a shadow-look squishy (the rescue guardians' look, no extra
 *   material) drifting on a slow loop, with a soft dark disc for its spook
 *   reach. Inside it the Keeper is pushed back a step (`spook`).
 * - A broken music box (the memory puzzle's prop) and a cellar door, as
 *   small merged props on the spots' own material (two draw calls).
 */

export interface HollowedExploreContext {
  readonly size: number;
  readonly world: (p: WorldPoint) => WorldPoint;
  readonly groundAt: (p: WorldPoint) => number;
  readonly spots: readonly PublicSearchSpot[];
  readonly propMaterial: PBRMaterial;
  readonly lod: SquishyLod;
  readonly show: HollowedShow;
  /** The cellar: lantern-lit, nothing drained, no echo. */
  readonly cellar: boolean;
  /** The mockup's `show=sparks`: the spot whose burst is frozen mid-flight. */
  readonly burstAt?: number;
}

interface JoyDisc {
  x: number;
  z: number;
  since: number;
  /** The mockup's frozen share of the opening (`show=sparks`), else null. */
  frozen: number | null;
}

/** Joy disc radius (tile-local) and how long it takes to open, ms. TUNE. */
const JOY = { radius: 0.24, growMs: 900, sparks: 16, burstMs: 1300, rise: 1.6 };
/** The echo's loop (tile-local) and its spook reach. TUNE. */
const ECHO = { orbit: 0.16, periodMs: 11_000, reach: 0.11, push: 0.07, hover: 0.05, scale: 0.42 };

export class HollowedExplore {
  readonly #scene: Scene;
  readonly #ctx: HollowedExploreContext;
  readonly #drain: HollowedDrain;
  readonly #discs: JoyDisc[] = [];
  readonly #sparks: Mesh;
  #burst: { x: number; z: number; y: number; since: number; frozen: number | null } | null = null;
  readonly #echoes: SquishyField | null;
  #echo: SquishyHandle | null = null;
  readonly #echoCentre: WorldPoint;
  #echoAt: WorldPoint;
  readonly #echoDisc: Mesh | null;
  readonly #echoFrozen: boolean;
  #spooked = 0;
  #start: number | null = null;

  constructor(scene: Scene, drain: HollowedDrain, ctx: HollowedExploreContext) {
    this.#scene = scene;
    this.#ctx = ctx;
    this.#drain = drain;
    drain.amount = ctx.cellar ? 0 : 1;
    drain.count = 0;

    // Sparks: little warm octahedra, unlit.
    const spark = CreateIcoSphere('hollowed-spark', { radius: 0.17, subdivisions: 1, flat: true }, scene);
    painted(spark, '#ffd36b');
    const mat = overlayMaterial(scene, 'hollowed-spark-mat');
    mat.emissiveColor = linear('#ffe9a8');
    spark.material = mat;
    spark.isPickable = false;
    this.#sparks = spark;
    setInstances(spark, [], true);

    // The echo (not in the cellar): a Nookling in the shadow look.
    const species = GAME_DATA.species.find((s) => s.id === 'nookling');
    const open = ctx.spots.filter((s) => !s.done);
    // Its loop sits over the tile's far half, clear of the start.
    this.#echoCentre = ctx.show === 'echo' ? { x: 0.17, z: -0.3 } : { x: -0.08, z: 0.25 };
    this.#echoAt = this.#echoCentre;
    this.#echoFrozen = ctx.show === 'echo';
    if (!ctx.cellar && species) {
      this.#echoes = new SquishyField(scene, {
        registry: visualRegistry(GAME_DATA),
        lod: ctx.lod,
        breathing: false,
        shadows: false,
      });
      const at = this.#echoWorld(0);
      this.#echo = this.#echoes.add(species, 'echo-1', { ...at, yaw: Math.PI, scale: ECHO.scale }, 'shadow');
      const disc = CreateDisc('hollowed-echo-reach', { radius: 1, tessellation: 40 }, scene);
      disc.rotation.x = Math.PI / 2;
      disc.bakeCurrentTransformIntoVertices();
      const dm = overlayMaterial(scene, 'hollowed-echo-reach-mat');
      dm.emissiveColor = Color3.FromHexString('#2a1f3d').toLinearSpace();
      dm.alpha = 0.22;
      disc.material = dm;
      disc.isPickable = false;
      const r = ECHO.reach * ctx.size;
      disc.scaling.set(r, 1, r);
      this.#echoDisc = disc;
      this.#placeEcho(0);
    } else {
      this.#echoes = null;
      this.#echoDisc = null;
    }

    // The broken music box on the first spot searched by hand, and the cellar door on the second.
    const hands = open.filter((s) => s.tool === null);
    const box = hands[0];
    if (box && !ctx.cellar) {
      const body = painted(CreateBox('hollowed-box', { width: 0.5, height: 0.3, depth: 0.36 }, scene), '#8a5a3a');
      body.position.y = 0.15;
      const lid = painted(CreateBox('hollowed-lid', { width: 0.5, height: 0.06, depth: 0.36 }, scene), '#b07a4a');
      lid.position.set(0.08, 0.36, -0.1);
      lid.rotation.z = 0.5;
      const crank = painted(CreateCylinder('hollowed-crank', { height: 0.14, diameter: 0.04 }, scene), '#ffc94d');
      crank.position.set(0.3, 0.2, 0);
      crank.rotation.z = Math.PI / 2;
      const ballerina = painted(CreateSphere('hollowed-dancer', { diameter: 0.12, segments: 6 }, scene), '#ff9fb2');
      ballerina.position.set(-0.08, 0.38, 0.02);
      const prop = merged('hollowed-music-box', [body, lid, crank, ballerina]);
      prop.material = ctx.propMaterial;
      prop.isPickable = false;
      const at = ctx.world(box);
      const turn = Quaternion.RotationYawPitchRoll(0.6, 0, 0);
      setInstances(prop, [placeAt(at.x + 0.55, ctx.groundAt(box), at.z - 0.2, new Vector3(1, 1, 1), turn)]);
    }
    if (ctx.cellar) {
      // The cellar's chest: the better loot, on the first spot, with the spots' own glint.
      const chest = open[0] ?? ctx.spots[0];
      if (chest) {
        const body = painted(CreateBox('hollowed-chest', { width: 0.7, height: 0.42, depth: 0.5 }, scene), '#8a5a3a');
        body.position.y = 0.21;
        const lid = painted(CreateCylinder('hollowed-chest-lid', { height: 0.7, diameter: 0.5, tessellation: 12 }, scene), '#a8703f');
        lid.rotation.z = Math.PI / 2;
        lid.position.y = 0.42;
        lid.scaling.y = 1;
        const band = painted(CreateBox('hollowed-chest-band', { width: 0.74, height: 0.1, depth: 0.54 }, scene), '#ffc94d');
        band.position.y = 0.3;
        const lock = painted(CreateSphere('hollowed-chest-lock', { diameter: 0.14, segments: 6 }, scene), '#ffe08a');
        lock.position.set(0, 0.36, 0.27);
        const prop = merged('hollowed-chest', [body, lid, band, lock]);
        prop.material = ctx.propMaterial;
        prop.isPickable = false;
        const at = ctx.world(chest);
        setInstances(prop, [placeAt(at.x, ctx.groundAt(chest), at.z, new Vector3(1, 1, 1), Quaternion.RotationYawPitchRoll(0.4, 0, 0))]);
      }
    }
    const door = hands[1];
    if (door && !ctx.cellar) {
      const slab = painted(CreateBox('hollowed-door', { width: 0.9, height: 0.08, depth: 0.7 }, scene), '#5a4a3a');
      slab.position.y = 0.04;
      const ring = painted(CreateCylinder('hollowed-ring', { height: 0.04, diameter: 0.16 }, scene), '#c9c0b2');
      ring.position.set(0.25, 0.1, 0);
      const prop = merged('hollowed-cellar-door', [slab, ring]);
      prop.material = ctx.propMaterial;
      prop.isPickable = false;
      const at = ctx.world(door);
      setInstances(prop, [placeAt(at.x - 0.6, ctx.groundAt(door) + 0.02, at.z + 0.3, new Vector3(1, 1, 1), Quaternion.RotationYawPitchRoll(-0.4, 0, 0))]);
    }

    // The mockup's `show=sparks`: three spots already coloured in, one burst mid-flight.
    if (ctx.show === 'sparks') {
      const done = ctx.spots.filter((s) => s.done);
      const burst = done.find((s) => s.index === ctx.burstAt) ?? done[done.length - 1];
      done.forEach((s) => this.#discs.push({ ...s, since: 0, frozen: s === burst ? 0.55 : 1 }));
      const last = burst;
      if (last) {
        const at = ctx.world(last);
        this.#burst = { x: at.x, z: at.z, y: ctx.groundAt(last), since: 0, frozen: 0.42 };
      }
      this.#writeDiscs(0);
      this.#writeSparks(0);
    }
  }

  /** Where the echo stands at `t` ms, tile-local. */
  #echoLocal(t: number): WorldPoint {
    if (this.#echoFrozen) return { x: this.#echoCentre.x, z: this.#echoCentre.z };
    const a = (t / ECHO.periodMs) * Math.PI * 2;
    return { x: this.#echoCentre.x + Math.cos(a) * ECHO.orbit, z: this.#echoCentre.z + Math.sin(a) * ECHO.orbit * 0.6 };
  }

  #echoWorld(t: number): { x: number; y: number; z: number; yaw: number } {
    const p = this.#echoLocal(t);
    const at = this.#ctx.world(p);
    const ahead = this.#echoLocal(t + 200);
    const yaw = Math.atan2(ahead.x - p.x, -(ahead.z - p.z)) + Math.PI;
    return { x: at.x, y: this.#ctx.groundAt(p) + ECHO.hover + 0.03 * Math.sin(t / 700), z: at.z, yaw };
  }

  #placeEcho(t: number): void {
    if (!this.#echoes || !this.#echo || !this.#echoDisc) return;
    const w = this.#echoWorld(t);
    this.#echoAt = this.#echoLocal(t);
    this.#echoes.move(this.#echo, { x: w.x, z: w.z, y: w.y, yaw: w.yaw, scale: ECHO.scale });
    this.#echoDisc.position.set(w.x, this.#ctx.groundAt(this.#echoAt) + 0.03, w.z);
  }

  /** A spot was searched: its joy disc opens and sparks rise. */
  searched(spot: PublicSearchSpot, now: number): void {
    const at = this.#ctx.world(spot);
    this.#discs.push({ x: spot.x, z: spot.z, since: now, frozen: null });
    this.#burst = { x: at.x, z: at.z, y: this.#ctx.groundAt(spot), since: now, frozen: null };
  }

  #writeDiscs(now: number): boolean {
    let live = false;
    const n = Math.min(JOY_DISCS, this.#discs.length);
    for (let i = 0; i < n; i++) {
      const d = this.#discs[this.#discs.length - n + i] as JoyDisc;
      let k = d.frozen ?? Math.min(1, (now - d.since) / JOY.growMs);
      if (d.frozen === null && k < 1) live = true;
      k = 1 - (1 - k) * (1 - k);
      const at = this.#ctx.world(d);
      this.#drain.setDisc(i, at.x, at.z, JOY.radius * this.#ctx.size * k, Math.min(1, k * 1.4));
    }
    this.#drain.count = n;
    return live;
  }

  #writeSparks(now: number): boolean {
    const b = this.#burst;
    if (!b) {
      if (this.#sparks.thinInstanceCount > 0) setInstances(this.#sparks, [], true);
      return false;
    }
    const t = b.frozen ?? (now - b.since) / JOY.burstMs;
    if (t >= 1) {
      this.#burst = null;
      setInstances(this.#sparks, [], true);
      return false;
    }
    const ms: Matrix[] = [];
    for (let i = 0; i < JOY.sparks; i++) {
      const a = (i / JOY.sparks) * Math.PI * 2 + 0.3;
      const r = 0.25 + 0.75 * ((i * 7) % 5) / 5;
      const dx = Math.cos(a) * r * t * 1.6;
      const dz = Math.sin(a) * r * t * 1.6;
      const y = b.y + JOY.rise * (t * (2 - t)) * (0.6 + 0.4 * ((i * 3) % 4) / 4) + 0.12;
      const s = (0.6 + 0.4 * ((i * 5) % 3) / 3) * Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.1));
      ms.push(placeAt(b.x + dx, y, b.z + dz, new Vector3(s, s, s), Quaternion.RotationYawPitchRoll(a, t * 3, 0)));
    }
    setInstances(this.#sparks, ms, true);
    return b.frozen === null;
  }

  /** Animates the discs, the sparks and the echo. True while something moves. */
  step(now: number): boolean {
    this.#start ??= now;
    const t = now - this.#start;
    const discs = this.#writeDiscs(now);
    const sparks = this.#writeSparks(now);
    if (this.#echoes) {
      this.#placeEcho(t);
      this.#echoes.update(now);
    }
    return discs || sparks || (this.#echoes !== null && !this.#echoFrozen);
  }

  /**
   * The Keeper stepped inside the echo's reach: where it's spooked back to
   * (tile-local), or null. Never hurts; one step, and a line on the screen.
   */
  spook(keeper: WorldPoint, now: number): WorldPoint | null {
    if (!this.#echoes || now - this.#spooked < 1500) return null;
    const dx = keeper.x - this.#echoAt.x;
    const dz = keeper.z - this.#echoAt.z;
    const d = Math.hypot(dx, dz);
    if (d > ECHO.reach) return null;
    this.#spooked = now;
    const k = (ECHO.push + (ECHO.reach - d)) / Math.max(d, 1e-3);
    return { x: keeper.x + dx * k, z: keeper.z + dz * k };
  }

  /** Where the echo is now (tile-local), for the mockup's placement. */
  get echoAt(): WorldPoint {
    return this.#echoAt;
  }

  get stats(): { discs: number; sparks: number; echoes: number } {
    return { discs: this.#drain.count, sparks: this.#sparks.thinInstanceCount, echoes: this.#echo ? 1 : 0 };
  }

  dispose(): void {
    this.#echoes?.dispose();
    this.#sparks.dispose();
    this.#echoDisc?.dispose();
    void this.#scene;
  }
}
