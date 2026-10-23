// PROTOTYPE ONLY (#306 Crooked House design lane). Never merged.
// `/crooked.html?shot=dark|lit|echo|caught|door|key|bonus|attic|plan|plan-up&tier=high`
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { boot } from '../../../engine/boot.js';
import { setPerfReports } from '../../../engine/perf-report.js';
import { createRenderer, parseRendererPreference } from '../../../engine/renderer.js';
import { isQualityTier, pickInitialTier } from '../../../engine/quality/tiers.js';
import { mountStage, type Stage } from '../../../engine/stage.js';
import { buildShot, SHOT_HUD, type Shot, type ShotResult } from '../proto-scene.js';
import '../../../styles.css';

setPerfReports(false);
if (!import.meta.env.DEV) throw new Error('dev-only');

const params = new URLSearchParams(window.location.search);
const pinned = params.get('tier');
const pinTier = isQualityTier(pinned);
const tier = pickInitialTier(pinned, params.get('quality'));
const shot = (params.get('shot') ?? 'dark') as Shot;
const hud = SHOT_HUD[shot] ?? SHOT_HUD.dark;

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('missing #game canvas');
let stage: Stage | null = null;
let result: (ShotResult & { distance?: number; pitch?: number }) | null = null;

// --- DOM: a dark vignette, the lantern's dark, and the HUD mock ---
const css = document.createElement('style');
css.textContent = `
  html, body { margin:0; background:#0b0912; height:100%; overflow:hidden; font-family: -apple-system, "SF Pro Rounded", "Nunito", system-ui, sans-serif; }
  #game { position:fixed; inset:0; width:100%; height:100%; display:block; touch-action:none; }
  .ck-dark { position:fixed; inset:0; pointer-events:none; }
  .ck-vignette { position:fixed; inset:0; pointer-events:none; background: radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 45%, rgba(8,6,16,0.55) 100%); }
  .ck-pill { position:fixed; top: calc(env(safe-area-inset-top, 0px) + 12px); padding: 8px 12px; border-radius: 999px; background: rgba(28,22,40,0.82); color:#fff3e6; font-weight:700; font-size:15px; letter-spacing:.2px; box-shadow: 0 4px 14px rgba(0,0,0,.35); backdrop-filter: blur(6px); }
  .ck-room { left: 12px; max-width: 60vw; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ck-keys { right: 12px; }
  .ck-rooms { position:fixed; top: calc(env(safe-area-inset-top, 0px) + 56px); left: 12px; padding: 6px 12px; border-radius: 999px; background: rgba(28,22,40,0.65); color:#e9d9ff; font-size:13px; font-weight:600; }
  .ck-action { position:fixed; left:50%; transform:translateX(-50%); bottom: calc(env(safe-area-inset-bottom, 0px) + 22px); min-width: 210px; padding: 16px 26px; border-radius: 999px; border:0; font-size:19px; font-weight:800; color:#3a2a1a; background: linear-gradient(#ffe6a8, #ffc46b); box-shadow: 0 8px 22px rgba(255,180,90,.35), inset 0 -3px 0 rgba(0,0,0,.08); }
  .ck-lantern-btn { position:fixed; left: 16px; bottom: calc(env(safe-area-inset-bottom, 0px) + 20px); width:62px; height:62px; border-radius:50%; border:0; background: rgba(28,22,40,0.85); color:#ffd27a; font-size:26px; box-shadow: 0 6px 16px rgba(0,0,0,.4); }
  .ck-map-btn { position:fixed; right: 16px; bottom: calc(env(safe-area-inset-bottom, 0px) + 20px); width:62px; height:62px; border-radius:50%; border:0; background: rgba(28,22,40,0.85); color:#fff; font-size:26px; box-shadow: 0 6px 16px rgba(0,0,0,.4); }
  .ck-bubble { position:fixed; left:50%; transform:translateX(-50%); bottom: calc(env(safe-area-inset-bottom, 0px) + 100px); max-width: 320px; padding: 12px 16px; border-radius: 18px; background: rgba(255,247,236,0.96); color:#3a2a2a; font-size:16px; font-weight:600; text-align:center; box-shadow: 0 8px 22px rgba(0,0,0,.35); }
  .ck-bubble:after { content:""; position:absolute; left:50%; bottom:-8px; width:16px; height:16px; background:inherit; transform: translateX(-50%) rotate(45deg); border-radius:3px; }
  .ck-card { position:fixed; left: 12px; right: 12px; bottom: calc(env(safe-area-inset-bottom, 0px) + 16px); padding: 20px 20px 16px; border-radius: 26px; background: linear-gradient(#fff9f0, #ffeedd); color:#3a2a2a; box-shadow: 0 14px 40px rgba(0,0,0,.45); text-align:center; }
  .ck-card h2 { margin: 0 0 8px; font-size: 24px; }
  .ck-card p { margin: 0 0 16px; font-size: 16px; line-height: 1.35; }
  .ck-card button { padding: 14px 28px; border-radius: 999px; border:0; font-size:18px; font-weight:800; color:#3a2a1a; background: linear-gradient(#ffe6a8, #ffc46b); box-shadow: 0 6px 18px rgba(255,180,90,.4); }
  .ck-caught { position:fixed; inset:0; background: rgba(10,8,18,0.96); display:flex; flex-direction:column; align-items:center; justify-content:center; color:#fff; }
  .ck-eyes { display:flex; gap: 46px; margin-bottom: 36px; }
  .ck-eye { width: 64px; height: 84px; border-radius: 50%; background: radial-gradient(circle at 50% 45%, #fff 0 38%, #d8c6ff 42%, #8f6fff 70%, rgba(143,111,255,0) 100%); box-shadow: 0 0 60px 20px rgba(143,111,255,.45); }
  .ck-boo { font-size: 44px; font-weight: 900; letter-spacing: 1px; margin-bottom: 10px; text-shadow: 0 0 24px rgba(216,198,255,.8); }
  .ck-sub { font-size: 17px; color:#e9d9ff; font-weight:600; }
  .ck-caught .ck-card { position:static; margin-top: 44px; width: min(92vw, 360px); }
  .ck-plan-label { position:fixed; left: 50%; transform: translateX(-50%); bottom: calc(env(safe-area-inset-bottom, 0px) + 24px); padding: 10px 16px; border-radius: 999px; background: rgba(28,22,40,0.82); color:#fff3e6; font-weight:700; font-size:14px; }
`;
document.head.append(css);

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  document.body.append(e);
  return e;
};
const dark = el('div', 'ck-dark');
el('div', 'ck-vignette');
if (shot !== 'caught') {
  el('div', 'ck-pill ck-room', hud.room);
  el('div', 'ck-pill ck-keys', hud.keys);
  el('div', 'ck-rooms', hud.rooms);
  if (shot === 'plan' || shot === 'plan-up') {
    el('div', 'ck-plan-label', shot === 'plan' ? 'Colour = put right · Grey = still dark · Tap a lit room to go there' : 'Upstairs · The attic ladder is on the Landing');
  } else {
    el('button', 'ck-lantern-btn', '🕯️');
    el('button', 'ck-map-btn', '🗺️');
    if (hud.action) el('button', 'ck-action', hud.action);
    if (hud.bubble) el('div', 'ck-bubble', hud.bubble);
    if (hud.card) {
      const c = el('div', 'ck-card');
      c.innerHTML = `<h2></h2><p></p><button></button>`;
      c.querySelector('h2')!.textContent = hud.card.title;
      c.querySelector('p')!.textContent = hud.card.body;
      c.querySelector('button')!.textContent = hud.card.button;
    }
  }
} else {
  const c = el('div', 'ck-caught');
  c.innerHTML = `<div class="ck-eyes"><div class="ck-eye"></div><div class="ck-eye"></div></div><div class="ck-boo">Peekaboo! 👻</div><div class="ck-sub">An echo found you.</div><div class="ck-card"><h2>Whoops! Back to the light 🕯️</h2><p>Nothing’s lost. You’re back in the Parlour, where your lantern burns.</p><button>Okay!</button></div>`;
}

