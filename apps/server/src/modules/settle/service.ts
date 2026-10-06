import type { ItemCounts, Landed, PublicUser, SettleResponse } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createGatheringRepo } from '../gathering/repo.js';
import { bankGather, gatherFate } from '../gathering/service.js';
import { createInventoryRepo } from '../inventory/repo.js';
import {
  bankCraft,
  createInventoryService,
  grantItems,
  lockGrantRows,
} from '../inventory/service.js';
import { bankableWork } from '../jobs/service.js';
import { createSquishyJobsRepo } from '../jobs/repo.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { createSettleRepo } from './repo.js';

/*
 * Settling (owner decision 2026-10-06): finished things go straight into the
 * bag, with no Collect tap. Still timestamps, not a ticking loop (CLAUDE.md
 * rule 4): the client asks when a map opens and when the next thing is due
 * (`nextAt`), and the server banks whatever has finished by its clock:
 * crafts, the player's own gathers, and their gatherers' cycles (still capped
 * at `JOB_RULES.work.maxStoredCycles`; a full gatherer starts again from the
 * settle). One transaction (rule 7), the same ledger rows and events a
 * Collect wrote (`item.crafted`, `resource.gathered`, `work.collected`), and
 * a gather's roll for found clothing. Settling twice, or from two phones at
 * once, banks each thing once: the member row lock runs settles one at a
 * time, and each row is re-read under its lock.
 */

// Kid-readable messages (style guide §6).
const MESSAGES = {
  noMap: "We couldn't find that patch.",
} as const;

export interface SettleService {
  /** Banks everything of mine on this map that has finished; the bag after. */
  settle: (user: PublicUser, mapId: string) => Promise<SettleResponse>;
}

export interface SettleServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit when something landed. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

const isEmpty = (items: ItemCounts) => Object.keys(items).length === 0;

function addInto(total: ItemCounts, items: ItemCounts): void {
  for (const [id, n] of Object.entries(items)) total[id] = (total[id] ?? 0) + n;
}

export function createSettleService(options: SettleServiceOptions): SettleService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());

  return {
    settle: async (user, mapId) => {
      const at = now();
      const owner = { mapId, userId: user.id };
      const result = await createSettleRepo(db).transaction(async (repo, tx) => {
        const { map } = await requireMember(tx, user, mapId);
        // Lock order (tech spec §7): the member row (one settle at a time per
        // player), tiles, gathers, the craft, squishies, inventory rows, `maps`.
        if (!(await createMapsRepo(tx).lockMember(map.id, user.id))) {
          throw new AppError('NOT_FOUND', MESSAGES.noMap);
        }
        const gathering = createGatheringRepo(tx);
        const inventory = createInventoryRepo(tx);
        const jobs = createSquishyJobsRepo(tx);

        // What might be due, read unlocked; each is read again under its lock.
        const [gathersBefore, workersBefore] = await Promise.all([
          gathering.listToSettle(map.id, user.id),
          jobs.listMine(map.id, user.id).then((rows) => rows.filter((r) => r.workTile !== null)),
        ]);
        const tileIds = new Set<string>();
        for (const g of gathersBefore) tileIds.add(g.tileId);
        for (const w of workersBefore) if (w.workTile) tileIds.add(w.workTile.id);
        // The tiles first, so the land can't change hands mid-settle.
        await jobs.lockTiles([...tileIds].sort());
        const gathers = await gathering.lockToSettle(gathersBefore.map((g) => g.id));
        const crafts = await inventory.lockActiveCrafts(owner);
        await jobs.lockSquishies(workersBefore.map((w) => w.squishy.id));
        // A work tile that moved since the first read wasn't locked: next time.
        const lockedTile = (id: string | undefined) => id !== undefined && tileIds.has(id);
        const workers = (await jobs.listByIds(workersBefore.map((w) => w.squishy.id))).filter(
          (w) =>
            w.squishy.ownerUserId === user.id &&
            w.squishy.state === 'active' &&
            lockedTile(w.workTile?.id),
        );

        // What happens to each.
        const gatherPlans = gathers
          .filter((g) => g.status === 'active')
          .map((g) => ({ gather: g, fate: gatherFate(g, at) }));
        const craftPlans = crafts.map((c) => ({ craft: c, ready: c.readyAt <= at }));
        const workPlans = workers.map((row) => ({ row, work: bankableWork(row, map, at) }));

        await lockGrantRows(tx, map.id, [
          ...gatherPlans.flatMap((p) => (p.fate === 'bank' ? [p.gather] : [])),
          ...craftPlans.flatMap((p) => (p.ready ? [p.craft] : [])),
          ...workPlans.flatMap((p) =>
            p.work && p.work.progress.cycles > 0 ? [{ userId: user.id, items: p.work.ready }] : [],
          ),
        ]);

        const landed: Landed[] = [];
        const events: NewGameEvent[] = [];
        const due: number[] = [];

        for (const { craft, ready } of craftPlans) {
          if (!ready) {
            due.push(craft.readyAt.getTime());
            continue;
          }
          events.push(await bankCraft(tx, craft, at));
          landed.push({ kind: 'craft', items: craft.items });
        }

        // Gathers: grants first, then the found-clothing rolls (each appends
        // its own `clothing.found`, taking `maps`), so no inventory row is
        // locked after `maps`.
        const banking = gatherPlans.filter((p) => p.fate === 'bank').map((p) => p.gather);
        for (const { gather, fate } of gatherPlans) {
          if (fate === 'wait') due.push(gather.readyAt.getTime());
          // The land changed hands before it finished: let go, as before.
          if (fate === 'lose') await gathering.endGather(gather.id, { status: 'lost', at });
        }
        for (const gather of banking)
          await grantItems(tx, owner, gather.items, 'gather', gather.id);

        const worked: ItemCounts = {};
        const workedIds: string[] = [];
        for (const { row, work } of workPlans) {
          if (!work) continue;
          const banked = work.progress.cycles > 0;
          if (banked && !isEmpty(work.ready)) {
            await grantItems(tx, owner, work.ready, 'work', row.squishy.id);
            addInto(worked, work.ready);
          }
          if (!row.atWork) {
            // Its land changed hands: what finished before then is banked; it rests now.
            await jobs.stopWork(row.squishy.id);
          } else if (banked) {
            // The next count starts here; a full gatherer starts again now.
            await jobs.moveWorkSince(row.squishy.id, new Date(work.progress.nextSinceMs));
            due.push(work.progress.nextSinceMs + work.cycleSeconds * 1000);
          } else if (work.progress.nextReadyMs !== null) {
            due.push(work.progress.nextReadyMs);
          }
          if (banked) workedIds.push(row.squishy.id);
        }

        // Gathers' grants are in: mark them collected and roll for clothing.
        for (const gather of banking) {
          events.push(await bankGather(tx, gathering, gather, at, { granted: true }));
          landed.push({ kind: 'gather', items: gather.items });
        }
        if (!isEmpty(worked)) {
          landed.push({ kind: 'work', items: worked });
          events.push({
            mapId: map.id,
            type: 'work.collected',
            actorUserId: user.id,
            payload: { userId: user.id, squishyIds: workedIds, items: worked },
          });
        }
        for (const event of events) await repo.appendEvent(event);

        const bag = await createInventoryService({ db: tx, clock: () => at }).get(user, mapId);
        const next = due.length === 0 ? null : new Date(Math.min(...due)).toISOString();
        return { ...bag, landed, nextAt: next };
      });
      if (result.landed.length > 0) void options.publish?.(mapId);
      return result;
    },
  };
}
