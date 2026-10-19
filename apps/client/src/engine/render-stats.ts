import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

/** Triangles the meshes picked for the last frame drew, instances counted (#318). */
export function activeTriangles(scene: Scene): number {
  const active = scene.getActiveMeshes();
  let triangles = 0;
  for (let i = 0; i < active.length; i++) {
    const mesh = active.data[i];
    if (!mesh) continue;
    // Instanced meshes (not thin instances) are each picked on their own.
    const copies = mesh instanceof Mesh && mesh.hasThinInstances ? mesh.thinInstanceCount : 1;
    triangles += (mesh.getTotalIndices() / 3) * copies;
  }
  return Math.round(triangles);
}

/** "61 draws · 729k tris", for the dev overlay. */
export function formatRenderStats(drawCalls: number, triangles: number): string {
  return `${String(drawCalls)} draws · ${String(Math.round(triangles / 1000))}k tris`;
}

/** What the badge's second line counts (#501): see `formatResourceStats`. */
export interface ResourceStats {
  /** Our JS per drawn frame (scene.render), averaged over the last second, in ms. */
  readonly jsMs: number;
  readonly meshes: number;
  readonly materials: number;
  readonly textures: number;
  readonly animatables: number;
  /** WebGL objects since this engine's context was first counted, or null on WebGPU. */
  readonly gl: {
    readonly buffersMade: number;
    readonly buffersFreed: number;
    readonly texturesMade: number;
    readonly texturesFreed: number;
    readonly vertexArraysMade: number;
    readonly vertexArraysFreed: number;
    readonly programs: number;
  } | null;
  /** Squishy and Keeper batch uploads since the page opened. */
  readonly batchUploads: number;
  /** The governor's render scale (fraction of the DPR-capped resolution). */
  readonly renderScale: number;
}

/**
 * "js 4.2 ms · 48 mesh · 20 mat · 5 tex · 0 anim · buf +40/-12 · gltex +9/-2 · vao +30/-4 · 27 prog · 6 up · 1.00 scale":
 * the badge's second line (#501), so a count that climbs while a scene only
 * plays shows on a real device.
 */
export function formatResourceStats(s: ResourceStats): string {
  const parts = [
    `js ${s.jsMs.toFixed(1)} ms`,
    `${String(s.meshes)} mesh`,
    `${String(s.materials)} mat`,
    `${String(s.textures)} tex`,
    `${String(s.animatables)} anim`,
  ];
  if (s.gl) {
    parts.push(
      `buf +${String(s.gl.buffersMade)}/-${String(s.gl.buffersFreed)}`,
      `gltex +${String(s.gl.texturesMade)}/-${String(s.gl.texturesFreed)}`,
      `vao +${String(s.gl.vertexArraysMade)}/-${String(s.gl.vertexArraysFreed)}`,
      `${String(s.gl.programs)} prog`,
    );
  }
  parts.push(`${String(s.batchUploads)} up`, `${s.renderScale.toFixed(2)} scale`);
  return parts.join(' · ');
}

/** What the badge's third line counts, page-wide (#501): see `formatPageStats`. */
export interface PageStats {
  /** Live Babylon engines (one is the game; any more draw where the badge can't see). */
  readonly engines: number;
  /** Scene renders per second across every engine (a snapshot renders outside this: `snapshots`). */
  readonly framesPerSecond: number;
  /** Portrait snapshots since the page opened (each one renders the game's engine into a texture). */
  readonly snapshots: number;
  /** Every live render target on every engine (post-process passes, snapshots, shadow maps). */
  readonly targets: readonly {
    readonly width: number;
    readonly height: number;
    readonly samples: number;
  }[];
  readonly canvases: number;
  readonly domNodes: number;
  /** CSS animations and transitions the page is running (the browser composites each one). */
  readonly animations: number;
  /** The bisect flags that are on (`bisectLabel`), or ''. */
  readonly flags: string;
}

/** Render-target sizes shown before the rest are counted as "+N". */
const TARGET_GROUPS = 4;

/**
 * "page · 1 engine · 31 fr/s · 4 snap · rt 3: 1179x2556, 590x1278 ×2 · 1 canvas · 1834 dom · 3 css · nopost":
 * the badge's third line (#501), for work outside the scene the first two
 * lines measure. Sizes are grouped, biggest first; "/4" is 4× MSAA.
 */
export function formatPageStats(s: PageStats): string {
  const groups = new Map<string, { pixels: number; count: number }>();
  for (const t of s.targets) {
    const key = `${String(t.width)}x${String(t.height)}${t.samples > 1 ? `/${String(t.samples)}` : ''}`;
    const group = groups.get(key) ?? { pixels: t.width * t.height * t.samples, count: 0 };
    group.count++;
    groups.set(key, group);
  }
  const sizes = [...groups]
    .sort((a, b) => b[1].pixels - a[1].pixels)
    .map(([key, { count }]) => (count > 1 ? `${key} ×${String(count)}` : key));
  const shown = sizes.slice(0, TARGET_GROUPS);
  if (sizes.length > TARGET_GROUPS) shown.push(`+${String(sizes.length - TARGET_GROUPS)}`);
  const parts = [
    'page',
    `${String(s.engines)} engine${s.engines === 1 ? '' : 's'}`,
    `${String(Math.round(s.framesPerSecond))} fr/s`,
    `${String(s.snapshots)} snap`,
    `rt ${String(s.targets.length)}${shown.length > 0 ? `: ${shown.join(', ')}` : ''}`,
    `${String(s.canvases)} canvas`,
    `${String(s.domNodes)} dom`,
    `${String(s.animations)} css`,
  ];
  if (s.flags) parts.push(s.flags);
  return parts.join(' · ');
}

/**
 * Ambient life on the badge's second line (#501 H): its mode, and "slow" once
 * the judge has switched it off for the visit (a still lake reads as frozen).
 */
export function formatAmbientStatus(s: { readonly mode: string; readonly slow: boolean }): string {
  return `ambient ${s.mode}${s.slow ? ' (slow)' : ''}`;
}