/** Paints the lantern's dark around its screen position: clear inside, night outside. */
function placeDark(): void {
  if (!stage || !result?.lantern) {
    dark.style.background = '';
    return;
  }
  const cam = stage.scene.activeCamera;
  if (!cam) return;
  const engine = stage.scene.getEngine();
  const w = engine.getRenderWidth();
  const h = engine.getRenderHeight();
  const vp = new Viewport(0, 0, w, h);
  const p = Vector3.Project(result.lantern, Matrix.Identity(), stage.scene.getTransformMatrix(), vp);
  const ratio = window.devicePixelRatio || 1;
  const sx = p.x / ratio;
  const sy = p.y / ratio;
  const q = Vector3.Project(result.lantern.add(new Vector3(result.lanternRadius, 0, 0)), Matrix.Identity(), stage.scene.getTransformMatrix(), vp);
  const r = Math.max(60, Math.hypot(q.x - p.x, q.y - p.y) / ratio);
  dark.style.background = `radial-gradient(circle at ${sx.toFixed(0)}px ${sy.toFixed(0)}px, rgba(0,0,0,0) ${(r * 0.5).toFixed(0)}px, rgba(14,10,26,0.72) ${(r * 0.78).toFixed(0)}px, rgba(9,7,16,0.985) ${(r * 1.05).toFixed(0)}px)`;
}

