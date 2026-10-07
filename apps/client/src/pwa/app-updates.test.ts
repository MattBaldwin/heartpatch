import type { BuildInfo } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { createAppUpdates, serverIsNewer, versionView } from './app-updates.js';
import { createUpdateHold } from './update-hold.js';

const client: BuildInfo = { number: 214, commit: 'cb04682', date: '2026-10-06' };

describe('versionView (#198)', () => {
  it('shows the version, quietly, when nothing is newer', () => {
    expect(versionView(client, { build: 214, commit: 'cb04682' }, false)).toEqual({
      text: 'v0.214 · cb04682 · 2026-10-06',
      updateReady: false,
    });
  });

  it('says update ready when a new service worker is waiting', () => {
    expect(versionView(client, null, true)).toEqual({
      text: 'v0.214 · cb04682 · 2026-10-06 · update ready',
      updateReady: true,
    });
  });

  it('says update ready when the server is a newer build', () => {
    expect(versionView(client, { build: 216, commit: '9d82b6c' }, false).updateReady).toBe(true);
  });

  it('says v0.dev for a build made without git, and never offers an update for it', () => {
    expect(versionView(null, { build: 216, commit: '9d82b6c' }, false)).toEqual({
      text: 'v0.dev',
      updateReady: false,
    });
  });
});

describe('serverIsNewer', () => {
  it('is false for the same commit, an older server, or a server without a build', () => {
    expect(serverIsNewer(client, { build: 214, commit: 'cb04682' })).toBe(false);
    // A rolled-back server is older, not an update.
    expect(serverIsNewer(client, { build: 213, commit: '10697fd' })).toBe(false);
    expect(serverIsNewer(client, { build: null, commit: null })).toBe(false);
    expect(serverIsNewer(client, null)).toBe(false);
  });
});

describe('createAppUpdates', () => {
  it("applies the waiting worker's update (which waits for the hold itself)", () => {
    let reloads = 0;
    let applied = 0;
    const updates = createAppUpdates({ hold: createUpdateHold(), reload: () => reloads++ });
    expect(updates.workerWaiting).toBe(false);
    updates.offer(() => applied++);
    expect(updates.workerWaiting).toBe(true);
    updates.apply();
    updates.apply();
    expect({ applied, reloads }).toEqual({ applied: 1, reloads: 0 });
  });

  it('offers a newer worker again after the one being applied was replaced', () => {
    const applied: string[] = [];
    const updates = createAppUpdates({ hold: createUpdateHold(), reload: () => undefined });
    updates.offer(() => applied.push('first'));
    updates.apply();
    expect(updates.applying).toBe(true);
    // The first went redundant while held; update-flow offers the newer one.
    updates.offer(() => applied.push('second'));
    expect(updates.applying).toBe(false);
    updates.apply();
    expect(applied).toEqual(['first', 'second']);
  });

  it('reloads for a newer server, but never while updates are held (#47)', () => {
    const hold = createUpdateHold();
    let reloads = 0;
    const updates = createAppUpdates({ hold, reload: () => reloads++ });
    const release = hold.hold();
    updates.apply();
    expect(reloads).toBe(0);
    release();
    expect(reloads).toBe(1);
  });
});
