import {
  GAME_DATA,
  RESEARCH_TREE,
  researchGateProblem,
  researchReadyAt,
  type PublicUser,
  type ResearchBuilding,
  type ResearchNode,
  type ResearchResponse,
  type ResearchRules,
  type ResearchView,
  type StartResearchRequest,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems, grantItems, lockGrantRows } from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { mapPatchRules } from '../territory/supply.js';
import {
  createResearchRepo,
  type ResearchJobRow,
  type ResearchOwner,
  type ResearchRepo,
  type ResearchTxRepo,
} from './repo.js';

/*
 * The Research Bench (#874 C3): one research node at a time per player per
 * patch, a timer (CLAUDE.md rule 4). Starting pays the node's cost up front
 * and fixes `ready_at` from the node's seconds and the bench's pace; once
 * the clock passes it, the next read (or a claim) marks the node known and
 * puts its Blueprints in the bag, once. No ticking loop and no settle hook
 * (plan R2.3): `GET` claims a ready job lazily. Each command is one
 * transaction (rule 7). Lock order (tech spec §7): the bench (step 8), my
 * going job (8, after the buildings), my bag (11), `maps` last. What I know
 * and what's going are mine alone; the patch hears only `research.done`.
 * Cozy Patches and Wild Isles have no research: `NOT_FOUND`.
 */

export const MESSAGES = {
  noResearch: 'There is no research on this patch.',
  unknownNode: "That research isn't in the tree.",
  noBench: "That isn't one of your Research Benches.",
  busy: 'Your Bench is busy tinkering! One thing at a time.',
  known: 'You already know that one! ✨',
  needs: (name: string) => `Research ${name} first!`,
  nothing: 'Nothing is tinkering on your Bench.',
  notReady: "It's still tinkering. Check back soon!",
} as const;

export interface ResearchService {
  /** What I know and what's going; claims a ready job first. */
  view: (user: PublicUser, mapId: string) => Promise<ResearchView>;
  /** Starts a node on one of my benches, paid up front. */
  start: (
    user: PublicUser,
    mapId: string,
    request: StartResearchRequest,
  ) => Promise<ResearchResponse>;
  /** Claims my ready job: the node is known, its Blueprints in my bag. */
  claim: (user: PublicUser, mapId: string) => Promise<ResearchResponse>;
}

export interface ResearchServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /**
   * The tree a Clockwork Isle uses in place of its rules' (tests: a tier-2
   * node to check `requires`, which tier 1 never has). Other patches still
   * answer `NOT_FOUND`.
   */
  tree?: ResearchRules;
}

/** Research bench rows by content id. */
const BENCHES = new Map(
  GAME_DATA.buildings.flatMap((b): [string, ResearchBuilding][] =>
    b.kind === 'research' ? [[b.id, b]] : [],
  ),
);

/** The map's research tree, or `NOT_FOUND` on a Cozy Patch or Wild Isle. */
async function patchTree(tx: Executor, mapId: string): Promise<ResearchRules> {
  const research = (await mapPatchRules(tx, mapId))?.research ?? null;
  if (!research) throw new AppError('NOT_FOUND', MESSAGES.noResearch);
  return research;
}

const nodeIn = (tree: ResearchRules, nodeId: string): ResearchNode | undefined =>
  tree.nodes.find((n) => n.id === nodeId);

/**
 * Claims a ready job inside the caller's transaction (its row already
 * locked or not): marks it claimed (the `claimed_at IS NULL` guard makes a
 * second claim a no-op), marks the node known and grants its Blueprints.
 * Returns the `research.done` event to append last, or null when the job
 * isn't ready or was claimed already. The caller has locked the grant's
 * bag rows if it spends from the bag in the same transaction.
 */
export async function claimResearchJob(
  repo: ResearchRepo,
  tx: Executor,
  tree: ResearchRules,
  job: ResearchJobRow,
  at: Date,
): Promise<NewGameEvent<'research.done'> | null> {
  if (job.claimedAt !== null || job.readyAt > at) return null;
  const claimed = await repo.claim(job.id, at);
  if (!claimed) return null;
  const owner = { mapId: claimed.mapId, userId: claimed.userId };
  await repo.markKnown(owner, claimed.nodeId, at);
  // A node dropped from the tree since it started still becomes known; it grants nothing.
  const grants = nodeIn(tree, claimed.nodeId)?.grants ?? {};
  if (Object.keys(grants).length > 0) {
    await grantItems(tx, owner, grants, 'research-grant', claimed.id, at);
  }
  return {
    mapId: claimed.mapId,
    type: 'research.done',
    actorUserId: claimed.userId,
    payload: { userId: claimed.userId, jobId: claimed.id, nodeId: claimed.nodeId, grants },
  };
}

/**
 * The research gate for a build or a level (#874 C3): `CONFLICT` with kid
 * text ("Tinker first! Research Sorting at your Bench.") until `owner`
 * knows `requiresResearch` on this patch. Nothing to check without one. A
 * plain read of `research_known` (insert-only, never locked), so it adds no
 * lock to the caller's order. The node's name comes from the shared tree:
 * a gated row only exists on a Clockwork Isle (`checkGameData`).
 */
export async function requireResearch(
  db: Executor,
  owner: ResearchOwner,
  requiresResearch: string | undefined,
): Promise<void> {
  if (requiresResearch === undefined) return;
  const known = new Set(await createResearchRepo(db).known(owner));
  const problem = researchGateProblem(requiresResearch, known, RESEARCH_TREE);
  if (problem) throw new AppError('CONFLICT', problem);
}