let built = false;
await boot(canvas, {
  preference: parseRendererPreference(params.get('renderer')),
  createRenderer,
  freshCanvas: () => {
    const current = document.querySelector<HTMLCanvasElement>('#game');
    if (!current) throw new Error('missing #game canvas');
    const fresh = current.cloneNode(false) as HTMLCanvasElement;
    current.replaceWith(fresh);
    return fresh;
  },
  mount: (renderer, target) => {
    let r: (ShotResult & { distance?: number; pitch?: number }) | null = null;
    stage = mountStage(
      renderer,
      target,
      (scene) => {
        r = buildShot(scene, shot, tier) as ShotResult & { distance?: number; pitch?: number };
        return r;
      },
      tier,
      { pitch: (56 * Math.PI) / 180, fov: 0.8, minDistance: 4, maxDistance: 64, startDistance: 15 },
      pinTier,
    );
    result = r;
    // Pin the shot's own camera distance and pitch after the stage made its camera.
    const st = stage.camera as unknown as { state?: { distance?: number }; config?: { pitch?: number } };
    const cam = stage.scene.activeCamera as unknown as { position: Vector3; getTarget?: () => Vector3; setTarget?: (v: Vector3) => void } | null;
    if (cam && r) {
      const rr = r as { distance?: number; pitch?: number; start?: { x: number; z: number } };
      const d = rr.distance ?? 15;
      const pitch = rr.pitch ?? (62 * Math.PI) / 180;
      const t = new Vector3(rr.start?.x ?? 0, 0, rr.start?.z ?? 0);
      stage.scene.onBeforeRenderObservable.add(() => {
        const c = stage?.scene.activeCamera as unknown as { position: Vector3; setTarget: (v: Vector3) => void; fov: number } | null;
        if (!c) return;
        c.position.set(t.x, Math.sin(pitch) * d, t.z - Math.cos(pitch) * d);
        c.setTarget(t);
      });
    }
    void st;
    stage.scene.onAfterRenderObservable.add(() => {
      placeDark();
      built = true;
    });
    stage.invalidate();
    return { dispose: () => { stage?.dispose(); stage = null; } };
  },
  onError: (err: unknown) => console.error('Could not start the renderer', err),
});

window.__heartpatch = {
  renderer: () => stage?.renderer.kind ?? null,
  quality: () => stage?.quality.snapshot ?? null,
  camera: () => stage?.camera.state ?? null,
  draws: () => stage?.draws ?? 0,
  idle: () => stage?.idle ?? false,
  invalidate: () => stage?.invalidate(),
  ready: () => built,
} as never;
