import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { linear } from '../map/map-props.js';
import { EXPLORE_SWIM } from './explore-config.js';
import { buildBubble } from './lake-kit.js';
import { WATER_MOTION } from './lake-config.js';

// A few bubbles puffed from the Snorkel's mask on each kick (#399): a fixed
// pool of thin instances (one draw call), rewritten in place while any is
// alive, so a swim allocates nothing.

const SCALE = new Vector3();
const AT = new Vector3();
const M = new Matrix();
const TURN = Quaternion.Identity();

export class SwimBubbles {
  readonly #mesh: Mesh;
  readonly #matrices: Float32Array;
  /** Per bubble: start x, y, z, birth time (ms; −1 free). */
  readonly #state: Float32Array;
  readonly #size: number;
  /** Per bubble: its size, a share of the full size. */
  readonly #sizes: Float32Array;
  #next = 0;
  #alive = 0;
  /** A puff since the last step. */
  #puffed = false;

  constructor(scene: Scene, scale: number) {
    const { pool } = EXPLORE_SWIM.bubbles;
    this.#size = scale;
    const mesh = buildBubble(scene);
    mesh.name = 'swim-bubbles';
    const mat = new StandardMaterial('swim-bubbles-mat', scene);
    mat.disableLighting = true;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.emissiveColor = linear('#f4fdff').scale(WATER_MOTION.glow * 1.3);
    mesh.material = mat;
    // Compiled now, so the first kick doesn't wait on the shader.
    mat.forceCompilation(mesh);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    this.#matrices = new Float32Array(pool * 16);
    this.#state = new Float32Array(pool * 4);
    this.#sizes = new Float32Array(pool).fill(1);
    for (let i = 0; i < pool; i++) this.#state[i * 4 + 3] = -1;
    mesh.thinInstanceSetBuffer('matrix', this.#matrices, 16, false);
    mesh.thinInstanceCount = pool;
    mesh.setEnabled(false);
    this.#mesh = mesh;
  }

  /** Puffs a kick's bubbles at `at` (world units). */
  puff(at: Vector3, now: number): void {
    const { perKick, pool } = EXPLORE_SWIM.bubbles;
    for (let n = 0; n < perKick; n++) {
      const i = this.#next;
      this.#next = (this.#next + 1) % pool;
      const s = this.#state;
      // Spread apart so they never merge into one pill, sizes varied, and
      // a stagger so they leave one after another.
      const { spread, staggerMs, sizes } = EXPLORE_SWIM.bubbles;
      s[i * 4] = at.x + (n - (perKick - 1) / 2) * spread * this.#size;
      s[i * 4 + 1] = at.y + (n % 2) * spread * 0.5 * this.#size;
      s[i * 4 + 2] = at.z + ((n * 2) % 3) * spread * 0.4 * this.#size;
      s[i * 4 + 3] = now + n * staggerMs;
      this.#sizes[i] = sizes[n % sizes.length] ?? 1;
    }
    this.#puffed = true;
    this.#mesh.setEnabled(true);
  }

  /** Places the live bubbles; true while any is still rising. */
  step(now: number): boolean {
    const { pool, lifeMs, rise, size } = EXPLORE_SWIM.bubbles;
    // Nothing puffed or rising: no buffer to rewrite (lower tiers never puff).
    if (this.#alive === 0 && !this.#puffed) return false;
    this.#puffed = false;
    const s = this.#state;
    let alive = 0;
    for (let i = 0; i < pool; i++) {
      const born = s[i * 4 + 3] ?? -1;
      let k = 0;
      if (born >= 0) {
        const t = (now - born) / lifeMs;
        if (t >= 1) s[i * 4 + 3] = -1;
        else {
          alive++;
          if (t >= 0) {
            // Grows as it leaves, wobbles as it climbs, pops at the top.
            k =
              size *
              this.#size *
              (this.#sizes[i] ?? 1) *
              (0.7 + 0.4 * t) *
              (t > 0.85 ? (1 - t) / 0.15 : 1);
            AT.set(
              (s[i * 4] ?? 0) + Math.sin(t * 9 + i) * 0.03 * this.#size,
              (s[i * 4 + 1] ?? 0) + rise * this.#size * t * (0.6 + 0.4 * t),
              s[i * 4 + 2] ?? 0,
            );
          }
        }
      }
      if (k <= 0) AT.set(0, -1000, 0);
      Matrix.ComposeToRef(SCALE.set(k, k, k), TURN, AT, M);
      M.copyToArray(this.#matrices, i * 16);
    }
    this.#mesh.thinInstanceBufferUpdated('matrix');
    if (alive === 0) this.#mesh.setEnabled(false);
    this.#alive = alive;
    return alive > 0;
  }

  get alive(): number {
    return this.#alive;
  }
}
