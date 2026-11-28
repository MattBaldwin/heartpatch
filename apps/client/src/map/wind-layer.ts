import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import { hexToWorld, isWaterTerrain, type MapView, type PublicTile } from '@heartpatch/shared';
import { hexDisc } from '../roads/road-field.js';
import { el } from '../ui/dom.js';
import type { MeshArrays } from './hex-mesh.js';
import { HEX_SIZE } from './map-config.js';
import {
  DOME,
  meshFrom,
  overlayMaterial,
  placeAt,
  setInstances,
  TILE_RADIUS,
  topOf,
} from './map-scene.js';
import type { MapLayer, MapLayerHost } from './map-screen.js';
import type { TerrainClock } from './terrain-plugin.js';
import './wind.css';

// A Clockwork Isle's wind (#874 C4, mockup M1 "m1-wind-three-strengths"):
// a soft blue wash on every land tile and a double arrow over it, both
// stronger the windier the tile ("Little breeze, good breeze, big brrr!").
// Wind comes only from `PublicTile.wind` (1–3 on land, from the seed); water
// has none. One arrow mesh and one wash mesh, thin-instanced, so the whole
// isle's wind is two draw calls, and none while it's hidden (CLAUDE.md
// rule 8). The arrows drift downwind in the vertex shader off the terrain
// clock, so no JS runs per frame; under reduced motion, a low tier or
// WebGPU (the plugin is GLSL only) they stand still. A 💨 chip in the top
// bar shows and hides it, as the approved frames do.

/** Player-facing text (style guide: cozy, short, kid-readable). */
export const WIND_TEXT = {
  chip: '💨',
  show: 'Show the wind',
  hide: 'Hide the wind',
} as const;

/** The look by strength (index 0 is wind 1). TUNE: all of it. */
export const WIND_LOOK = {
  /** The arrows' colour and opacity (sRGB 0–1, alpha). */
  arrow: [
    [0.62, 0.84, 0.97, 0.35],
    [0.4, 0.72, 0.96, 0.6],
    [0.22, 0.55, 0.93, 0.9],
  ],
  /** The wash over the tile: a cool blue, deeper with the wind. */
  wash: [
    [0.66, 0.86, 0.98, 0.1],
    [0.5, 0.78, 0.98, 0.2],
    [0.36, 0.66, 0.97, 0.32],
  ],
  /** Arrow size by strength (a big brrr has a big arrow). */
  scale: [0.7, 0.9, 1.15],
  /** The way the wind blows (radians about the up axis, Babylon yaw): towards the far right. */
  yaw: -0.3,
  /** How far an arrow drifts in one loop, in tiles' widths. */
  range: 0.55,
  /** Loops per second at each strength. */
  speed: [0.12, 0.2, 0.3],
  /** Over the tile's top, under the tallest props. */
  lift: 0.16,
} as const satisfies {
  arrow: readonly (readonly [number, number, number, number])[];
  wash: readonly (readonly [number, number, number, number])[];
  scale: readonly number[];
  yaw: number;
  range: number;
  speed: readonly number[];
  lift: number;
};

/** A tile's wind, 1–3, or null for none (water, a Cozy or Wild tile). */
export function windOf(tile: Pick<PublicTile, 'wind' | 'terrain'>): 1 | 2 | 3 | null {
  if (tile.wind === undefined || isWaterTerrain(tile.terrain)) return null;
  return Math.max(1, Math.min(3, Math.round(tile.wind))) as 1 | 2 | 3;
}

/** One tile's wind as the layer draws it. */
export interface WindSpot {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly strength: 1 | 2 | 3;
  /** Where in its drift loop this tile's arrow starts (0–1), so they don't march in step. */
  readonly phase: number;
}

