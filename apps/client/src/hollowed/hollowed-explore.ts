import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { HollowedPuzzle, PublicSearchSpot, WorldPoint } from '@heartpatch/shared';
import { EXPLORE_CAMERA, EXPLORE_VIEW } from '../explore/explore-config.js';
import { disc, kitMesh, merged, type Part, uvSphere } from '../explore/kit-mesh.js';
import { overlayMaterial } from '../map/map-scene.js';
import { JOY_DISCS, type HollowedDrain } from '../map/terrain-plugin.js';
import { HOLLOWED_EXPLORE } from './hollowed-config.js';
import {
  discOpening,
  echoAt,
  PUZZLE_INDEX,
  sparkAt,
  spookPush,
  spookReach,
} from './hollowed-explore-view.js';
import { buildPuzzleProp, type PuzzleProp } from './puzzle-props.js';

/*
 * What a grey village tile adds to the explore scene (#306 2a):
 * - The drain: the land, its growth and the spots go grey (the terrain
 *   plugin's `drain`, attached by the scene); each spot searched today owns
 *   a joy disc that colours the land back round it, and once every spot is
 *   searched the whole tile eases back to colour. Uniforms only.
 * - Joy sparks: a burst from the spot just searched, one thin-instanced mesh
 *   (one draw call while it plays, none otherwise), built and compiled with
 *   the scene, so a find compiles nothing (#555, #569).
 * - Hollow echoes: one merged mesh each in the shadow look with its soft
 *   dark shadow baked in (one draw call), drifting on ambient time (still
 *   when ambient life is off). Inside its reach the Keeper is nudged back.
 * - The memory puzzle's broken thing (PR 2b): one merged mesh, grey with
 *   the drain; mended, it swaps for its coloured look (one mesh shown, one
 *   draw call), opens a joy disc round it and bursts into sparks.
 * Nothing here is sent anywhere: the server's `done` flags and echo points
 * drive it, so two devices agree.
 */

export interface HollowedSceneContext {
  /** Tile-local to world (x, z). */
  readonly world: (p: WorldPoint) => WorldPoint;
  /** The ground's height under a tile-local point, world units. */
  readonly groundAt: (p: WorldPoint) => number;
  /** The tile's size up close (corner to middle, world units). */
  readonly size: number;
  /** Where each echo drifts, tile-local (`HollowedExplore.echoes`). */
  readonly echoes: readonly WorldPoint[];
  /** The tile's memory puzzle (PR 2b), and the land's prop material its broken thing stands in. */
  readonly puzzle?: HollowedPuzzle;
  readonly propMaterial?: Material;
}

/** Read-only numbers for the dev hook (Playwright asserts on these). */
export interface HollowedStats {
  /** How grey the tile is now, 0–1. */
  readonly drain: number;
  /** Joy discs the shader reads. */
  readonly discs: number;
  /** Sparks in the air (0 between bursts). */
  readonly sparks: number;
  /** Spark bursts played since the tile opened (one a find). */
  readonly bursts: number;
  readonly echoes: number;
  /** Where each echo is now, tile-local. */
  readonly echoAt: readonly WorldPoint[];
  /** The broken thing's look (PR 2b), or null on a tile with none. */
  readonly puzzle: 'broken' | 'fixed' | null;
}

interface Disc {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  /** When it started opening (ms), or null if it was searched before the tile opened. */
  readonly since: number | null;
}

// Scratch (no allocations per frame for the sparks and echoes).
const SPARK = { dx: 0, dy: 0, dz: 0, s: 0, a: 0 };
const SPARK_TURN = new Quaternion();
const SPARK_SCALE = new Vector3();
const SPARK_AT = new Vector3();
const SPARK_WORLD = new Matrix();
const ECHO_LOCAL = { x: 0, z: 0 };

