import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { GAME_DATA, visualRegistry } from '@heartpatch/shared';
import { blurredBackdrop } from '../../close-up/backdrop.js';
import { CAMERA_FOV, CAMERA_POSES } from '../../close-up/close-up-config.js';
import { CloseUpScene } from '../../close-up/close-up-scene.js';
import { frameFor } from '../../close-up/close-up-view.js';
import { boot } from '../../engine/boot.js';
import { createRenderer, parseRendererPreference } from '../../engine/renderer.js';
import { pickInitialTier } from '../../engine/quality/tiers.js';
import { mountStage, type Stage } from '../../engine/stage.js';
import { heroLodFor, lodFor } from '../motion.js';
import { SquishyField } from '../squishy-field.js';

/**
 * MOCKUP ONLY (evolution chains plan). `?mode=closeup&species=gustypup&bg=/evo-bg/day.png`
 * draws the real close-up scene (its camera framing, the blurred backdrop
 * made by the real `blurredBackdrop`) with the bottom 40% left for the care
 * card; `?mode=lineup&species=a,b,c` stands a line side by side, nearest
 * size first, on a plain floor. `?tier=high` pins the quality tier.
 */
if (!import.meta.env.DEV) throw new Error('dev only');

const params = new URLSearchParams(window.location.search);
const tier = pickInitialTier(params.get('tier'));
const pin = params.has('tier');
const registry = visualRegistry(GAME_DATA);
const mode = params.get('mode') ?? 'closeup';
const ids = (params.get('species') ?? 'flurrypup').split(',');
const byId = new Map(GAME_DATA.species.map((s) => [s.id, s]));
const CARD = 0.4; // share of the screen the care card covers (TUNE: mock only)

async function loadBackdrop(): Promise<HTMLCanvasElement | null> {
  const url = params.get('bg');
  if (!url) return null;
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')?.drawImage(img, 0, 0);
  return blurredBackdrop(c);
}
const backdrop = mode === 'closeup' ? await loadBackdrop() : null;

// A plain stand-in for the care card (the real one is #19's sheet), with the
// #432 stage line, so the framing matches the real screen.
const STAGES: Record<string, [number, string]> = {
  flurrypup: [1, 'Baby'],
  gustypup: [2, 'Kid'],
  blusterpup: [3, 'Teen'],
  mittenpup: [3, 'Teen'],
  blizzhowl: [4, 'Grown-up'],
  reindoodle: [4, 'Grown-up'],
};
if (mode === 'closeup') {
  const s = byId.get(ids[0] ?? '');
  const [n, word] = STAGES[ids[0] ?? ''] ?? [1, ''];
  const card = document.createElement('div');
  card.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${String(CARD * 100)}vh;background:#fffafc;border-radius:24px 24px 0 0;box-shadow:0 12px 40px rgb(107 75 110 / 18%);font-family:Nunito,ui-rounded,system-ui,sans-serif;color:#4a3150;padding:22px 24px;box-sizing:border-box`;
  const bar = (i: number) =>
    `<span style="flex:1;height:10px;border-radius:999px;background:${i <= n ? '#b8487a' : '#f6dceb'}"></span>`;
  card.innerHTML = `<div style="font-size:22px;font-weight:800">${s?.name ?? ''}</div>
    <div style="font-size:15px;margin-top:6px">Stage ${String(n)} of 4 · ${word}</div>
    <div style="display:flex;gap:6px;margin-top:10px;max-width:320px">${[1, 2, 3, 4].map(bar).join('')}</div>`;
  document.body.append(card);
}

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('missing #game canvas');
let stage: Stage | null = null;
let frames = 0;
let close: CloseUpScene | null = null;
let line: SquishyField | null = null;

await boot(canvas, {
  preference: parseRendererPreference(params.get('renderer')),
  createRenderer,
  freshCanvas: () => canvas,
  mount: (renderer, target) =>
    mountStage(
      renderer,
      target,
      (scene) => {
        if (mode === 'closeup') {
          const species = byId.get(ids[0] ?? '');
          if (!species) throw new Error(`no species ${ids[0]}`);
          close = new CloseUpScene(scene, {
            registry,
            lod: heroLodFor(tier),
            species,
            instanceId: `evo-${species.id}`,
            backdrop,
            breathing: false,
          });
          const view = { width: innerWidth, height: innerHeight, fov: CAMERA_FOV };
          const framed = frameFor(CAMERA_POSES.face, close.height, view, innerHeight * (1 - CARD));
          close.setCamera(framed.pose, framed.drop);
          return close.content;
        }
        scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);
        line = new SquishyField(scene, { registry, lod: lodFor('closeUp', tier), breathing: false });
        const gap = 2.6;
        ids.forEach((id, i) => {
          const species = byId.get(id);
          if (!species) return;
          line?.add(species, `evo-line-${id}`, {
            x: (i - (ids.length - 1) / 2) * gap,
            z: 0,
            scale: 1,
            yaw: -0.35,
          });
        });
        const floor = CreateCylinder('evo-floor', { diameter: 40, height: 0.4, tessellation: 96 }, scene);
        floor.position.y = -0.2;
        const mat = new PBRMaterial('evo-floor-mat', scene);
        mat.albedoColor = Color3.FromHexString('#c8eebc').toLinearSpace();
        mat.metallic = 0;
        mat.roughness = 0.85;
        floor.material = mat;
        const r = ids.length * gap * 0.5;
        return { bounds: { minX: -r, maxX: r, minZ: -r, maxZ: r } };
      },
      tier,
      mode === 'lineup'
        ? {
            pitch: ((Number(params.get('pitch')) || 14) * Math.PI) / 180,
            startDistance: Number(params.get('distance')) || 15,
            minDistance: 5,
          }
        : {},
      pin,
    ),
  onStart: (s) => {
    stage = s;
  },
  onError: (err: unknown) => {
    console.error('Could not start the renderer', err);
  },
});

function frame(): void {
  if (stage) {
    close?.update(performance.now());
    line?.update(performance.now());
    stage.invalidate();
    if (stage.draws > 0) frames++;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { __evo: object }).__evo = {
  ready: () => frames > 20,
  tier: () => stage?.quality.snapshot.tier ?? null,
};