/** A tile's own drift phase (0–1): the same every time for the same tile. */
export function windPhase(q: number, r: number): number {
  const h = Math.sin(q * 127.1 + r * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/** Every windy land tile of the view, where its arrow and wash go. */
export function windSpots(tiles: readonly PublicTile[]): WindSpot[] {
  return tiles.flatMap((tile) => {
    const strength = windOf(tile);
    if (strength === null) return [];
    const p = hexToWorld(tile, HEX_SIZE);
    return [{ x: p.x, z: p.z, y: topOf(tile), strength, phase: windPhase(tile.q, tile.r) }];
  });
}

/** Does this view have any wind to show (a Clockwork Isle)? */
export function hasWind(view: Pick<MapView, 'map' | 'tiles'>): boolean {
  return view.map.patchType === 'clockwork-isle' && view.tiles.some((t) => windOf(t) !== null);
}

/**
 * The arrow: two long arrows side by side ("⇉", mockup M1), pointing along
 * +x on y = 0, about one unit long, white (each instance's tint is its
 * colour). Drawn from both sides (no culling), so winding doesn't matter.
 */
export function arrowArrays(): MeshArrays & { colors: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const shaft = 0.035; // TUNE: half the shaft's width
  const head = 0.11; // TUNE: half the head's width
  const tail = -0.5;
  const neck = 0.22;
  const tip = 0.5;
  const vertex = (x: number, z: number): number => {
    positions.push(x, 0, z);
    colors.push(1, 1, 1, 1);
    return positions.length / 3 - 1;
  };
  for (const z of [-0.14, 0.14]) {
    const a = vertex(tail, z - shaft);
    const b = vertex(neck, z - shaft);
    const c = vertex(neck, z + shaft);
    const d = vertex(tail, z + shaft);
    indices.push(a, b, c, a, c, d);
    const h0 = vertex(neck, z - head);
    const h1 = vertex(tip, z);
    const h2 = vertex(neck, z + head);
    indices.push(h0, h1, h2);
  }
  return { positions, indices, colors };
}

/** What the layer draws now (the dev hook and e2e). */
export interface WindStats {
  readonly shown: boolean;
  /** Windy tiles by strength (index 0 is wind 1). */
  readonly tiles: readonly [number, number, number];
  readonly moving: boolean;
}

export interface WindLayer {
  readonly layer: MapLayer;
  /** The top bar's 💨 chip: shows and hides the wind (hidden off a Clockwork Isle). */
  readonly chip: HTMLButtonElement;
  /** Shows or hides the wind (the chip does this). */
  setShown(shown: boolean): void;
  readonly debug: WindStats;
}

export function createWindLayer(): WindLayer {
  let shown = false;
  let view: MapView | null = null;
  let host: MapLayerHost | null = null;
  let meshes: { arrows: Mesh; wash: Mesh } | null = null;
  let counts: [number, number, number] = [0, 0, 0];
  // Moving only while ambient life is live (not under reduced motion or a low tier);
  // the plugin asks as it binds, so nothing runs per frame for it.
  const motion: Motion = { moving: () => host?.mode() === 'live' };

  const chip = el(
    'button',
    {
      type: 'button',
      class: 'wind-chip',
      'data-testid': 'wind-chip',
      'aria-pressed': 'false',
      'aria-label': WIND_TEXT.show,
    },
    el('span', { 'aria-hidden': 'true' }, WIND_TEXT.chip),
  );
  chip.hidden = true;

  function draw(): void {
    const on = view !== null && hasWind(view);
    chip.hidden = !on;
    chip.setAttribute('aria-pressed', String(shown));
    chip.setAttribute('aria-label', shown ? WIND_TEXT.hide : WIND_TEXT.show);
    if (!meshes) return;
    const spots = on && shown && view ? windSpots(view.tiles) : [];
    const next: [number, number, number] = [0, 0, 0];
    const arrows = spots.map((s) => {
      next[s.strength - 1] = (next[s.strength - 1] ?? 0) + 1;
      return arrowMatrix(s, WIND_LOOK.scale[s.strength - 1] ?? 1);
    });
    counts = next;
    const wash = spots.map((s) => placeAt(s.x, s.y + DOME + 0.012, s.z));
    setInstances(meshes.arrows, arrows, true);
    setInstances(meshes.wash, wash, true);
    if (spots.length > 0) {
      const tint = new Float32Array(spots.length * 4);
      const washTint = new Float32Array(spots.length * 4);
      const drift = new Float32Array(spots.length * 2);
      spots.forEach((s, i) => {
        tint.set(WIND_LOOK.arrow[s.strength - 1] ?? WIND_LOOK.arrow[0], i * 4);
        washTint.set(WIND_LOOK.wash[s.strength - 1] ?? WIND_LOOK.wash[0], i * 4);
        drift.set([s.phase, WIND_LOOK.speed[s.strength - 1] ?? 0.2], i * 2);
      });
      meshes.arrows.thinInstanceSetBuffer('color', tint, 4, false);
      meshes.arrows.thinInstanceSetBuffer(DRIFT_ATTRIBUTE, drift, 2, false);
      meshes.wash.thinInstanceSetBuffer('color', washTint, 4, false);
    }
    host?.invalidate();
  }

  chip.addEventListener('click', () => {
    shown = !shown;
    draw();
  });

  const layer: MapLayer = {
    attach: (scene, next, h) => {
      host = h ?? null;
      meshes = buildMeshes(scene, h?.clock ?? null, motion);
      scene.onDisposeObservable.addOnce(() => {
        meshes = null;
        host = null;
      });
      view = next;
      draw();
    },
    update: (next) => {
      view = next;
      draw();
    },
  };

  return {
    layer,
    chip,
    setShown: (on) => {
      shown = on;
      draw();
    },
    get debug() {
      return {
        shown: shown && counts.some((n) => n > 0),
        tiles: [...counts] as [number, number, number],
        moving: motion.moving(),
      };
    },
  };
}

/** An arrow's placement: on the tile, turned downwind, sized by strength. */
function arrowMatrix(s: WindSpot, scale: number) {
  return placeAt(
    s.x,
    s.y + DOME + WIND_LOOK.lift,
    s.z,
    new Vector3(scale * TILE_RADIUS, 1, scale * TILE_RADIUS),
    Quaternion.RotationYawPitchRoll(WIND_LOOK.yaw, 0, 0),
  );
}

function buildMeshes(
  scene: Scene,
  clock: TerrainClock | null,
  motion: Motion,
): { arrows: Mesh; wash: Mesh } {
  const arrows = meshFrom(scene, 'wind-arrows', arrowArrays());
  const arrowMat = overlayMaterial(scene, 'wind-arrow-mat');
  arrowMat.backFaceCulling = false;
  if (clock) attachWindPlugin(arrowMat, clock, motion);
  arrows.material = arrowMat;
  const wash = meshFrom(scene, 'wind-wash', hexDisc(TILE_RADIUS * 0.94, [1, 1, 1, 1]));
  const washMat = overlayMaterial(scene, 'wind-wash-mat');
  washMat.backFaceCulling = false;
  wash.material = washMat;
  arrows.setEnabled(false);
  wash.setEnabled(false);
  return { arrows, wash };
}

/** Whether the arrows drift now (read as the material binds). */
interface Motion {
  readonly moving: () => boolean;
}

/** Per instance: its drift phase and loops per second. */
export const DRIFT_ATTRIBUTE = 'windDrift';

/** Attaches the drift to `material` under GLSL; null under WebGPU (the arrows stand still). */
function attachWindPlugin(
  material: Material,
  clock: TerrainClock,
  motion: Motion,
): WindPlugin | null {
  return material.shaderLanguage === ShaderLanguage.GLSL
    ? new WindPlugin(material, clock, motion)
    : null;
}

/**
 * The arrows' drift: each one slides downwind along its own loop (phase and
 * pace per instance), fading in and out at the ends, from the terrain clock.
 * With `moving` 0 (reduced motion, a low tier) they stand still, whole.
 */
class WindPlugin extends MaterialPluginBase {
  private readonly clock: TerrainClock;
  private readonly motion: Motion;

  constructor(material: Material, clock: TerrainClock, motion: Motion) {
    super(material, 'Wind', 220, { WIND_DRIFT: false });
    this.clock = clock;
    this.motion = motion;
    this._enable(true);
  }

  override getClassName(): string {
    return 'WindPlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override prepareDefines(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh): void {
    defines['WIND_DRIFT'] = mesh.isVerticesDataPresent(DRIFT_ATTRIBUTE);
  }

  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (mesh.isVerticesDataPresent(DRIFT_ATTRIBUTE)) attributes.push(DRIFT_ATTRIBUTE);
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'windTime', size: 1, type: 'float' },
        { name: 'windMotion', size: 4, type: 'vec4' },
      ],
      vertex: 'uniform float windTime;\nuniform vec4 windMotion;',
      fragment: '',
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat('windTime', this.clock.time);
    // x: moving (0/1); y, z: the downwind direction on (x, z); w: how far a loop drifts.
    uniformBuffer.updateFloat4(
      'windMotion',
      this.motion.moving() ? 1 : 0,
      Math.cos(WIND_LOOK.yaw),
      -Math.sin(WIND_LOOK.yaw),
      WIND_LOOK.range * HEX_SIZE * Math.sqrt(3),
    );
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: /* glsl */ `
#ifdef WIND_DRIFT
attribute vec2 windDrift;
varying float vWindFade;
#endif
`,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: /* glsl */ `
#ifdef WIND_DRIFT
{
  float wdT = fract(windTime * windDrift.y + windDrift.x);
  worldPos.xz += windMotion.x * (wdT - 0.5) * windMotion.w * windMotion.yz;
  vWindFade = mix(1.0, sin(3.14159265 * wdT), windMotion.x);
}
#endif
`,
      };
    }
    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: /* glsl */ `
#ifdef WIND_DRIFT
varying float vWindFade;
#endif
`,
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: /* glsl */ `
#ifdef WIND_DRIFT
color.a *= vWindFade;
#endif
`,
      };
    }
    return null;
  }
}
