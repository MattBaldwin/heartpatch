import { describe, expect, it } from 'vitest';
import * as publicEntry from '../index.js';
import * as serverEntry from './server/index.js';
import {
  checkComputerMatesSecrets,
  checkComputerPersonas,
  isComputerPersonaName,
} from '../schemas/data/computer-mates.js';
import { COMPUTER_PERSONAS } from './computer-personas.js';
import { COMPUTER_MATES } from './server/computer-mates.js';
import { RESOURCES } from './resources.js';
import { SELL_RULES, TRADE_VALUES } from './trading.js';

describe('computer patch-mates data (#386)', () => {
  it('has the six owner-approved personas, each tuned once', () => {
    expect(checkComputerPersonas(COMPUTER_PERSONAS)).toEqual([]);
    expect(COMPUTER_PERSONAS.map((p) => p.name)).toEqual([
      'Bramble',
      'Marigold',
      'Pocket',
      'Thistle',
      'Wren',
      'Fennel',
    ]);
    expect(checkComputerMatesSecrets(COMPUTER_MATES)).toEqual([]);
    expect(COMPUTER_MATES.personas.map((p) => p.id).sort()).toEqual(
      COMPUTER_PERSONAS.map((p) => p.id).sort(),
    );
  });

  it('refuses bad tuning', () => {
    const { rules } = COMPUTER_MATES;
    const bad = (patch: object) =>
      checkComputerMatesSecrets({ ...COMPUTER_MATES, rules: { ...rules, ...patch } });
    expect(bad({ fillTo: 0 })).not.toEqual([]);
    expect(bad({ stepMinutes: { min: 60, max: 20 } })).not.toEqual([]);
    expect(bad({ extra: 1 })).not.toEqual([]);
    const persona = COMPUTER_MATES.personas[0]!;
    expect(
      checkComputerMatesSecrets({
        ...COMPUTER_MATES,
        personas: [{ ...persona, levelOffset: 0 }],
      }),
    ).not.toEqual([]);
    expect(checkComputerPersonas([...COMPUTER_PERSONAS, COMPUTER_PERSONAS[0]])).not.toEqual([]);
  });

  it('lets a mate give everyday gathered resources only (386d)', () => {
    const byId = new Map(RESOURCES.map((r) => [r.id, r]));
    const { mateItems } = COMPUTER_MATES.rules;
    expect(new Set(mateItems).size).toBe(mateItems.length);
    for (const id of mateItems) {
      const item = byId.get(id);
      expect(item?.kind, id).toBe('gathered');
      expect(item?.tradable, id).not.toBe(false);
      expect(SELL_RULES.neverSold, id).not.toContain(id);
      expect(['heartdust', 'glimmer'], id).not.toContain(id);
      expect(TRADE_VALUES.items[id] ?? 0, id).toBeGreaterThan(0);
    }
  });

  it('matches persona names case-insensitively', () => {
    expect(isComputerPersonaName(COMPUTER_PERSONAS, ' bRAMBLE ')).toBe(true);
    expect(isComputerPersonaName(COMPUTER_PERSONAS, 'Brambles')).toBe(false);
  });

  it('keeps how they play server-only', () => {
    for (const name of [
      'COMPUTER_MATES',
      'ComputerMatesSecretsSchema',
      'checkComputerMatesSecrets',
    ]) {
      expect(name in serverEntry, name).toBe(true);
      expect(name in publicEntry, name).toBe(false);
    }
    expect('COMPUTER_PERSONAS' in publicEntry).toBe(true);
    for (const persona of COMPUTER_PERSONAS) expect('weights' in persona).toBe(false);
  });
});
