import type { ResearchNode, ResearchRules } from '../schemas/data/research.js';

/*
 * Clockwork Isle research (#874 C3): pure helpers shared by the server's
 * research module and the bench sheet. Research is a timer (CLAUDE.md rule
 * 4): a job's `ready_at` is fixed when it starts and the server claims it
 * lazily on read. Nothing here is secret: the tree is public data.
 */

/** Kid text for research (STYLE_GUIDE): the gate, the countdown, the ta-da. */
export const RESEARCH_TEXT = {
  /** A build (or level) its owner hasn't researched yet. */
  gate: (nodeName: string) => `Tinker first! Research ${nodeName} at your Bench.`,
  /** A node going on the bench; `wait` is short, like "2h" or "15m". */
  going: (wait: string) => `Tinkering… ready in ${wait}`,
  done: 'Ta-da! New blueprints in your bag 📜',
} as const;

/**
 * When a node started at `startedAt` is ready on a bench working at
 * `pacePercent` (100 = the node's own `seconds`; 150 = two thirds of it).
 * Whole seconds, rounded up, so a job is never ready early.
 */
export function researchReadyAt(
  startedAt: Date,
  node: Pick<ResearchNode, 'seconds'>,
  pacePercent: number,
): Date {
  if (!Number.isInteger(pacePercent) || pacePercent <= 0) {
    throw new RangeError(`pacePercent must be a positive integer, got ${String(pacePercent)}`);
  }
  const seconds = Math.ceil((node.seconds * 100) / pacePercent);
  return new Date(startedAt.getTime() + seconds * 1000);
}

/**
 * The nodes I can start now, in tree order: not known, not the one going,
 * and every `requires` known.
 */
export function nextNodes(
  tree: ResearchRules,
  known: Iterable<string>,
  goingNodeId: string | null = null,
): ResearchNode[] {
  const have = new Set(known);
  return tree.nodes.filter(
    (node) =>
      !have.has(node.id) && node.id !== goingNodeId && node.requires.every((id) => have.has(id)),
  );
}

/**
 * Why I can't build something gated by `requiresResearch` yet (kid text),
 * or null when it needs nothing or I know the node. A node missing from the
 * tree reads as its id; `checkResearchTree` keeps that from shipping.
 */
export function researchGateProblem(
  requiresResearch: string | undefined,
  known: ReadonlySet<string>,
  tree: ResearchRules,
): string | null {
  if (requiresResearch === undefined || known.has(requiresResearch)) return null;
  const name = tree.nodes.find((n) => n.id === requiresResearch)?.name ?? requiresResearch;
  return RESEARCH_TEXT.gate(name);
}