export class HollowedExplore {
  readonly #ctx: HollowedSceneContext;
  readonly #drain: HollowedDrain;
  #discs: Disc[] = [];
  /** The drain's fade to colour once every spot is searched: from, to and when it started. */
  #fade: { from: number; to: number; since: number } | null = null;
  readonly #sparks: Mesh;
  readonly #sparkMatrices: Float32Array;
  #burst: { x: number; y: number; z: number; since: number } | null = null;
  #bursts = 0;
  /** Every disc has opened and is written: `step` leaves them be. */
  #discsSettled = false;
  readonly #echoes: {
    readonly mesh: Mesh;
    readonly centre: WorldPoint;
    readonly at: { x: number; z: number };
  }[];
  /** The memory puzzle's broken thing (PR 2b), where it stands, and whether it's mended. */
  readonly #puzzle: (PuzzleProp & { readonly at: WorldPoint; mended: boolean }) | null = null;
  /** When the tile opened, and the Keeper was last spooked (ms). */
  #openedAt: number | null = null;
  #spookedAt = -Infinity;

  constructor(
    scene: Scene,
    drain: HollowedDrain,
    ctx: HollowedSceneContext,
    spots: readonly PublicSearchSpot[],
  ) {
    this.#ctx = ctx;
    this.#drain = drain;

    // Sparks: little warm glints (the finds' own star, so kids know them),
    // unlit, lent their full count of places at once so the scene's prewarm
    // compiles the instanced program (#501 D1).
    const { count } = HOLLOWED_EXPLORE.sparks;
    const sparks = kitMesh(scene, 'hollowed-spark', sparkShape);
    sparks.hasVertexAlpha = true;
    sparks.material = overlayMaterial(scene, 'hollowed-spark-mat');
    // Drawn wherever the burst is (its own bounds sit at the tile's middle);
    // it's disabled between bursts, so idle frames skip it anyway.
    sparks.alwaysSelectAsActiveMesh = true;
    this.#sparkMatrices = new Float32Array(count * 16);
    sparks.thinInstanceSetBuffer('matrix', this.#sparkMatrices, 16, false);
    sparks.setEnabled(false);
    this.#sparks = sparks;

    // Echoes: one merged mesh each, on one shared material.
    const echoMat = overlayMaterial(scene, 'hollowed-echo-mat');
    this.#echoes = ctx.echoes.map((centre, i) => {
      const mesh = kitMesh(scene, 'hollowed-echo', echoShape);
      mesh.name = `hollowed-echo-${String(i)}`;
      mesh.material = echoMat;
      mesh.hasVertexAlpha = true;
      return { mesh, centre, at: { ...centre } };
    });
    this.#placeEchoes(0);

    const puzzle = ctx.puzzle;
    if (puzzle && ctx.propMaterial) {
      const prop = buildPuzzleProp(scene, puzzle.skin, ctx.propMaterial);
      const world = ctx.world(puzzle);
      // Turned a little off the camera, by where it stands, so it reads as a thing, not a sign.
      const turn = 0.35 * Math.sin(puzzle.x * 12.9898 + puzzle.z * 78.233);
      for (const mesh of [prop.broken, prop.fixed]) {
        mesh.position.set(world.x, ctx.groundAt(puzzle), world.z);
        mesh.rotation.y = turn;
      }
      this.#puzzle = { ...prop, at: { x: puzzle.x, z: puzzle.z }, mended: false };
    }
    this.update(spots, null, puzzle);
  }

  /**
   * A fresh view of the tile: spots newly searched open a disc (and the
   * newest one bursts into sparks); a refill (a new morning) closes them.
   * `now` null: the tile just opened, so what's searched is already open.
   */
  update(
    spots: readonly PublicSearchSpot[],
    now: number | null,
    puzzle?: Pick<HollowedPuzzle, 'solved'>,
  ): void {
    const done = spots.filter((s) => s.done);
    const had = new Set(this.#discs.map((d) => d.index));
    // The mended thing's disc stays: it isn't a spot, and it never refills.
    this.#discs = this.#discs.filter(
      (d) => d.index === PUZZLE_INDEX || done.some((s) => s.index === d.index),
    );
    let newest: WorldPoint | null = null;
    for (const s of done) {
      if (had.has(s.index)) continue;
      this.#discs.push({ index: s.index, x: s.x, z: s.z, since: now });
      newest = s;
    }
    const prop = this.#puzzle;
    if (prop && puzzle?.solved && !prop.mended) {
      prop.mended = true;
      this.#discs.push({ index: PUZZLE_INDEX, x: prop.at.x, z: prop.at.z, since: now });
      newest = prop.at;
    }
    if (prop) {
      prop.broken.setEnabled(!prop.mended);
      prop.fixed.setEnabled(prop.mended);
    }
    if (newest && now !== null) {
      const at = this.#ctx.world(newest);
      this.#burst = { x: at.x, y: this.#ctx.groundAt(newest), z: at.z, since: now };
      this.#bursts++;
      this.#sparks.setEnabled(true);
    }
    const all = spots.length > 0 && done.length === spots.length;
    const target = all ? 0 : 1;
    if (now === null) {
      this.#drain.amount = target;
      this.#fade = null;
    } else if (target !== (this.#fade?.to ?? this.#drain.amount)) {
      this.#fade = { from: this.#drain.amount, to: target, since: now };
    }
    this.#discsSettled = !this.#writeDiscs(now ?? 0);
  }

  /** Grows the discs, flies the sparks and fades the drain; true while any of it still moves. */
  step(now: number): boolean {
    this.#openedAt ??= now;
    // Once every disc is open they stay as written: nothing to redo each frame.
    const discs = !this.#discsSettled && this.#writeDiscs(now);
    if (!discs) this.#discsSettled = true;
    const sparks = this.#writeSparks(now);
    let fading = false;
    if (this.#fade) {
      const k = Math.min(1, (now - this.#fade.since) / HOLLOWED_EXPLORE.drainFadeMs);
      this.#drain.amount = this.#fade.from + (this.#fade.to - this.#fade.from) * k;
      if (k >= 1) this.#fade = null;
      else fading = true;
    }
    return discs || sparks || fading;
  }

  /** Ambient time moved (seconds): the echoes drift on it (still while ambient life is off). */
  drift(seconds: number): void {
    this.#placeEchoes(seconds);
  }

  /**
   * The Keeper is at `keeper` (tile-local): where an echo nudges it back to,
   * or null. Not in the first moments after arriving, nor again straight away.
   */
  spook(
    keeper: WorldPoint,
    now: number,
    lantern: boolean,
  ): { to: WorldPoint; echo: WorldPoint } | null {
    const { cooldownMs, graceMs } = HOLLOWED_EXPLORE.echo;
    const opened = this.#openedAt ?? now;
    if (now - opened < graceMs || now - this.#spookedAt < cooldownMs) return null;
    const reach = spookReach(lantern);
    for (const echo of this.#echoes) {
      const to = spookPush(keeper, echo.at, reach);
      if (to) {
        this.#spookedAt = now;
        return { to, echo: { ...echo.at } };
      }
    }
    return null;
  }

  get stats(): HollowedStats {
    return {
      drain: this.#drain.amount,
      discs: this.#drain.count,
      sparks: this.#sparks.isEnabled() ? this.#sparks.thinInstanceCount : 0,
      bursts: this.#bursts,
      echoes: this.#echoes.length,
      echoAt: this.#echoes.map((e) => ({ ...e.at })),
      puzzle: this.#puzzle ? (this.#puzzle.mended ? 'fixed' : 'broken') : null,
    };
  }

  #placeEchoes(seconds: number): void {
    const { hover } = HOLLOWED_EXPLORE.echo;
    for (const echo of this.#echoes) {
      echoAt(echo.centre, seconds, ECHO_LOCAL);
      const at = echo.at;
      at.x = ECHO_LOCAL.x;
      at.z = ECHO_LOCAL.z;
      // A gentle bob over its own ground; the shadow underneath rides with it.
      const bob = hover * 0.25 * Math.sin(seconds * 1.4);
      const size = this.#ctx.size;
      echo.mesh.position.set(at.x * size, this.#ctx.groundAt(at) + bob, at.z * size);
      // Its face (−z) towards the camera, looking about as it drifts.
      echo.mesh.rotation.y = Math.sin(seconds * 0.5) * 0.6;
    }
  }

  /** Writes the newest discs into the drain; true while one still opens. */
  #writeDiscs(now: number): boolean {
    const { radius } = HOLLOWED_EXPLORE.joy;
    const size = this.#ctx.size;
    const from = Math.max(0, this.#discs.length - JOY_DISCS);
    let opening = false;
    for (let i = from; i < this.#discs.length; i++) {
      const d = this.#discs[i];
      if (!d) continue;
      const k = discOpening(d.since, now);
      if (k < 1) opening = true;
      this.#drain.setDisc(
        i - from,
        d.x * size,
        d.z * size,
        radius * size * k,
        Math.min(1, k * 1.4),
      );
    }
    this.#drain.count = this.#discs.length - from;
    return opening;
  }

  /** Places the burst's sparks; true while it flies. */
  #writeSparks(now: number): boolean {
    const b = this.#burst;
    if (!b) return false;
    const t = (now - b.since) / HOLLOWED_EXPLORE.sparks.burstMs;
    if (t >= 1 || t < 0) {
      this.#burst = null;
      this.#sparks.setEnabled(false);
      return false;
    }
    const { count } = HOLLOWED_EXPLORE.sparks;
    for (let i = 0; i < count; i++) {
      sparkAt(i, t, SPARK);
      // Facing the camera (the shape is tipped to it), twinkling round as it rises.
      Quaternion.RotationYawPitchRollToRef(0, 0, SPARK.a + t * 3, SPARK_TURN);
      Matrix.ComposeToRef(
        SPARK_SCALE.set(SPARK.s, SPARK.s, SPARK.s),
        SPARK_TURN,
        SPARK_AT.set(b.x + SPARK.dx, b.y + SPARK.dy, b.z + SPARK.dz),
        SPARK_WORLD,
      );
      SPARK_WORLD.copyToArray(this.#sparkMatrices, i * 16);
    }
    this.#sparks.thinInstanceBufferUpdated('matrix');
    return true;
  }
}

/** Colours as they show on screen (sRGB): an unlit material draws vertex colours as they are. */
function shown(part: Part, hex: string, alpha: number): Part {
  const c = Color3.FromHexString(hex);
  const colors = new Float32Array(part.getTotalVertices() * 4);
  for (let i = 0; i < colors.length; i += 4) colors.set([c.r, c.g, c.b, alpha], i);
  part.data.colors = colors;
  return part;
}

/**
 * A joy spark, 1 across: a four-point star in a soft glow, like the glints
 * over the spots, stood up and tipped to face the follow camera.
 */
function sparkShape(): Part {
  const diamond = (sx: number, sy: number, z: number, hex: string) => {
    const m = disc({ radius: 0.5, tessellation: 4 });
    m.scaling.set(sx, sy, 1);
    m.position.z = z;
    return shown(m, hex, 1);
  };
  const part = merged([
    shown(disc({ radius: 0.5, tessellation: 16 }), '#fff3c4', 0.4),
    diamond(0.34, 1, -0.01, '#ffd36b'),
    diamond(1, 0.34, -0.01, '#ffd36b'),
    diamond(0.18, 0.56, -0.02, '#fffdf0'),
    diamond(0.56, 0.18, -0.02, '#fffdf0'),
  ]);
  part.rotation.x = EXPLORE_CAMERA.glintTilt;
  return part.bakeCurrentTransformIntoVertices();
}

/**
 * A Hollow echo, in world units (about `echo.height` tall): a little round
 * squishy in the shadow look (the rescue guardians' dark lavender, softly
 * glowing), with soft pale eyes, a faint glow round it and its shadow on the
 * ground. Sweet-spooky, never scary (style guide §5). Vertex colours and
 * alpha on an unlit material: one draw call.
 */
function echoShape(): Part {
  const { height, hover, reach } = HOLLOWED_EXPLORE.echo;
  const h = height;
  const y = hover + h * 0.45;
  const blob = (d: number, at: [number, number, number], k: [number, number, number]) => {
    const m = uvSphere({ diameter: d, segments: 10 });
    m.scaling.set(...k);
    m.position.set(...at);
    return m;
  };
  // The shadow: a soft dark disc on the ground about as wide as its reach.
  const shadow = disc({ radius: reach * EXPLORE_VIEW.hexSize * 0.9, tessellation: 28 });
  shadow.rotation.x = Math.PI / 2;
  shadow.position.y = 0.03;
  const body = '#7d6fa6';
  return merged([
    shown(shadow, '#2a1f3d', 0.18),
    shown(blob(h * 1.3, [0, y, 0], [1, 0.9, 1]), '#cfc3f0', 0.2),
    shown(blob(h, [0, y, 0], [1, 0.88, 0.95]), body, 0.8),
    shown(blob(h * 0.3, [-h * 0.3, y + h * 0.4, 0], [1, 1.1, 0.8]), body, 0.8),
    shown(blob(h * 0.3, [h * 0.3, y + h * 0.4, 0], [1, 1.1, 0.8]), body, 0.8),
    shown(blob(h * 0.15, [-h * 0.17, y + h * 0.06, -h * 0.42], [1, 1.25, 0.6]), '#fffaf0', 1),
    shown(blob(h * 0.15, [h * 0.17, y + h * 0.06, -h * 0.42], [1, 1.25, 0.6]), '#fffaf0', 1),
  ]);
}
