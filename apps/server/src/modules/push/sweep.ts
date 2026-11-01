import {
  HOME_BASE_RULES,
  PUSH_RULES,
  tonightOf,
  type LocalDate,
  type PushKind,
  type PushRules,
} from '@heartpatch/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Executor } from '../../db/client.js';
import { instantOfLocal, localDate, mapLocalTime, MINUTE_MS } from '../../lib/time.js';
import { squishiesInTheDarkTonight } from '../hollow/service.js';
import { createSquishyJobsRepo } from '../jobs/repo.js';
import { workAt } from '../jobs/work.js';
import type { PushRepo } from './repo.js';
import { createPushSend, type PushCandidate, type PushSendTally } from './send.js';
import type { PushService } from './service.js';
import { pushOnFor, type PushSwitch } from './switch.js';

/*
 * The push sweep (#726c; the #726 plan's "How sends are triggered"). Every
 * minute, and once at boot, it works out from stored timestamps whose nudge
 * is due, and sends each at most once:
 *
 * 1. dusk, per patch: from `duskLeadMinutes` before nightfall until
 *    nightfall, in the patch's zone, to each member with a squishy sleeping
 *    in the dark tonight (the fire hint's check without its first-visit gate,
 *    owner answer 2). A window missed by downtime sends nothing.
 * 2. gatherers, per account: a node gather, a factory batch or a squishy
 *    gatherer (full) done for `gatherersIdleMinutes`, on a patch where the
 *    player isn't online; once an account day.
 * 3. for each, by `PUSH_RULES.priority`: dropped in quiet hours (the
 *    account's zone; owner answer 3), dropped past the daily cap, else
 *    claimed in `push_sends` (one statement; the unique key is the guard
 *    across restarts and overlapping sweeps), then delivered outside any
 *    transaction. A crash after the claim loses that nudge: at most once.
 *
 * Lock order (TECH_SPEC §7): game tables are only read here, never locked
 * (`lock: false`, as the fire hint reads them); push rows are leaves.
 */

// Moved to `send.ts` (#726d); still exported here for the sweep's callers.
export { accountDayStart } from './send.js';

/** What one sweep did. */
export interface PushSweepResult extends PushSendTally {
  /** Candidates found (before the switch, quiet hours and the cap). */
  due: number;
}

/** The dusk window a patch is in at `now`, or null outside it. */
export interface DuskWindow {
  /** 726f: `long-night-soon` / `long-night-start` join `dusk` here. */
  kind: 'dusk';
  /** The night whose nightfall is coming (map-local date). */
  night: LocalDate;
}

type SweepRules = Pick<
  PushRules,
  'duskLeadMinutes' | 'gatherersIdleMinutes' | 'quietHours' | 'dailyCap' | 'priority' | 'ttlSeconds'
>;

/**
 * Is the patch in its dusk window at `now`: from `duskLeadMinutes` before
 * tonight's nightfall (`HOME_BASE_RULES.nightfallMinute`, the patch's zone)
 * until nightfall?
 */
export function duskWindowOf(
  map: { timeZone: string },
  now: Date,
  rules: Pick<PushRules, 'duskLeadMinutes'> = PUSH_RULES,
): DuskWindow | null {
  const local = mapLocalTime(now, map.timeZone);
  // Before nightfall, "tonight" is today; from nightfall on, tomorrow.
  const night = tonightOf(local, HOME_BASE_RULES);
  const nightfallAt = instantOfLocal(
    { date: night, minute: HOME_BASE_RULES.nightfallMinute },
    map.timeZone,
    now,
  ).getTime();
  const duskAt = nightfallAt - rules.duskLeadMinutes * MINUTE_MS;
  if (now.getTime() < duskAt || now.getTime() >= nightfallAt) return null;
  // 726f: a Long Night on this patch tonight (`longNightOnMap` + `isLongNight`)
  // makes this `long-night-soon` and suppresses dusk; `long-night-start` gets
  // its own window from nightfall. Only `dusk` is sent until then.
  return { kind: 'dusk', night };
}

