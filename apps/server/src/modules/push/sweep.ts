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
import { isLongNightOn } from '../long-night/service.js';
import { LONG_NIGHT_OFF, type LongNightSwitch } from '../long-night/switch.js';
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
 *    On a Long Night (#726f) the patch's members with `long_night` on get
 *    `long-night-soon` from `longNightLeadMinutes` before nightfall instead
 *    (no dusk that night: the call replaces it), and `long-night-start` for
 *    `longNightStartWindowMinutes` from nightfall. Neither needs a squishy
 *    in the dark, and push code only ever learns yes or no (rule 6).
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
  kind: 'dusk';
  /** The night whose nightfall is coming (map-local date). */
  night: LocalDate;
}

/** The Long Night call a patch would get at `now` if `night` is a Long Night there. */
export interface LongNightWindow {
  kind: 'long-night-soon' | 'long-night-start';
  /** Soon: the night whose nightfall is coming. Start: the night that just began. */
  night: LocalDate;
}

type SweepRules = Pick<
  PushRules,
  | 'duskLeadMinutes'
  | 'longNightLeadMinutes'
  | 'longNightStartWindowMinutes'
  | 'gatherersIdleMinutes'
  | 'quietHours'
  | 'dailyCap'
  | 'priority'
  | 'ttlSeconds'
>;

/** Nightfall on a map-local date, as an instant in the patch's zone. */
const nightfallOf = (night: LocalDate, timeZone: string, now: Date): number =>
  instantOfLocal({ date: night, minute: HOME_BASE_RULES.nightfallMinute }, timeZone, now).getTime();

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
  const nightfallAt = nightfallOf(night, map.timeZone, now);
  const duskAt = nightfallAt - rules.duskLeadMinutes * MINUTE_MS;
  if (now.getTime() < duskAt || now.getTime() >= nightfallAt) return null;
  // A Long Night tonight suppresses this (the sweep checks; `longNightWindowOf`).
  return { kind: 'dusk', night };
}

/**
 * The Long Night call window a patch is in at `now`, in its zone:
 * `long-night-start` from today's nightfall for `longNightStartWindowMinutes`,
 * else `long-night-soon` from `longNightLeadMinutes` before tonight's
 * nightfall until it. Null outside both. Whether the night really is a Long
 * Night there is the caller's to check (it needs the database).
 */
export function longNightWindowOf(
  map: { timeZone: string },
  now: Date,
  rules: Pick<PushRules, 'longNightLeadMinutes' | 'longNightStartWindowMinutes'> = PUSH_RULES,
): LongNightWindow | null {
  const local = mapLocalTime(now, map.timeZone);
  const at = now.getTime();
  // `tonightOf` has already moved on to tomorrow at nightfall: the Night that
  // just began is named by today's date.
  const begunAt = nightfallOf(local.date, map.timeZone, now);
  if (at >= begunAt && at < begunAt + rules.longNightStartWindowMinutes * MINUTE_MS) {
    return { kind: 'long-night-start', night: local.date };
  }
  const night = tonightOf(local, HOME_BASE_RULES);
  const nightfallAt = nightfallOf(night, map.timeZone, now);
  if (at >= nightfallAt - rules.longNightLeadMinutes * MINUTE_MS && at < nightfallAt) {
    return { kind: 'long-night-soon', night };
  }
  return null;
}

export interface PushSweepOptions {
  db: Executor;
  repo: PushRepo;
  log: FastifyBaseLogger;
  push: PushSwitch;
  deliver: PushService['deliver'];
  /** `longNightSwitchOf(config)` (`HP_LONG_NIGHT`); off by default: dusk every night. */
  longNight?: LongNightSwitch;
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
  const longNight = options.longNight ?? LONG_NIGHT_OFF;

  /**
   * 1. Dusk and the Long Night: each patch in a window. The Long Night's
   * calls go to every member with `long_night` on; dusk, on any other night,
   * to each member with a squishy in the dark tonight.
   */
  const duskCandidates = async (now: Date): Promise<PushCandidate[]> => {
    const found: PushCandidate[] = [];
    for (const map of await repo.duskMaps()) {
      const dusk = duskWindowOf(map, now, rules);
      const call = longNightWindowOf(map, now, rules);
      if (dusk === null && call === null) continue;
      // At most two nights to ask about; usually one (soon and dusk share it).
      const asked = new Map<LocalDate, Promise<boolean>>();
      const isLong = (night: LocalDate) => {
        let answer = asked.get(night);
        if (answer === undefined) {
          answer = isLongNightOn(db, longNight, map, night);
          asked.set(night, answer);
        }
        return answer;
      };
      if (call !== null && (await isLong(call.night))) {
        const recipients = (await repo.mapRecipients(map.id, 'longNight', now)).filter((u) =>
          pushOnFor(push, u),
        );
        for (const user of recipients) {
          found.push({
            user,
            kind: call.kind,
            dedupeKey: `${map.id}/${call.night}`,
            mapId: map.id,
          });
        }
      }
      if (dusk === null || (await isLong(dusk.night))) continue;
      const window = dusk;
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
