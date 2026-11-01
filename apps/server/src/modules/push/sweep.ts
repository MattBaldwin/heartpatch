import {
  HOME_BASE_RULES,
  pushLineFor,
  PUSH_RULES,
  quietHoursContain,
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
import type { PushRecipient, PushRepo } from './repo.js';
import type { PushDelivery, PushService } from './service.js';
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

/** One nudge the sweep would like to send. */
export interface PushCandidate {
  user: PushRecipient;
  kind: PushKind;
  /** `push_sends.dedupe_key`: dusk `mapId/night`, gatherers the account day. */
  dedupeKey: string;
  /** The patch the nudge opens. */
  mapId: string;
}

/** What one sweep did. */
export interface PushSweepResult {
  /** Candidates found (before the switch, quiet hours and the cap). */
  due: number;
  /** Claimed in `push_sends` and handed to `deliver`. */
  claimed: number;
  /** Claimed and taken by at least one device. */
  delivered: number;
  /** Dropped in quiet hours. */
  quiet: number;
  /** Dropped at the daily cap. */
  capped: number;
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

/** When the account's day began (midnight in its zone): the daily cap counts from here. */
export function accountDayStart(now: Date, timeZone: string): Date {
  return instantOfLocal({ date: localDate(now, timeZone), minute: 0 }, timeZone, now);
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

  /** 3. Quiet hours, the cap, the claim, then the send. */
  const send = async (
    candidate: PushCandidate,
    now: Date,
    result: PushSweepResult,
  ): Promise<void> => {
    const { user, kind } = candidate;
    if (quietHoursContain(mapLocalTime(now, user.timeZone).minute, rules.quietHours)) {
      result.quiet += 1;
      return;
    }
    const dayStart = accountDayStart(now, user.timeZone);
    if ((await repo.claimedSince(user.id, dayStart)) >= rules.dailyCap) {
      result.capped += 1;
      return;
    }
    const claimId = await repo.claim(
      {
        userId: user.id,
        kind,
        dedupeKey: candidate.dedupeKey,
        mapId: candidate.mapId,
        now,
        dayStart,
      },
      rules.dailyCap,
    );
    // Sent already (or the cap filled since the count): nothing to do.
    if (claimId === null) return;
    result.claimed += 1;
    let delivery: PushDelivery = { devices: 0, delivered: 0 };
    try {
      delivery = await deliver(
        user,
        {
          v: 1,
          kind,
          ...pushLineFor(kind),
          mapId: candidate.mapId,
          tag: `${kind}:${candidate.mapId}`,
        },
        { ttlSeconds: rules.ttlSeconds[kind], topic: kind },
      );
    } finally {
      // Even when `deliver` failed partway: the claim records it went (at most once).
      await repo.markSent(claimId, delivery.delivered > 0 ? now : null, delivery.devices);
    }
    if (delivery.delivered > 0) result.delivered += 1;
  };

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
