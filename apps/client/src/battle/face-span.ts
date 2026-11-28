import type { VisualRegistry } from '@heartpatch/shared';
import { surfacePoint } from '../procedural/body-shape.js';
import type { SquishyParams, Vec3 } from '../procedural/params.js';
import { partMatrix } from '../procedural/placement.js';
import type { FacePoint } from './camera-director.js';
import type { Pose } from './choreography.js';

/**
 * Where a squishy's face sits (#868): the lowest and highest edge of its eyes
 * and mouth (or the part that stands in for the mouth, like the rake line's
 * rake bar, `replaces: 'mouth'`), as fractions of its height (`params.height`, hat left out), so a
 * boss fight can keep the face in frame. The face rides the head when the
 * kind has one, else the one-piece body. Null when it has no eyes or mouth
 * (or its body is unknown).
 */
export function faceSpan(
  params: SquishyParams,
  registry: VisualRegistry,
): { low: number; high: number } | null {
  const bodies = registry.bodies;
  const headBody = params.head ? bodies.get(params.head.id) : undefined;
  const body = headBody ?? bodies.get(params.body.id);
  if (!body || !(params.height > 0)) return null;
  const scale = headBody && params.head ? params.head.scale : params.body.scale;
  const base = headBody && params.head ? params.head.offset[1] : params.lift;
  let low = Infinity;
  let high = -Infinity;
  for (const part of params.parts) {
    const mouthLike = registry.parts.get(part.id)?.replaces === 'mouth';
    if (part.slot !== 'eyes' && part.slot !== 'mouth' && !mouthLike) continue;
    for (const p of part.placements) {
      const y = base + surfacePoint(body, p.around, p.up)[1] * scale[1];
      const half = (p.size[1] * scale[1]) / 2;
      low = Math.min(low, y - half);
      high = Math.max(high, y + half);
    }
  }
  if (!Number.isFinite(low)) return null;
  return { low: low / params.height, high: high / params.height };
}

/**
 * The face as drawn in `pose` (#868), written into `out`: a squishy standing
 * at `home`, facing along (`fx`, `fz`), whose face runs from `low` to `high`
 * world units above its feet at rest. Mirrors the scene's rig (`#apply`): the
 * squash scales the height, then the lean tips it about the feet towards
 * (+) or away from the other fighter, then the lift raises it all.
 */
export function posedFace(
  out: FacePoint,
  home: { readonly x: number; readonly z: number },
  fx: number,
  fz: number,
  pose: Pose,
  face: { readonly low: number; readonly high: number },
): FacePoint {
  const s = Math.max(0, pose.scale) * pose.squash;
  const mid = ((face.low + face.high) / 2) * s;
  const cos = Math.cos(pose.lean);
  const ahead = pose.forward + Math.sin(pose.lean) * mid;
  out.x = home.x + fx * ahead + fz * pose.side;
  out.z = home.z + fz * ahead - fx * pose.side;
  out.low = pose.lift + face.low * s * cos;
  out.high = pose.lift + face.high * s * cos;
  return out;
}

/** `faceSpan` in world units above the feet for a squishy drawn at `scale`, or null with no face. */
export function faceAt(
  params: SquishyParams,
  registry: VisualRegistry,
  scale: number,
): { low: number; high: number } | null {
  const span = faceSpan(params, registry);
  if (!span) return null;
  const k = params.height * scale;
  return { low: span.low * k, high: span.high * k };
}

/**
 * How high a squishy's highest part reaches (#190 PR 6b, 5b): a tuft, ears,
 * horns or a crown over its head, as a fraction of its height
 * (`params.height`, which stops at the top of the head), never under 1. Each
 * placement's box as the renderer places it (`partMatrix`), so a tilted part
 * counts only as high as it leans; legs and tails reach down or back.
 */
export function topSpan(params: SquishyParams, registry: VisualRegistry): number {
  if (!(params.height > 0)) return 1;
  const body = registry.bodies.get(params.body.id);
  const headBody = params.head ? registry.bodies.get(params.head.id) : undefined;
  let top = params.height;
  for (const part of params.parts) {
    if (part.surface) continue;
    const onHead = part.host === 'head' && params.head && headBody;
    const host = onHead ? headBody : body;
    if (!host) continue;
    const scale = onHead && params.head ? params.head.scale : params.body.scale;
    const at: Vec3 = onHead && params.head ? params.head.offset : [0, params.lift, 0];
    for (const p of part.placements) {
      const m = partMatrix(host, scale, part, p, at);
      // The unit box's highest corner: the centre plus half of each axis's rise.
      const y =
        (m[13] ?? 0) + 0.5 * (Math.abs(m[1] ?? 0) + Math.abs(m[5] ?? 0) + Math.abs(m[9] ?? 0));
      if (y > top) top = y;
    }
  }
  return top / params.height;
}
