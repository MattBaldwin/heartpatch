import {
  GAME_DATA,
  visualRegistry,
  type HomeResponse,
  type HomeSquishy,
  type MyBuilding,
} from '@heartpatch/shared';
import { boot } from '../../engine/boot.js';
import { createRenderer, parseRendererPreference } from '../../engine/renderer.js';
import { pickInitialTier } from '../../engine/quality/tiers.js';
import { mountStage, type Stage } from '../../engine/stage.js';
import { lodFor } from '../../procedural/motion.js';
import { HOME_VIEW } from '../home-config.js';
import { HomeScene } from '../home-scene.js';
import '../../styles.css';

/**
 * Dev-only building gallery at `/buildings.html` (a separate Vite page, never
 * part of the production build): the real home-base scene with sample
 * buildings at every level, to judge upgrades and scale by eye (owner
 * decision 2026-10-06). `?show=` picks the layout: `fire1`, `fire2`,
 * `fire3` (one fire at that level with its light on the land around),
 * `fires` (levels 1–3 side by side), `habitats` (both habitats at levels 1
 * and 2), `training1`, `training2` (Training Grounds with two squishies
 * practicing). Every shot uses one camera: `?pitch=` (degrees, default 42,
 * a 3/4 view so heights read; the game's is 58), `?dist=` (default 18), and
 * `?focus=q,r` centres a tile (close-ups use a smaller `dist`). Plus the main
 * page's `?quality=` and `?renderer=webgpu`.
 */

if (!import.meta.env.DEV) throw new Error('The building gallery is dev-only');

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('missing #game canvas');

const params = new URLSearchParams(window.location.search);
const tier = pickInitialTier(params.get('quality'));
const show = params.get('show') ?? 'fire1';
const pitch = ((Number(params.get('pitch')) || 42) * Math.PI) / 180;
const distance = Number(params.get('dist')) || 18;
const focus = params.get('focus')?.split(',').map(Number) ?? null;

const NOW = '2026-10-12T18:00:00.000Z';
const ids = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** The seven home tiles around (0, 0): two resource nodes at the sides, the rest plain. */
const TILES: HomeResponse['tiles'] = [
  { q: 0, r: 0, heartSeed: true, nodeResource: null },
  { q: 1, r: -1, heartSeed: false, nodeResource: null },
  { q: 0, r: -1, heartSeed: false, nodeResource: null },
  { q: 1, r: 0, heartSeed: false, nodeResource: 'timber' },
  { q: -1, r: 0, heartSeed: false, nodeResource: 'stone' },
  { q: -1, r: 1, heartSeed: false, nodeResource: null },
  { q: 0, r: 1, heartSeed: false, nodeResource: null },
];

let next = 1;
function building(
  buildingId: string,
  at: { q: number; r: number },
  level: number,
  extra: Partial<MyBuilding> = {},
): MyBuilding {
  const data = GAME_DATA.buildings.find((b) => b.id === buildingId);
  if (!data) throw new Error(`no building ${buildingId}`);
  const step = data.levels[level - 1];
  const fire = data.kind === 'hearthfire';
  return {
    id: ids(next++),
    buildingId,
    kind: data.kind,
    level,
    spot: 0,
    q: at.q,
    r: at.r,
    lit: fire ? true : null,
    safeRadius: step && 'safeRadius' in step ? step.safeRadius : null,
    nightsLeft: fire ? 3 : null,
    fuelSpace: fire ? 2 : null,
    capacity: step && 'capacity' in step ? step.capacity : null,
    residents: fire ? null : 0,
    ...extra,
  };
}

function squishy(
  speciesId: string,
  where: { habitatId?: string; trainingId?: string } = {},
): HomeSquishy {
  const species = GAME_DATA.species.find((s) => s.id === speciesId);
  if (!species) throw new Error(`no species ${speciesId}`);
  return {
    id: ids(next++),
    speciesId,
    element: species.element,
    feeling: species.feeling,
    nickname: null,
    level: 8,
    habitatId: where.habitatId ?? null,
    trainingId: where.trainingId ?? null,
    job: where.trainingId ? 'training' : 'resting',
  };
}