export interface PushSweepOptions {
  db: Executor;
  repo: PushRepo;
  log: FastifyBaseLogger;
  push: PushSwitch;
  deliver: PushService['deliver'];
  /** `wsHub.isOnline`: is the player's app open on this patch? No hub: nobody is. */
  isOnline?: (mapId: string, userId: string) => boolean;
  rules?: SweepRules;
}

export function createPushSweep(
  options: PushSweepOptions,
): (now: Date) => Promise<PushSweepResult> {
  const { db, repo, log, push, deliver } = options;
  const isOnline = options.isOnline ?? (() => false);
  const rules = options.rules ?? PUSH_RULES;

  /** 1. Dusk: each patch in its window, each member with a squishy in the dark tonight. */
  const duskCandidates = async (now: Date): Promise<PushCandidate[]> => {
    const found: PushCandidate[] = [];
    for (const map of await repo.duskMaps()) {
      const window = duskWindowOf(map, now, rules);
      if (window === null) continue;
      const recipients = (await repo.mapRecipients(map.id, 'dusk', now)).filter((u) =>
        pushOnFor(push, u),
      );
      if (recipients.length === 0) continue;
      const inTheDark = await squishiesInTheDarkTonight(db, map.id, window.night);
      for (const user of recipients) {
        if (!inTheDark.has(user.id)) continue;
        found.push({
          user,
          kind: window.kind,
          dedupeKey: `${map.id}/${window.night}`,
          mapId: map.id,
        });
      }
    }
    return found;
  };

  /** 2. Gatherers: one per account, for the first patch (id order) it's away from with something done. */
  const gathererCandidates = async (now: Date): Promise<PushCandidate[]> => {
    const idleBefore = new Date(now.getTime() - rules.gatherersIdleMinutes * MINUTE_MS);
    const rows = (await repo.gathererCandidates(now, idleBefore)).filter(
      (row) => pushOnFor(push, row.user) && !isOnline(row.map.id, row.user.id),
    );
    // A squishy gatherer counts once its basket was full by `idleBefore`.
    const workerIds = rows.flatMap((row) => (row.squishyId === null ? [] : [row.squishyId]));
    const jobs = new Map(
      (await createSquishyJobsRepo(db).listByIds(workerIds)).map((job) => [job.squishy.id, job]),
    );
    const found = new Map<string, PushCandidate>();
    for (const row of rows) {
      if (found.has(row.user.id)) continue;
      if (row.squishyId !== null) {
        const job = jobs.get(row.squishyId);
        if (!job || workAt(job, row.map, idleBefore)?.progress.full !== true) continue;
      }
      found.set(row.user.id, {
        user: row.user,
        kind: 'gatherers',
        dedupeKey: localDate(now, row.user.timeZone),
        mapId: row.map.id,
      });
    }
    return [...found.values()];
  };

  /** 3. Quiet hours, the cap, the claim, then the send (`send.ts`). */
  const send = createPushSend({ repo, deliver, rules });

  return async (now) => {
    const result: PushSweepResult = { due: 0, claimed: 0, delivered: 0, quiet: 0, capped: 0 };
    if (push.mode === 'off') return result;
    const candidates = [...(await duskCandidates(now)), ...(await gathererCandidates(now))];
    result.due = candidates.length;
    // The most important first, so the cap keeps those (`PUSH_RULES.priority`).
    const rank = (kind: PushKind) => rules.priority.indexOf(kind);
    candidates.sort(
      (a, b) =>
        rank(a.kind) - rank(b.kind) ||
        (a.user.id < b.user.id ? -1 : a.user.id > b.user.id ? 1 : 0) ||
        (a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0),
    );
    for (const candidate of candidates) {
      try {
        await send(candidate, now, result);
      } catch (err) {
        // One account's trouble never stops the others' nudges.
        log.error(
          { err, kind: candidate.kind, userId: candidate.user.id, mapId: candidate.mapId },
          'push sweep: a nudge failed',
        );
      }
    }
    return result;
  };
}
