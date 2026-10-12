import type { JobsView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import type { JobsApi } from './jobs-api.js';
import { createViewFeed } from './view-feed.js';

/** A view the tests tell apart by `now`. */
const viewAt = (now: number) => ({ now }) as unknown as JobsView;

/** A jobs API whose replies the test hands out, in any order. */
function slowApi() {
  const waiting: { resolve: (view: JobsView) => void }[] = [];
  const reply = () =>
    new Promise<JobsView>((resolve) => {
      waiting.push({ resolve });
    });
  const api: JobsApi = { view: reply, setJob: reply, setTeam: reply };
  return { api, waiting };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('createViewFeed (#393)', () => {
  it('hands each view on to every listener, and back to the caller', async () => {
    const { api, waiting } = slowApi();
    const feed = createViewFeed(api);
    const seen: [string, number][] = [];
    feed.listen((mapId, view) => seen.push([mapId, view.now as unknown as number]));
    const got = feed.api.setJob('m1', 's1', { job: 'resting' } as never, 'k');
    waiting[0]!.resolve(viewAt(1));
    expect(await got).toEqual(viewAt(1));
    expect(seen).toEqual([['m1', 1]]);
  });

  it('never lets a slow, older read roll back a job just set', async () => {
    const { api, waiting } = slowApi();
    const feed = createViewFeed(api);
    const seen: number[] = [];
    feed.listen((_, view) => seen.push(view.now as unknown as number));
    const older = feed.api.view('m1');
    const newer = feed.api.setJob('m1', 's1', { job: 'resting' } as never, 'k');
    waiting[1]!.resolve(viewAt(2));
    await newer;
    waiting[0]!.resolve(viewAt(1));
    // The caller still gets its own reply; the listeners keep the newer one.
    expect(await older).toEqual(viewAt(1));
    expect(seen).toEqual([2]);
  });

  it('keeps maps apart', async () => {
    const { api, waiting } = slowApi();
    const feed = createViewFeed(api);
    const seen: string[] = [];
    feed.listen((mapId) => seen.push(mapId));
    const a = feed.api.view('m1');
    const b = feed.api.view('m2');
    waiting[1]!.resolve(viewAt(2));
    waiting[0]!.resolve(viewAt(1));
    await Promise.all([a, b]);
    expect(seen).toEqual(['m2', 'm1']);
  });

  it('drops views asked for before a reset (another player signed in)', async () => {
    const { api, waiting } = slowApi();
    const feed = createViewFeed(api);
    const seen: number[] = [];
    feed.listen((_, view) => seen.push(view.now as unknown as number));
    const before = feed.api.view('m1');
    feed.reset();
    waiting[0]!.resolve(viewAt(1));
    await before;
    await settle();
    expect(seen).toEqual([]);
    const after = feed.api.view('m1');
    waiting[1]!.resolve(viewAt(2));
    await after;
    expect(seen).toEqual([2]);
  });
});
