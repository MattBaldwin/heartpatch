import { GAME_DATA } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { bossLooksProblem, loadBossLooks } from './boss-looks.js';

const json =
  (status: number, body: unknown): typeof fetch =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('loadBossLooks', () => {
  const body = GAME_DATA.species[0];

  it('parses each look with the public visual schema', async () => {
    const reply = { looks: [{ id: 'x', name: 'X', rarity: 'mythic', visual: body?.visual }] };
    const got = await loadBossLooks(json(200, reply));
    expect(got.problem).toBeNull();
    expect(got.looks.map((l) => l.id)).toEqual(['x']);
  });

  it('refuses a look that is not a public visual', async () => {
    const reply = { looks: [{ id: 'x', name: 'X', rarity: 'mythic', visual: { body: 1 } }] };
    const got = await loadBossLooks(json(200, reply));
    expect(got.looks).toEqual([]);
    expect(got.problem).toMatch(/Could not read/);
  });

  it('says to sign in on a 401 and to enable the dev flag on a 404', async () => {
    const err = (code: string) => ({ error: { code, message: 'no' } });
    const signedOut = await loadBossLooks(json(401, err('UNAUTHENTICATED')));
    expect(signedOut.problem).toMatch(/Sign in/);
    const off = await loadBossLooks(json(404, err('NOT_FOUND')));
    expect(off.problem).toMatch(/HP_DEV_SQUISHY_GRANTS/);
  });

  it('says so when the server cannot be reached', () => {
    expect(bossLooksProblem(new Error('boom'))).toMatch(/boom/);
  });
});
