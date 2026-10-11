import { defaultKeeperConfig, KEEPER_DATA, type KeeperConfig } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { saveForSession } from './keeper-save.js';

const pip = defaultKeeperConfig(KEEPER_DATA.bases[0]!);

/** A save that answers only when told to. */
function deferredSave() {
  let answer: (config: KeeperConfig) => void = () => undefined;
  const save = (config: KeeperConfig) =>
    new Promise<KeeperConfig>((resolve) => {
      answer = () => {
        resolve(config);
      };
    });
  return {
    save,
    answer: (config: KeeperConfig) => {
      answer(config);
    },
  };
}

describe('saving a Keeper (#372)', () => {
  it('keeps what the server kept, complete, for the same player', async () => {
    const { save, answer } = deferredSave();
    const pending = saveForSession(save, { ...pip, face: 'juniper' }, () => 1);
    answer(pip);
    expect(await pending).toMatchObject({ base: 'pip', face: 'juniper', body: 'pip' });
  });

  it('drops a late save once another player has logged in', async () => {
    let session = 1;
    const { save, answer } = deferredSave();
    const pending = saveForSession(save, { ...pip, face: 'juniper' }, () => session);
    session = 2; // someone else logged in while it was on its way
    answer(pip);
    expect(await pending).toBeNull();
  });
});
