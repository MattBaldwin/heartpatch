import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Scene } from '@babylonjs/core/scene';
import { it, vi } from 'vitest';
import { sampleHouse, withGift } from './house-fixtures.js';
import { buildHouse } from './house-test-scene.js';
import { wallRuns } from './house-layout.js';
import { fitHouse, framedFocus, project } from './house-camera.js';

vi.mock('../procedural/contact-shadow.js', () => ({
  createContactShadowMesh: (scene: Scene) =>
    CreateGround('squishy-shadows', { width: 1, height: 1 }, scene),
}));
vi.mock('./house-textures.js', async () => {
  const { StandardMaterial } = await import('@babylonjs/core/Materials/standardMaterial');
  return {
    paneMaterial: (scene: Scene, kind = 'dusk') =>
      scene.getMaterialByName(`test-${kind}-pane`) ??
      new StandardMaterial(`test-${kind}-pane`, scene),
    signMaterial: (scene: Scene) => new StandardMaterial('test-sign', scene),
    radialTexture: () => null,
  };
});

it('probe', () => {
  for (const level of [2, 4]) {
    const runs = wallRuns(sampleHouse(level).view.rooms);
    for (const r of runs) if (!r.exterior) process.stderr.write(`L${level} ${JSON.stringify({ ...r, windows: r.windows.length })}\n`);
  }
});
