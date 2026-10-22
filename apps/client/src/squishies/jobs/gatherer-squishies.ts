import type { Scene } from '@babylonjs/core/scene';
import {
  GAME_DATA,
  hexKey,
  hexToWorld,
  visualRegistry,
  type HexKey,
  type JobSquishy,
  type JobsView,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';
import { GATHERER_ON_TILE, HEX_SIZE, PLAYER_COLORS } from '../../map/map-config.js';
import { slotsByUser } from '../../map/map-layout.js';
import { DOME, tileScreenRectOf, topOf } from '../../map/map-scene.js';
import type { MapLayer } from '../../map/map-screen.js';
import { createTileMarks, type TileMark, type TileMarks } from '../../map/tile-marks.js';
import type { SquishySpecies } from '../../procedural/params.js';
import { SquishyField, type SquishyHandle } from '../../procedural/squishy-field.js';
import { gathererMark, nameOf, type GathererMark } from './jobs-view.js';

// Gatherers on the map (#602, owner decisions 2026-10-22: a quiet map,
// details on tap). Each squishy gathering stands on its tile, small, in the
// 3D scene: one `SquishyField` (thin instances, low detail, no breathing or
// shadow), so draw calls grow with the kinds of body and part on the map,
// never with the number of gatherers (CLAUDE.md rule 8).
//
// The public map view says only how many squishies gather on a tile, never
// which (DECISIONS, squishy jobs: a rival must not learn who gathers where),
// so a patch-mate's gatherer stands there as a plain squishy in its family's
// colour. Mine come from my own jobs view (`setMine`) and stand there as
// themselves. Tapping the tile says who and how they feel (the tile panel's
// worker line, `index.ts`); the only thing drawn over the map is one small
// mark on a tile of mine that needs me: a gatherer not keen, or napping
// (`tile-marks.ts`). Nothing over a patch-mate's.

export interface GathererSquishiesOptions {
  /**
   * Asks for my jobs view of this map (it arrives through `setMine`): when
   * the layer attaches, and when the map's gatherer counts change.
   */
  load?: (mapId: string) => void;
}

export interface GathererSquishies extends MapLayer {
  /** My jobs view of a map: my gatherers stand there as themselves, with their marks. */
  setMine: (mapId: string, view: Pick<JobsView, 'squishies' | 'names'>) => void;
  /** Drops my jobs view (another player signed in): every gatherer is a plain one again. */
  forget: () => void;
  /** My gatherer on this tile and its name, from my jobs view, or null (the tile panel's line). */
  mineOn: (mapId: string, tile: PublicTile) => { name: string; squishy: JobSquishy } | null;
  readonly debug: GathererSquishiesDebug;
}

/** Read-only state for the dev hook. */
export interface GathererSquishiesDebug {
  /** Gatherers standing on the map. */
  readonly standing: number;
  /** Of those, mine (drawn as their own species). */
  readonly mine: number;
  /** Marks on screen now, by kind. */
  readonly marks: Readonly<Partial<Record<GathererMark, number>>>;
  /** Each gatherer's tile and its middle on screen (CSS px), for e2e taps; tiles off screen are left out. */
  readonly tiles: readonly { key: HexKey; x: number; y: number }[];
  /** The field's draw calls (meshes with instances) and thin instances. */
  readonly meshes: number;
  readonly instances: number;
}

/** One gatherer to stand on the map (pure, for tests). */
export interface GathererPlan {
  readonly key: HexKey;
  readonly tile: PublicTile;
  readonly species: SquishySpecies;
  /** Seeds its look: my squishy's id (it looks as it does at home), else the tile. */
  readonly instanceId: string;
  readonly mine: boolean;
  readonly mark: GathererMark | null;
  /** Not keen: it pulls its glum face (#393). */
  readonly glum: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const SPECIES = new Map(GAME_DATA.species.map((s) => [s.id, s]));

/** A patch-mate's gatherer: a plain little squishy in its family's colour. */
export function standInSpecies(color: string): SquishySpecies {
  return {
    id: 'gatherer-stand-in',
    visual: {
      body: 'bun',
      palette: [color, '#fff3e2'],
      parts: ['oval-eyes', 'smile', 'blush-cheeks'],
    },
  };
}

/**
 * Who stands where (pure, for tests): one gatherer on every tile the map
 * says has one, mine from my jobs view when it has them.
 */
export function planGatherers(
  view: Pick<MapView, 'tiles' | 'members'>,
  mine: readonly JobSquishy[] | null,
): GathererPlan[] {
  const myWork = new Map<HexKey, JobSquishy>();
  for (const s of mine ?? []) {
    if (s.job === 'gatherer' && s.work) myWork.set(hexKey(s.work), s);
  }
  const slots = slotsByUser(view.members);
  const plans: GathererPlan[] = [];
  for (const tile of view.tiles) {
    if ((tile.workers ?? 0) === 0) continue;
    const key = hexKey(tile);
    const p = hexToWorld(tile, HEX_SIZE);
    const at = {
      x: p.x + GATHERER_ON_TILE.offset.x,
      y: topOf(tile) + DOME * 0.5,
      z: p.z + GATHERER_ON_TILE.offset.z,
    };
    const own = myWork.get(key);
    const species = own ? SPECIES.get(own.squishy.speciesId) : undefined;
    if (own && species) {
      const mark = gathererMark(own, tile);
      plans.push({
        key,
        tile,
        species,
        instanceId: own.squishy.id,
        mine: true,
        mark,
        glum: mark === 'meh',
        ...at,
      });
      continue;
    }
    const slot = tile.ownerUserId === null ? null : (slots.get(tile.ownerUserId) ?? null);
    const color =
      slot === null ? '#c9b8ff' : (PLAYER_COLORS[slot % PLAYER_COLORS.length] ?? '#c9b8ff');
    plans.push({
      key,
      tile,
      species: standInSpecies(color),
      instanceId: key,
      mine: false,
      mark: null,
      glum: false,
      ...at,
    });
  }
  return plans;
}

interface Standing {
  readonly handle: SquishyHandle;
  /** What it was drawn from, so an unchanged gatherer is left alone. */
  readonly look: string;
  plan: GathererPlan;
}

const lookOf = (plan: GathererPlan) =>
  `${plan.species.id} ${plan.species.visual.palette.join()} ${plan.instanceId} ${String(plan.x)},${String(plan.y)},${String(plan.z)}`;

export function createGathererSquishies(
  root: HTMLElement,
  options: GathererSquishiesOptions = {},
): GathererSquishies {
  const registry = visualRegistry(GAME_DATA);
  const marks: TileMarks = createTileMarks(root);
  let scene: Scene | null = null;
  let field: SquishyField | null = null;
  let view: MapView | null = null;
  /** My jobs view's squishies, and the map they came from. */
  let mine: { mapId: string; view: Pick<JobsView, 'squishies' | 'names'> } | null = null;
  /** The gatherer counts last asked about, so an unchanged view doesn't ask again. */
  let asked = '';
  const standing = new Map<HexKey, Standing>();

  /** Asks for my jobs view again when the map's gatherers changed. */
  const ask = (next: MapView) => {
    if (!options.load) return;
    const counts = next.tiles
      .filter((t) => (t.workers ?? 0) > 0)
      .map((t) => `${hexKey(t)}:${String(t.workers ?? 0)}`)
      .join(' ');
    const at = `${next.map.id} ${counts}`;
    if (at === asked) return;
    asked = at;
    if (counts !== '') options.load(next.map.id);
  };

  /** Matches the squishies standing on the map to the view (and my jobs view). */
  const draw = (next: MapView) => {
    view = next;
    ask(next);
    const plans = planGatherers(next, mine?.mapId === next.map.id ? mine.view.squishies : null);
    const wanted = new Map(plans.map((p) => [p.key, p] as const));
    if (field) {
      for (const [key, was] of standing) {
        const plan = wanted.get(key);
        if (plan && lookOf(plan) === was.look) continue;
        field.remove(was.handle);
        standing.delete(key);
      }
      for (const plan of plans) {
        const was = standing.get(plan.key);
        if (was) {
          was.plan = plan;
        } else {
          const handle = field.add(plan.species, plan.instanceId, {
            x: plan.x,
            y: plan.y,
            z: plan.z,
            scale: GATHERER_ON_TILE.scale,
          });
          standing.set(plan.key, { handle, look: lookOf(plan), plan });
        }
        const face = plan.glum ? 'glum' : null;
        const handle = standing.get(plan.key)?.handle;
        if (handle && field.faceOf(handle) !== face) field.setFace(handle, face);
      }
    }
    // My mark sits just over my gatherer's head, so it says which squishy.
    const tileMarks: TileMark[] = plans.flatMap((p) => {
      if (!p.mark) return [];
      const handle = standing.get(p.key)?.handle;
      const top = handle ? handle.params.height * GATHERER_ON_TILE.scale : 0;
      return [{ tile: p.tile, kind: p.mark, at: { x: p.x, y: p.y + top, z: p.z } }];
    });
    marks.set('gatherers', tileMarks);
  };

  return {
    attach: (next, first) => {
      standing.clear();
      scene = next;
      // The map draws on demand and keeps still: no breathing, and no
      // contact shadow (map props and Keepers have none either).
      field = new SquishyField(next, { registry, lod: 'low', breathing: false, shadows: false });
      const built = field;
      marks.attach(next);
      draw(first);
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        built.dispose();
        standing.clear();
        field = null;
        scene = null;
      });
    },
    update: (next) => {
      if (scene) draw(next);
    },
    setMine: (mapId, jobs) => {
      mine = { mapId, view: jobs };
      if (scene && view?.map.id === mapId) draw(view);
    },
    forget: () => {
      mine = null;
      asked = '';
      if (scene && view) draw(view);
      else marks.clear();
    },
    mineOn: (mapId, tile) => {
      if (mine?.mapId !== mapId) return null;
      const key = hexKey(tile);
      const squishy = mine.view.squishies.find(
        (s) => s.job === 'gatherer' && s.work !== null && hexKey(s.work) === key,
      );
      return squishy ? { name: nameOf(mine.view, squishy), squishy } : null;
    },
    get debug() {
      const stats = field?.stats;
      const tiles: { key: HexKey; x: number; y: number }[] = [];
      for (const { plan } of standing.values()) {
        const rect = scene ? tileScreenRectOf(scene, plan.tile) : null;
        if (!rect) continue;
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
        tiles.push({ key: plan.key, x: Math.round(x), y: Math.round(y) });
      }
      return {
        standing: standing.size,
        mine: [...standing.values()].filter((s) => s.plan.mine).length,
        marks: marks.shown,
        tiles,
        meshes: stats?.meshes ?? 0,
        instances: stats?.instances ?? 0,
      };
    },
  };
}
