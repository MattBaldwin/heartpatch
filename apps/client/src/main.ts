import { createEngineAndScene } from './engine/create-scene.js';
import { fetchHealth } from './net/api.js';
import './styles.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('missing #game canvas');

const { engine, scene } = createEngineAndScene(canvas);

scene.onAfterRenderObservable.addOnce(() => {
  canvas.dataset['ready'] = 'true';
});
engine.runRenderLoop(() => {
  scene.render();
});
window.addEventListener('resize', () => {
  engine.resize();
});

if (import.meta.env.DEV) {
  const badge = document.createElement('div');
  badge.className = 'dev-status';
  badge.dataset['testid'] = 'dev-status';
  badge.textContent = 'server: …';
  document.body.append(badge);
  fetchHealth()
    .then((health) => {
      badge.textContent = `server: ${health.status} (${health.version})`;
    })
    .catch(() => {
      badge.textContent = 'server: offline';
    });
}
