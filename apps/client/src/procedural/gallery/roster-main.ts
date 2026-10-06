import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { GAME_DATA, visualRegistry, type BattleTimeOfDay } from '@heartpatch/shared';
import { BattleScene } from '../../battle/battle-scene.js';
import { BattleContent } from '../../battle/battle-view.js';
import { boot } from '../../engine/boot.js';
import { createRenderer, parseRendererPreference } from '../../engine/renderer.js';
import { pickInitialTier } from '../../engine/quality/tiers.js';
import { mountStage, type Stage } from '../../engine/stage.js';
import { lodFor } from '../motion.js';
import '../../styles.css';

/**
 * Dev-only roster sheet at `/roster.html` (ART BIBLE contact sheets): one
 * species standing on the opponent's side of the real battle scene (arena
 * lights, fog, camera), still and with reduced motion, so a script can
 * screenshot every species the way a kid sees it in a fight.
 *
 * Query flags: `?species=puddlepuff` (default the first species),
 * `?terrain=meadow`, `?time=day|dusk|night`, `?quality=`, and `?silhouette`
 * (only the squishies, on white, for silhouette sheets).
 */

if (!import.meta.env.DEV) throw new Error('The roster sheet is dev-only');

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('missing #game canvas');

const params = new URLSearchParams(window.location.search);
const tier = pickInitialTier(params.get('quality'));
const registry = visualRegistry(GAME_DATA);
const speciesId = params.get('species') ?? GAME_DATA.species[0]?.id ?? '';
const terrain = params.get('terrain') ?? 'meadow';
const timeOfDay = (params.get('time') ?? 'day') as BattleTimeOfDay;
const silhouette = params.has('silhouette');

/** The player's-side squishy in every shot (cropped out of the sheet). */
const REFERENCE = params.get('reference') ?? 'pebblesnooze';

let stage: Stage | null = null;
let battle: BattleScene | null = null;
let frames = 0;

function freshCanvas(): HTMLCanvasElement {
  const current = document.querySelector<HTMLCanvasElement>('#game');
  if (!current) throw new Error('missing #game canvas');
  const next = current.cloneNode(false) as HTMLCanvasElement;
  current.replaceWith(next);
  return next;
}

await boot(canvas, {
  preference: parseRendererPreference(params.get('renderer')),
  createRenderer,
  freshCanvas,
  mount: (renderer, target) =>
    mountStage(
      renderer,
      target,
      (scene) => {
        battle?.dispose();
        const built = new BattleScene(scene, {
          registry,
          lod: lodFor('closeUp', tier),
          tier,
          content: new BattleContent({ speciesDefs: [], moveDefs: [] }),
          mySide: 'a',
          keeper: null,
          terrain,
          timeOfDay,
          battleId: `roster-${terrain}-${timeOfDay}`,
          reducedMotion: true,
          safe: () => ({ top: 0.12, bottom: 0.62 }),
        });
        // A fixed reference on the player's side keeps the camera's framing
        // nearly the same for every species, so evolutions read bigger.
        built.prewarm('a', [{ speciesId: REFERENCE, instanceId: 'roster-reference' }]);
        built.sendOut('a', REFERENCE, 'roster-reference');
        built.prewarm('b', [{ speciesId, instanceId: `roster-${speciesId}` }]);
        built.sendOut('b', speciesId, `roster-${speciesId}`);
        battle = built;
        return built.content;
      },
      tier,
    ),
  onStart: (s) => {
    stage = s;
  },
  onError: (err: unknown) => {
    console.error('Could not start the renderer', err);
  },
});

function frame(): void {
  if (stage && battle && silhouette) {
    const { scene } = stage;
    scene.fogEnabled = false;
    scene.clearColor.set(1, 1, 1, 1);
    scene.imageProcessingConfiguration.isEnabled = false;
    for (const mesh of scene.meshes) {
      if (!mesh.name.startsWith('squishy-')) mesh.setEnabled(false);
    }
    // Flat black squishies, so glowing and white ones show their shape too.
    for (const material of scene.materials) {
      if (material instanceof PBRMaterial && material.name === 'squishy-vinyl') {
        material.unlit = true;
        material.albedoColor = Color3.Black();
        material.clearCoat.isEnabled = false;
      }
    }
  }
  if (stage && battle) {
    battle.update(performance.now());
    stage.invalidate();
    if (stage.draws > 0) frames++;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { __roster: unknown }).__roster = {
  ready: () => frames > 20,
  stats: () => battle?.stats ?? null,
};
