import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { hexKey, worldToHex, type MapView, type PublicTile } from '@heartpatch/shared';
import { HEX_SIZE, TERRAIN_LOOKS } from '../map/map-config.js';
import type { MapLayer } from '../map/map-screen.js';
import { HollowMan } from '../procedural/hollow-man/hollow-man.js';
import { NIGHT_LOOK, VISIT_SPOT } from './hollow-config.js';

// Night on the map and the Hollow Man's visit (#21, design doc §14). The
// layer dims the open map's light while it's night (map time, from the
// server) and plays his visit when night falls live. Render on demand (tech
// spec §6): changing the light draws a few frames; only the visit's own
// animation keeps the map drawing, for its ~4.5 s.

/** What the day looked like, kept so morning puts it back exactly. */
interface DayLight {
  clear: Color4;
  environment: number;
  sun: { intensity: number; diffuse: Color3 } | null;
}

export interface HollowLayerDebug {
  readonly night: boolean;
  readonly visiting: boolean;
  /** Visits played since the page loaded. */
  readonly visits: number;
}

export class HollowLayer implements MapLayer {
  private scene: Scene | null = null;
  private day: DayLight | null = null;
  private man: HollowMan | null = null;
  private tiles = new Map<string, PublicTile>();
  private night = false;
  private visits = 0;
  /** The playing visit's `done`, so a scene torn down mid-visit (GPU loss) still ends it. */
  private pendingDone: (() => void) | null = null;
  private readonly invalidate: () => void;

  constructor(options: { invalidate: () => void }) {
    this.invalidate = options.invalidate;
  }

  attach(scene: Scene, view: MapView): void {
    this.scene = scene;
    const sun = scene.getLightByName('sun');
    this.day = {
      clear: scene.clearColor.clone(),
      environment: scene.environmentIntensity,
      sun: sun ? { intensity: sun.intensity, diffuse: sun.diffuse.clone() } : null,
    };
    this.tiles = new Map(view.tiles.map((t) => [hexKey(t), t]));
    const man = new HollowMan(scene);
    this.man = man;
    scene.onDisposeObservable.addOnce(() => {
      if (this.scene !== scene) return;
      const done = this.pendingDone;
      this.pendingDone = null;
      done?.();
      this.scene = null;
      this.man = null;
      this.day = null;
      this.tiles = new Map();
    });
    this.apply();
  }

  /** Night or day on the open map (and any map opened later). */
  setNight(night: boolean): void {
    if (this.night === night) return;
    this.night = night;
    this.apply();
    this.invalidate();
  }

  /**
   * Night just fell: he visits the open map once, where the player is
   * looking (a little up-screen, clear of the bottom cards), and `done` is
   * called when he has faded away. False (and no `done`) if no map is drawn.
   */
  visit(done?: () => void): boolean {
    const { man, scene } = this;
    if (!man || !scene) return false;
    if (man.isVisiting) return true;
    this.visits += 1;
    this.pendingDone = done ?? null;
    man.visit(this.spotNear(scene), () => {
      this.pendingDone = null;
      this.invalidate();
      done?.();
    });
    this.invalidate();
    return true;
  }

  /** A spot just up-screen of what the camera looks at, standing on its tile. */
  private spotNear(scene: Scene): { x: number; y: number; z: number } {
    const camera = scene.activeCamera;
    const target = camera instanceof TargetCamera ? camera.getTarget() : null;
    const x = (target?.x ?? 0) + VISIT_SPOT.x;
    const z = (target?.z ?? 0) + VISIT_SPOT.z;
    const tile = this.tiles.get(hexKey(worldToHex({ x, z }, HEX_SIZE)));
    const y = tile ? (TERRAIN_LOOKS[tile.terrain]?.height ?? 0) : 0;
    return { x, y, z };
  }

  get debug(): HollowLayerDebug {
    return { night: this.night, visiting: this.man?.isVisiting ?? false, visits: this.visits };
  }

  private apply(): void {
    const { scene, day } = this;
    if (!scene || !day) return;
    const sun = scene.getLightByName('sun');
    if (this.night) {
      scene.clearColor = Color4.FromHexString(`${NIGHT_LOOK.clear}ff`);
      scene.environmentIntensity = day.environment * NIGHT_LOOK.environment;
      if (sun && day.sun) {
        sun.intensity = day.sun.intensity * NIGHT_LOOK.sun;
        sun.diffuse = new Color3(...NIGHT_LOOK.moon);
      }
    } else {
      scene.clearColor = day.clear.clone();
      scene.environmentIntensity = day.environment;
      if (sun && day.sun) {
        sun.intensity = day.sun.intensity;
        sun.diffuse = day.sun.diffuse.clone();
      }
    }
  }
}