function layout(): Pick<HomeResponse, 'buildings' | 'squishies'> {
  const fireLevel = /^fire([123])$/.exec(show);
  if (fireLevel) {
    const den = building('ember-den', { q: 0, r: -1 }, 1);
    const meadow = building('cozy-meadow', { q: -1, r: 1 }, 1);
    return {
      buildings: [building('hearthfire', { q: 0, r: 1 }, Number(fireLevel[1])), den, meadow],
      squishies: [
        squishy('emberbun', { habitatId: den.id }),
        squishy('thistlepip', { habitatId: meadow.id }),
        squishy('puddlepuff'),
      ],
    };
  }
  if (show === 'fires') {
    return {
      buildings: [
        building('hearthfire', { q: 0, r: -1 }, 1),
        building('hearthfire', { q: 1, r: -1 }, 2),
        building('hearthfire', { q: 0, r: 1 }, 3),
      ],
      squishies: [squishy('puddlepuff')],
    };
  }
  if (show === 'habitats') {
    return {
      buildings: [
        building('ember-den', { q: 0, r: -1 }, 1),
        building('ember-den', { q: 1, r: -1 }, 2),
        building('cozy-meadow', { q: -1, r: 1 }, 1),
        building('cozy-meadow', { q: 0, r: 1 }, 2),
      ],
      squishies: [squishy('puddlepuff')],
    };
  }
  const trainingLevel = /^training([12])$/.exec(show);
  if (trainingLevel) {
    const grounds = building('training-grounds', { q: 0, r: 1 }, Number(trainingLevel[1]));
    return {
      buildings: [building('hearthfire', { q: -1, r: 1 }, 1), grounds],
      squishies: [
        squishy('pebblesnooze', { trainingId: grounds.id }),
        squishy('emberbun', { trainingId: grounds.id }),
        squishy('puddlepuff'),
      ],
    };
  }
  throw new Error(`unknown ?show=${show}`);
}

const home: HomeResponse = {
  tiles: TILES,
  ...layout(),
  speciesDefs: [],
  items: {},
  seasons: [],
  tonight: '2026-10-12',
  now: NOW,
};

let stage: Stage | null = null;
let homeScene: HomeScene | null = null;

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
  mount: (renderer, target) =>
    mountStage(
      renderer,
      target,
      (scene) => {
        homeScene = new HomeScene(scene, home, {
          registry: visualRegistry(GAME_DATA),
          lod: lodFor('closeUp', tier),
          keeper: null,
        });
        return homeScene.content;
      },
      tier,
      { pitch, startDistance: distance, minDistance: 3 },
    ),
  onStart: (s) => {
    stage = s;
    const [q, r] = focus ?? [];
    if (homeScene && q !== undefined && r !== undefined) {
      s.camera.panTo(homeScene.spotAt({ q, r, spot: 0 }), true);
      s.invalidate();
    }
  },
  onError: (err: unknown) => {
    console.error('Could not start the renderer', err);
  },
});

/** World sizes (width × height) of what's drawn, for the scale captions. */
function sizes(): Record<string, { width: number; height: number }> {
  const out: Record<string, { width: number; height: number }> = {};
  for (const mesh of stage?.scene.meshes ?? []) {
    const isBuilding = /^[a-z-]+:(lit|out|plain):\d+$/.test(mesh.name);
    const isSquishy = mesh.name.startsWith('squishy-');
    if (!isBuilding && !isSquishy) continue;
    const { minimum, maximum } = mesh.getBoundingInfo().boundingBox;
    const scale = isBuilding ? HOME_VIEW.buildingScale : HOME_VIEW.squishyScale;
    out[mesh.name] = {
      width: Math.max(maximum.x - minimum.x, maximum.z - minimum.z) * scale,
      height: (maximum.y - minimum.y) * scale,
    };
  }
  return out;
}

declare global {
  interface Window {
    __buildingGallery?: {
      ready: () => boolean;
      stats: () => unknown;
      quality: () => unknown;
      sizes: typeof sizes;
      tile: { width: number };
    };
  }
}

window.__buildingGallery = {
  ready: () => (stage?.draws ?? 0) > 0,
  quality: () => stage?.quality.snapshot ?? null,
  stats: () => homeScene?.stats ?? null,
  sizes,
  // A tile's width across its flats in the home view.
  tile: { width: HOME_VIEW.hexSize * Math.sqrt(3) },
};