/** My research now, read in `db` (inside a transaction or not). */
async function viewOf(repo: ResearchRepo, owner: ResearchOwner, at: Date): Promise<ResearchView> {
  const [known, going] = await Promise.all([repo.known(owner), repo.going(owner)]);
  return {
    known,
    going: going
      ? {
          nodeId: going.nodeId,
          startedAt: going.startedAt.toISOString(),
          readyAt: going.readyAt.toISOString(),
        }
      : null,
    serverTime: at.toISOString(),
  };
}

export function createResearchService(options: ResearchServiceOptions): ResearchService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createResearchRepo(db);
  const published = (mapId: string) => void options.publish?.(mapId);
  const treeOf = async (tx: Executor, mapId: string) => {
    const tree = await patchTree(tx, mapId);
    return options.tree ?? tree;
  };

  /** Claims my ready job in its own transaction; true if it granted. */
  async function claimIfReady(owner: ResearchOwner, tree: ResearchRules, at: Date) {
    const going = await store.going(owner);
    if (!going || going.readyAt > at) return false;
    return store.transaction(async (repo, tx) => {
      const job = await repo.lockGoing(owner);
      if (!job) return false; // claimed by a racing read
      const done = await claimResearchJob(repo, tx, tree, job, at);
      if (!done) return false;
      await repo.appendEvent(done);
      return true;
    });
  }

  const response = async (
    repo: ResearchRepo,
    tx: Executor,
    owner: ResearchOwner,
    at: Date,
  ): Promise<ResearchResponse> => ({
    research: await viewOf(repo, owner, at),
    items: await createInventoryRepo(tx).list(owner),
  });

  return {
    view: async (user, mapId) => {
      await requireMember(db, user, mapId);
      const tree = await treeOf(db, mapId);
      const owner = { mapId, userId: user.id };
      const at = now();
      if (await claimIfReady(owner, tree, at)) published(mapId);
      return viewOf(store, owner, at);
    },

    start: async (user, mapId, request) => {
      const owner = { mapId, userId: user.id };
      const at = now();
      let result: ResearchResponse;
      try {
        result = await store.transaction(async (repo: ResearchTxRepo, tx) => {
          await requireMember(tx, user, mapId);
          const tree = await treeOf(tx, mapId);
          const node = nodeIn(tree, request.nodeId);
          if (!node) throw new AppError('NOT_FOUND', MESSAGES.unknownNode);
          // Step 8: the bench, then my going job.
          const bench = await repo.lockBench(request.buildingId);
          const benchDef = bench ? BENCHES.get(bench.buildingId) : undefined;
          if (
            !bench ||
            !benchDef ||
            bench.mapId !== mapId ||
            bench.ownerUserId !== user.id ||
            bench.kind !== 'research'
          ) {
            throw new AppError('NOT_FOUND', MESSAGES.noBench);
          }
          const going = await repo.lockGoing(owner);
          if (going && going.readyAt > at) throw new AppError('CONFLICT', MESSAGES.busy);
          // Step 11 once: a ready job's grant and the new node's cost together.
          await lockGrantRows(tx, mapId, [
            ...(going
              ? [{ userId: user.id, items: nodeIn(tree, going.nodeId)?.grants ?? {} }]
              : []),
            { userId: user.id, items: node.cost },
          ]);
          // A ready job frees the bench: it's claimed first (and its node known).
          const done = going ? await claimResearchJob(repo, tx, tree, going, at) : null;
          const known = new Set(await repo.known(owner));
          if (known.has(node.id)) throw new AppError('CONFLICT', MESSAGES.known);
          const missing = node.requires.find((id) => !known.has(id));
          if (missing !== undefined) {
            throw new AppError('CONFLICT', MESSAGES.needs(nodeIn(tree, missing)?.name ?? missing));
          }
          const level = benchDef.levels[Math.min(bench.level, benchDef.levels.length) - 1];
          if (!level) throw new Error(`research bench ${bench.buildingId} has no levels`);
          const job = await repo.insertJob({
            ...owner,
            buildingId: bench.id,
            nodeId: node.id,
            startedAt: at,
            readyAt: researchReadyAt(at, node, level.pacePercent),
          });
          // Short of anything: CONFLICT ("You need 2 more Parts first!"), all rolled back.
          await consumeItems(tx, owner, node.cost, 'research', job.id, at);
          if (done) await repo.appendEvent(done);
          await repo.appendEvent({
            mapId,
            type: 'research.started',
            actorUserId: user.id,
            payload: {
              userId: user.id,
              jobId: job.id,
              buildingRowId: bench.id,
              nodeId: node.id,
              readyAt: job.readyAt.toISOString(),
              cost: node.cost,
            },
          });
          return response(repo, tx, owner, at);
        });
      } catch (err) {
        // A double tap raced us to the one-going-per-player index.
        if (isUniqueViolation(err)) throw new AppError('CONFLICT', MESSAGES.busy);
        throw err;
      }
      published(mapId);
      return result;
    },

    claim: async (user, mapId) => {
      const owner = { mapId, userId: user.id };
      const at = now();
      const result = await store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        const tree = await treeOf(tx, mapId);
        const job = await repo.lockGoing(owner);
        if (!job) throw new AppError('CONFLICT', MESSAGES.nothing);
        if (job.readyAt > at) throw new AppError('CONFLICT', MESSAGES.notReady);
        const done = await claimResearchJob(repo, tx, tree, job, at);
        if (!done) throw new AppError('CONFLICT', MESSAGES.nothing);
        await repo.appendEvent(done);
        return response(repo, tx, owner, at);
      });
      published(mapId);
      return result;
    },
  };
}
