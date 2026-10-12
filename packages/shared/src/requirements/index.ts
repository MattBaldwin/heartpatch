import type { CareRules, MoodId } from '../schemas/data/care.js';
import type {
  Requirement,
  RequirementGroup,
  RequirementKind,
  RequirementProgress,
} from '../schemas/data/requirements.js';

/*
 * The one requirement evaluator (#381 plan §8), shared by every levelled
 * thing (the Keeper's house now, the Heart Seed in #221). Pure and integer
 * only: `(requirements, facts) → progress`. The server gathers the facts
 * (`modules/progress/facts.ts`) and calls this on read and again inside a
 * build's transaction; the client only draws what the server sends.
 */

/** One resident, as the residents' requirements read it. */
export interface ResidentFact {
  /** Contentment now (0–100), worked out on read (CLAUDE.md rule 4). */
  contentment: number;
  level: number;
  /** It has evolved at least once (a `squishy_evolutions` row). */
  evolved: boolean;
}

/** One completed trade or gift where the player was a party. */
export interface TradeFact {
  kind: 'trade' | 'gift';
  /** The other Keeper's user id. */
  partnerUserId: string;
}

/**
 * What the evaluator reads: plain integers and small lists, gathered by the
 * server for one Keeper on one patch. Nothing here is secret.
 */
export interface ProgressFacts {
  /** The Keeper's Heart Seed level (#221); 1 until Heart Seed levels land. */
  heartSeedLevel: number;
  /** Hex distance from the Keeper's Heart Seed of every tile they own. */
  ownedTileDistances: readonly number[];
  /**
   * Milestone tiers reached, by public track id (a milestone is a tier;
   * secret tracks never count, so a visible row never moves on a secret).
   */
  milestoneTiers: Readonly<Record<string, number>>;
  /** Squishies the Keeper has on this patch (active, in a trade or in the Hollow). */
  befriended: number;
  /** Every building the Keeper has up on this patch. */
  buildings: readonly { buildingId: string; kind: string }[];
  /** Tiles the Keeper has searched all the way. */
  explored: number;
  /** Kinds of squishy the Keeper has seen. */
  speciesSeen: number;
  /** Hearthfires with fuel for tonight. */
  litFires: number;
  /** Decorations placed in the house (furniture, Phase 2); 0 until then. */
  decorations: number;
  residents: readonly ResidentFact[];
  trades: readonly TradeFact[];
  /** Trading posts the Keeper has used. */
  postsUsed: number;
  /** Owned tiles that aren't fading, the home ring included. */
  tilesTended: number;
  /** Homesteads the Keeper has joined. */
  homesteads: number;
}

/** Facts for a brand-new Keeper: nothing done yet, Heart Seed at level 1. */
export const EMPTY_PROGRESS_FACTS: ProgressFacts = {
  heartSeedLevel: 1,
  ownedTileDistances: [],
  milestoneTiers: {},
  befriended: 0,
  buildings: [],
  explored: 0,
  speciesSeen: 0,
  litFires: 0,
  decorations: 0,
  residents: [],
  trades: [],
  postsUsed: 0,
  tilesTended: 0,
  homesteads: 0,
};

/** What the lines need beyond the facts: names and the mood bands. */
export interface RequirementContext {
  care: Pick<CareRules, 'moods'>;
  /** A building's display name by id; the id itself when unknown. */
  buildingName: (buildingId: string) => string;
  /** A milestone track's display name by id; the id itself when unknown. */
  trackName: (trackId: string) => string;
  /** The patch has one member: patch-mate rows show the invite hint. */
  solo: boolean;
}

