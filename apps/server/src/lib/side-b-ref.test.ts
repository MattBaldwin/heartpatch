import { uuidv7 } from 'uuidv7';
import { describe, expect, it } from 'vitest';
import { sideBRefId } from './side-b-ref.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('side b’s coin key (#728)', () => {
  it('sideBRefId is stable and differs from the battle id', () => {
    const battleId = uuidv7();
    expect(sideBRefId(battleId)).toBe(sideBRefId(battleId));
    expect(sideBRefId(battleId)).not.toBe(battleId);
    expect(sideBRefId(battleId)).toMatch(UUID);
    expect(sideBRefId(uuidv7())).not.toBe(sideBRefId(battleId));
  });
});
