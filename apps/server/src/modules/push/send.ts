import { pushLineFor, quietHoursContain, type PushKind, type PushRules } from '@heartpatch/shared';
import { instantOfLocal, localDate, mapLocalTime } from '../../lib/time.js';
import type { PushRecipient, PushRepo } from './repo.js';
import type { PushDelivery, PushService } from './service.js';

/*
 * One nudge to one account, the same way for every kind (#726 plan,
 * "Server" item 4): dropped in quiet hours (the account's zone; owner answer
 * 3), dropped past the daily cap, else claimed in `push_sends` (one
 * statement; the unique key is the guard across restarts and overlapping
 * callers), then delivered outside any transaction and marked sent. A crash
 * after the claim loses that nudge: at most once. The sweep (#726c) and the
 * friend nudge (#726d) both send through here.
 */

/** One nudge to send. */
export interface PushCandidate {
  user: PushRecipient;
  kind: PushKind;
  /**
   * `push_sends.dedupe_key`: dusk `mapId/night`, gatherers the account day,
   * friend `mapId/arriverUserId/<repeat bucket>`.
   */
  dedupeKey: string;
  /** The patch the nudge opens. */
  mapId: string;
  /** The friend's username, for the friend kind's title (`pushLineFor`). */
  name?: string;
}

/** What the sends did, added up by the caller. */
export interface PushSendTally {
  /** Claimed in `push_sends` and handed to `deliver`. */
  claimed: number;
  /** Claimed and taken by at least one device. */
  delivered: number;
  /** Dropped in quiet hours. */
  quiet: number;
  /** Dropped at the daily cap. */
  capped: number;
}

export type PushSendRules = Pick<PushRules, 'quietHours' | 'dailyCap' | 'ttlSeconds'>;

/** When the account's day began (midnight in its zone): the daily cap counts from here. */
export function accountDayStart(now: Date, timeZone: string): Date {
  return instantOfLocal({ date: localDate(now, timeZone), minute: 0 }, timeZone, now);
}

/** Builds the send step; it adds to `tally` and may throw (callers log per candidate). */
export function createPushSend(options: {
  repo: PushRepo;
  deliver: PushService['deliver'];
  rules: PushSendRules;
}): (candidate: PushCandidate, now: Date, tally: PushSendTally) => Promise<void> {
  const { repo, deliver, rules } = options;
  return async (candidate, now, tally) => {
    const { user, kind } = candidate;
    if (quietHoursContain(mapLocalTime(now, user.timeZone).minute, rules.quietHours)) {
      tally.quiet += 1;
      return;
    }
    const dayStart = accountDayStart(now, user.timeZone);
    if ((await repo.claimedSince(user.id, dayStart)) >= rules.dailyCap) {
      tally.capped += 1;
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
    tally.claimed += 1;
    let delivery: PushDelivery = { devices: 0, delivered: 0 };
    try {
      delivery = await deliver(
        user,
        {
          v: 1,
          kind,
          ...pushLineFor(kind, candidate.name),
          mapId: candidate.mapId,
          tag: `${kind}:${candidate.mapId}`,
        },
        { ttlSeconds: rules.ttlSeconds[kind], topic: kind },
      );
    } finally {
      // Even when `deliver` failed partway: the claim records it went (at most once).
      await repo.markSent(claimId, delivery.delivered > 0 ? now : null, delivery.devices);
    }
    if (delivery.delivered > 0) tally.delivered += 1;
  };
}