/** The group a kind shows under on a progress screen. */
export function requirementGroup(kind: RequirementKind): RequirementGroup {
  switch (kind) {
    case 'heartSeedLevel':
      return 'seed';
    case 'buildingsBuilt':
    case 'habitatKinds':
    case 'litFires':
    case 'decorations':
      return 'home';
    case 'residentsContent':
    case 'residentsLevel':
    case 'residentsEvolved':
      return 'residents';
    case 'tradesCompleted':
    case 'patchMatesTradedWith':
    case 'postsUsed':
      return 'patch-mates';
    case 'ownedTilesWithin':
    case 'tilesTended':
    case 'homesteads':
      return 'land';
    case 'milestonesReached':
    case 'squishiesBefriended':
    case 'tilesFullyExplored':
    case 'speciesSeen':
      return 'adventure';
  }
}

/** The lowest contentment that shows `mood` or better. */
function moodFloor(mood: MoodId, care: Pick<CareRules, 'moods'>): number {
  return care.moods.find((m) => m.id === mood)?.atLeast ?? 0;
}

/** How much of a requirement the facts meet, and how much it needs. */
export function requirementAmount(
  req: Requirement,
  facts: ProgressFacts,
  care: Pick<CareRules, 'moods'>,
): { have: number; need: number } {
  switch (req.kind) {
    case 'ownedTilesWithin':
      return {
        have: facts.ownedTileDistances.filter((d) => d <= req.radius).length,
        need: req.count,
      };
    case 'milestonesReached': {
      const tiers =
        req.trackId === undefined
          ? Object.values(facts.milestoneTiers).reduce((sum, n) => sum + n, 0)
          : (facts.milestoneTiers[req.trackId] ?? 0);
      return { have: tiers, need: req.count };
    }
    case 'squishiesBefriended':
      return { have: facts.befriended, need: req.count };
    case 'buildingsBuilt':
      return {
        have: facts.buildings.filter(
          (b) =>
            (req.buildingKind === undefined || b.kind === req.buildingKind) &&
            (req.buildingId === undefined || b.buildingId === req.buildingId),
        ).length,
        need: req.count,
      };
    case 'tilesFullyExplored':
      return { have: facts.explored, need: req.count };
    case 'speciesSeen':
      return { have: facts.speciesSeen, need: req.count };
    case 'habitatKinds':
      return {
        have: new Set(facts.buildings.filter((b) => b.kind === 'habitat').map((b) => b.buildingId))
          .size,
        need: req.count,
      };
    case 'litFires':
      return { have: facts.litFires, need: req.count };
    case 'decorations':
      return { have: facts.decorations, need: req.count };
    case 'residentsContent': {
      const floor = moodFloor(req.mood, care);
      return {
        have: facts.residents.filter((r) => r.contentment >= floor).length,
        need: req.count,
      };
    }
    case 'residentsLevel':
      return { have: facts.residents.filter((r) => r.level >= req.level).length, need: req.count };
    case 'residentsEvolved':
      return { have: facts.residents.filter((r) => r.evolved).length, need: req.count };
    case 'tradesCompleted': {
      const kinds = req.tradeKinds;
      return {
        have: facts.trades.filter((t) => kinds === undefined || kinds.includes(t.kind)).length,
        need: req.count,
      };
    }
    case 'patchMatesTradedWith':
      return { have: new Set(facts.trades.map((t) => t.partnerUserId)).size, need: req.count };
    case 'postsUsed':
      return { have: facts.postsUsed, need: req.count };
    case 'tilesTended':
      return { have: facts.tilesTended, need: req.count };
    case 'homesteads':
      return { have: facts.homesteads, need: req.count };
    case 'heartSeedLevel':
      return { have: facts.heartSeedLevel, need: req.level };
  }
}

/** "1 resident" / "3 residents". */
const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * The kid-readable line for a requirement (style guide §2: short, common
 * words, no stats-speak). Built on the server and sent as text.
 */
