import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../net/api.js';
import { sendCommand, type SendDeps } from './send-command.js';

const deps = (waits: number[]): SendDeps => ({
  newKey: () => 'key-1',
  wait: (ms) => {
    waits.push(ms);
    return Promise.resolve();
  },
  retryAfterMs: 1200,
});
const offline = () => new ApiRequestError('OFFLINE', 'offline');

describe('sendCommand', () => {
  it('retries once after OFFLINE with the same key', async () => {
    const keys: string[] = [];
    const waits: number[] = [];
    const result = await sendCommand(
      deps(waits),
      (key) => {
        keys.push(key);
        return keys.length === 1 ? Promise.reject(offline()) : Promise.resolve('done');
      },
      () => true,
    );
    expect(result).toBe('done');
    expect(keys).toEqual(['key-1', 'key-1']);
    expect(waits).toEqual([1200]);
  });

  it('never retries a real answer from the server', async () => {
    let calls = 0;
    const conflict = new ApiRequestError('CONFLICT', 'Already collected!');
    await expect(
      sendCommand(
        deps([]),
        () => {
          calls += 1;
          return Promise.reject(conflict);
        },
        () => true,
      ),
    ).rejects.toBe(conflict);
    expect(calls).toBe(1);
  });

  it('drops the retry once the player has moved on', async () => {
    let wanted = true;
    let calls = 0;
    const result = await sendCommand(
      { ...deps([]), wait: () => ((wanted = false), Promise.resolve()) },
      () => {
        calls += 1;
        return Promise.reject(offline());
      },
      () => wanted,
    );
    expect(result).toBeNull();
    expect(calls).toBe(1);
  });
});
