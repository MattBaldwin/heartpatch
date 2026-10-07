import type { Building } from '../schemas/data/buildings.js';
import type { ElementId, FeelingId } from '../schemas/data/elements.js';

// What a building does (#207), worked out from its data alone, so a new
// building gets its build-menu chips without engine code (CLAUDE.md rule 5).
// Only public building data: nothing server-only (rule 6). The client words
// and decorates each effect.

export type BuildingEffect =
  /** A Hearthfire: squishies this many tiles around it are safe at night. */
  | { readonly kind: 'safe'; readonly radius: number }
  /** A Hearthfire burns fuel every night it's lit. */
  | { readonly kind: 'fuel'; readonly perNight: number }
  /** A habitat: squishies with these tags grow faster living there. */
  | {
      readonly kind: 'grows';
      readonly elements: readonly ElementId[];
      readonly feelings: readonly FeelingId[];
    }
  /** How many squishies live there. */
  | { readonly kind: 'room'; readonly capacity: number }
  /** Training Grounds: how many practice at once, and the XP each earns an hour. */
  | { readonly kind: 'training'; readonly capacity: number; readonly xpPerHour: number };

/**
 * What `building` does at `level` (1 = just built), in the order a row shows
 * it. A level past its last one reads as its last.
 */
export function buildingEffects(building: Building, level = 1): BuildingEffect[] {
  const at = <T>(levels: readonly T[]): T =>
    levels[Math.min(Math.max(level, 1), levels.length) - 1] as T;
  switch (building.kind) {
    case 'hearthfire':
      return [
        { kind: 'safe', radius: at(building.levels).safeRadius },
        { kind: 'fuel', perNight: building.fuelPerNight },
      ];
    case 'habitat':
      return [
        { kind: 'grows', elements: building.tags.elements, feelings: building.tags.feelings },
        { kind: 'room', capacity: at(building.levels).capacity },
      ];
    case 'training-grounds': {
      const { capacity, xpPerHour } = at(building.levels);
      return [{ kind: 'training', capacity, xpPerHour }];
    }
  }
}
