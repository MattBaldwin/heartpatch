import type { BuildableKind } from '../schemas/data/home-base.js';
import type { NamingRules } from '../schemas/data/naming.js';

/** What the naming gate reads: one member row on one patch. */
export interface NamingFacts {
  /** Kinds this Keeper has built on the patch at least once (taken down still counts). */
  kindsBuilt: readonly string[];
  /** Squishies befriended in a battle on the patch. */
  caughtCount: number;
  /** The Heart Seed's level now (1 until #221). */
  heartSeedLevel: number;
  /** The Heart Seed level the name was last set at; null if never named. */
  homeNamedAtLevel: number | null;
}

export interface NamingGate {
  /** One of each kind built and enough squishies caught. */
  unlocked: boolean;
  /** `buildableKinds` in data order, each with whether it's been built. */
  kinds: { kind: BuildableKind; built: boolean }[];
  /** Caught so far, capped at `need` for the meter. */
  caught: number;
  need: number;
  /**
   * May name now: unlocked, and never named or the Heart Seed has grown
   * since the last name.
   */
  renameOpen: boolean;
}

/**
 * The naming gate (#306 PR 0), shared so the server's refusal and the
 * client's card never disagree.
 */
export function namingGate(
  facts: NamingFacts,
  rules: NamingRules,
  buildableKinds: readonly BuildableKind[],
): NamingGate {
  const built = new Set(facts.kindsBuilt);
  const kinds = buildableKinds.map((kind) => ({ kind, built: built.has(kind) }));
  const unlocked = kinds.every((k) => k.built) && facts.caughtCount >= rules.caughtToName;
  const renameOpen =
    unlocked &&
    (facts.homeNamedAtLevel === null || facts.heartSeedLevel > facts.homeNamedAtLevel);
  return {
    unlocked,
    kinds,
    caught: Math.min(facts.caughtCount, rules.caughtToName),
    need: rules.caughtToName,
    renameOpen,
  };
}
