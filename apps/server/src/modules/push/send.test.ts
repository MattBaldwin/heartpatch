import { PUSH_RULES } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import type { PushClaimResult, PushRepo } from './repo.js';
import { createPushSend, type PushCandidate, type PushSendTally } from './send.js';

// The send step's tally (#726c/#726d), without a database: the sweep and the
// friend nudge both add up through here.

const NOON = new Date('2026-10-14T18:00:00Z'); // noon in Denver: no quiet hours

/** A repo whose count says "room" and whose claim answers `outcome`. */
function fakeRepo(outcome: PushClaimResult) {
  const marked: string[] = [];
  const repo = {
    claimedSince: () => Promise.resolve(0),
    claim: () => Promise.resolve(outcome),
    markSent: (id: string) => {
      marked.push(id);
      return Promise.resolve();
    },
  } as unknown as PushRepo;
  return { repo, marked };
}

const candidate: PushCandidate = {
  user: { id: 'kid', username: 'kid', timeZone: 'America/Denver' },
  kind: 'friend',
  dedupeKey: 'map/arriver',
  mapId: 'map',
  name: 'Moonberry',
};

const empty = (): PushSendTally => ({ claimed: 0, delivered: 0, quiet: 0, capped: 0 });

describe('createPushSend', () => {
  it('counts a claim refused by its own cap re-check as capped, and sends nothing', async () => {
    const { repo, marked } = fakeRepo({ outcome: 'capped' });
    const delivered: unknown[] = [];
    const send = createPushSend({
      repo,
      deliver: (user) => {
        delivered.push(user);
        return Promise.resolve({ devices: 1, delivered: 1 });
      },
      rules: PUSH_RULES,
    });
    const tally = empty();
    await send(candidate, NOON, tally);
    expect(tally).toEqual({ claimed: 0, delivered: 0, quiet: 0, capped: 1 });
    expect(delivered).toEqual([]);
    expect(marked).toEqual([]);
  });

  it('a send claimed already counts as nothing', async () => {
    const { repo } = fakeRepo({ outcome: 'sent' });
    const send = createPushSend({
      repo,
      deliver: () => Promise.reject(new Error('should not send')),
      rules: PUSH_RULES,
    });
    const tally = empty();
    await send(candidate, NOON, tally);
    expect(tally).toEqual(empty());
  });

  it('a claim goes out and is marked sent', async () => {
    const { repo, marked } = fakeRepo({ outcome: 'claimed', id: 'claim-1' });
    const send = createPushSend({
      repo,
      deliver: () => Promise.resolve({ devices: 2, delivered: 1 }),
      rules: PUSH_RULES,
    });
    const tally = empty();
    await send(candidate, NOON, tally);
    expect(tally).toEqual({ claimed: 1, delivered: 1, quiet: 0, capped: 0 });
    expect(marked).toEqual(['claim-1']);
  });
});