export function requirementLine(req: Requirement, context: RequirementContext): string {
  switch (req.kind) {
    case 'ownedTilesWithin':
      return `Own ${plural(req.count, 'tile', 'tiles')} near home`;
    case 'milestonesReached':
      return req.trackId === undefined
        ? `Reach ${plural(req.count, 'milestone', 'milestones')}`
        : `${context.trackName(req.trackId)}: reach ${plural(req.count, 'step', 'steps')}`;
    case 'squishiesBefriended':
      return `Befriend ${plural(req.count, 'squishy', 'squishies')}`;
    case 'buildingsBuilt':
      if (req.buildingId !== undefined) {
        const name = context.buildingName(req.buildingId);
        return req.count === 1
          ? `Build a ${name}`
          : `Build ${String(req.count)} ${name.endsWith('s') ? name : `${name}s`}`;
      }
      if (req.buildingKind === 'habitat')
        return `Build ${plural(req.count, 'habitat', 'habitats')}`;
      return `Build ${plural(req.count, 'building', 'buildings')}`;
    case 'tilesFullyExplored':
      return `Explore ${plural(req.count, 'tile', 'tiles')} all the way`;
    case 'speciesSeen':
      return `Spot ${plural(req.count, 'kind', 'kinds')} of squishy`;
    case 'habitatKinds':
      return `Build ${plural(req.count, 'kind', 'kinds')} of habitat`;
    case 'litFires':
      return req.count === 1 ? 'Light a fire 🔥' : `Light ${String(req.count)} fires 🔥`;
    case 'decorations':
      return `Place ${plural(req.count, 'decoration', 'decorations')}`;
    case 'residentsContent':
      return `Have ${plural(req.count, `${req.mood} resident`, `${req.mood} residents`)}`;
    case 'residentsLevel':
      return `${plural(req.count, 'resident', 'residents')} at level ${String(req.level)}+`;
    case 'residentsEvolved':
      return `${plural(req.count, 'resident', 'residents')} who evolved`;
    case 'tradesCompleted':
      if (req.tradeKinds?.length === 1)
        return req.tradeKinds[0] === 'gift'
          ? `Share ${plural(req.count, 'gift', 'gifts')}`
          : `Finish ${plural(req.count, 'trade', 'trades')}`;
      return `Finish ${String(req.count)} trades or gifts`;
    case 'patchMatesTradedWith':
      return `Trade with ${plural(req.count, 'patch-mate', 'different patch-mates')}`;
    case 'postsUsed':
      return `Use ${plural(req.count, 'trading post', 'trading posts')}`;
    case 'tilesTended':
      return `Tend ${plural(req.count, 'tile', 'tiles')} of land`;
    case 'homesteads':
      return `Have ${plural(req.count, 'homestead', 'homesteads')}`;
    case 'heartSeedLevel':
      return `Grow your Heart Seed to level ${String(req.level)} 🌱`;
  }
}

/** A nudge toward what to do next, or null. Patch-mate rows on a solo patch invite. */
export function requirementHint(req: Requirement, context: RequirementContext): string | null {
  const group = requirementGroup(req.kind);
  if (group === 'patch-mates' && context.solo) return 'Invite a patch-mate to grow further 💌';
  if (req.kind === 'heartSeedLevel') return 'Your Heart Seed needs to grow first 🌱';
  return null;
}

/**
 * Every requirement's progress, in data order. `id` is the kind and its
 * index, so it stays put while the data does.
 */
export function evaluateRequirements(
  reqs: readonly Requirement[],
  facts: ProgressFacts,
  context: RequirementContext,
): RequirementProgress[] {
  return reqs.map((req, i) => {
    const { have, need } = requirementAmount(req, facts, context.care);
    const done = have >= need;
    return {
      id: `${req.kind}-${String(i)}`,
      kind: req.kind,
      group: requirementGroup(req.kind),
      line: requirementLine(req, context),
      have,
      need,
      done,
      hint: done ? null : requirementHint(req, context),
    };
  });
}

/** Every requirement holds. An empty list always does. */
export function requirementsMet(
  reqs: readonly Requirement[],
  facts: ProgressFacts,
  care: Pick<CareRules, 'moods'>,
): boolean {
  return reqs.every((req) => {
    const { have, need } = requirementAmount(req, facts, care);
    return have >= need;
  });
}
