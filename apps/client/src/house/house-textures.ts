import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

/*
 * The house's few painted textures (#381): the dusk seen through a window,
 * the name sign and a soft round light pool. Each paints a small 2D canvas
 * once at build. Kept apart so the scene's unit tests (a NullEngine, no
 * canvas) can stand in for them, as they do for the contact shadow.
 */

/** The dusk sky in a window pane: violet up high, peach at the horizon, a moon and stars. */
export function duskPaneMaterial(scene: Scene): StandardMaterial {
  const key = 'house-dusk-pane';
  const found = scene.getMaterialByName(key);
  if (found instanceof StandardMaterial) return found;
  const size = 256;
  const tex = new DynamicTexture(key, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#4f4596'); // TUNE: deep dusk violet up high
  g.addColorStop(0.45, '#a46aa6');
  g.addColorStop(0.78, '#f29a86');
  g.addColorStop(1, '#ffc27a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255, 246, 220, 0.95)';
  for (const [x, y, r] of [
    [40, 30, 2.2],
    [96, 52, 1.6],
    [150, 22, 2],
    [210, 60, 1.6],
    [70, 88, 1.3],
    [232, 18, 1.4],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // A crescent moon.
  ctx.beginPath();
  ctx.arc(186, 70, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(194, 64, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // Soft hills along the bottom.
  ctx.fillStyle = '#5c4a6e';
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(0, 214);
  ctx.quadraticCurveTo(60, 190, 120, 210);
  ctx.quadraticCurveTo(190, 228, 256, 200);
  ctx.lineTo(256, size);
  ctx.fill();
  tex.update();
  const m = new StandardMaterial(key, scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.emissiveTexture = tex;
  m.backFaceCulling = false;
  m.fogEnabled = false;
  m.freeze();
  return m;
}

/** The house's name on its sign, as a see-through texture (dark plum letters). */
export function signMaterial(scene: Scene, text: string): StandardMaterial {
  const tex = new DynamicTexture('house-sign-text', { width: 512, height: 128 }, scene, true);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 512, 128);
  let px = 72;
  for (;;) {
    ctx.font = `bold ${String(px)}px "Nunito", "Arial Rounded MT Bold", ui-rounded, sans-serif`;
    if (ctx.measureText(text).width <= 440 || px <= 28) break;
    px -= 4;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#8d3d5a';
  ctx.fillText(text, 256, 68);
  tex.update();
  const m = new StandardMaterial('house-sign-text', scene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.opacityTexture = tex;
  m.disableLighting = true;
  m.backFaceCulling = false;
  return m;
}

/** A white disc fading to clear (alpha by radius, `[at, alpha]` stops), for light pools. */
export function radialTexture(
  scene: Scene,
  name: string,
  stops: readonly (readonly [number, number])[],
): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, a] of stops) g.addColorStop(at, `rgba(255,255,255,${String(a)})`);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.hasAlpha = true;
  tex.update();
  return tex;
}
