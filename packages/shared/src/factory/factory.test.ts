import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.js';
import { FACTORY_RULES } from '../data/factory.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { FactoryRulesSchema } from '../schemas/data/factory.js';
import { isBuildable } from '../schemas/data/home-base.js';
import {
  affordableRuns,
  factoryDone,
  factoryDoneAtMs,
  factoryNextAtMs,
  factoryQueues,
  stopRuns,
  timesItems,
} from './index.js';

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const batch = { total: 10, itemSeconds: 60, startedAtMs: T0 };
const at = (seconds: number) => T0 + seconds * 1000;

describe('Crafting Factory batches (#294)', () => {
  it('makes one thing every itemSeconds, up to the total', () => {
    expect(factoryDone(batch, at(-5))).toBe(0);
    expect(factoryDone(batch, at(0))).toBe(0);
    expect(factoryDone(batch, at(59))).toBe(0);
    expect(factoryDone(batch, at(60))).toBe(1);
    expect(factoryDone(batch, at(4 * 60 + 30))).toBe(4);
    expect(factoryDone(batch, at(10 * 60))).toBe(10);
    // Never more than the batch, however long the kid is away.
    expect(factoryDone(batch, at(99 * 24 * 3600))).toBe(10);
  });

  it('says when the next one and the last one finish', () => {
    expect(factoryNextAtMs(batch, at(0))).toBe(at(60));
    expect(factoryNextAtMs(batch, at(4 * 60 + 30))).toBe(at(5 * 60));
    expect(factoryNextAtMs(batch, at(9 * 60))).toBe(at(10 * 60));
    expect(factoryNextAtMs(batch, at(10 * 60))).toBeNull();
    expect(factoryDoneAtMs(batch)).toBe(at(10 * 60));
  });

  it('counts how many runs the bag can pay for, up to the cap', () => {
    const charm = { timber: 2, treats: 1 };
    expect(affordableRuns({ timber: 28, treats: 12 }, charm, 999)).toBe(12);
    expect(affordableRuns({ timber: 5, treats: 12 }, charm, 999)).toBe(2);
    expect(affordableRuns({ timber: 28 }, charm, 999)).toBe(0);
    expect(affordableRuns({ timber: 28, treats: 12 }, charm, 3)).toBe(3);
    expect(affordableRuns({}, {}, 7)).toBe(7);
  });

  it('multiplies a run by a count', () => {
    expect(timesItems({ timber: 2, treats: 1 }, 5)).toEqual({ timber: 10, treats: 5 });
    expect(timesItems({ treats: 3 }, 0)).toEqual({});
  });

  it('keeps what is made and gives back everything else when stopped, the one in progress too', () => {
    expect(stopRuns(batch, at(4 * 60 + 30))).toEqual({ kept: 4, refunded: 6 });
    expect(stopRuns(batch, at(0))).toEqual({ kept: 0, refunded: 10 });
    expect(stopRuns(batch, at(10 * 60))).toEqual({ kept: 10, refunded: 0 });
  });

  it('runs 2, 3 and 4 batches at levels 1 to 3, and none for other buildings', () => {
    const factory = BUILDINGS.find((b) => b.id === 'crafting-factory');
    expect([1, 2, 3].map((l) => factoryQueues(factory, l))).toEqual([2, 3, 4]);
    expect(factoryQueues(factory, 9)).toBe(4);
    expect(
      factoryQueues(
        BUILDINGS.find((b) => b.id === 'hearthfire'),
        1,
      ),
    ).toBe(0);
    expect(factoryQueues(undefined, 1)).toBe(0);
  });

  it('is one home-ring building a player can build, with valid rules', () => {
    const factories = BUILDINGS.filter((b) => b.kind === 'factory');
    expect(factories.map((b) => b.id)).toEqual(['crafting-factory']);
    const [factory] = factories;
    expect(factory).toMatchObject({ placement: 'home', slot: 'ring', maxPerHome: 1 });
    expect(factory && isBuildable(HOME_BASE_RULES, factory)).toBe(true);
    expect(FactoryRulesSchema.parse(FACTORY_RULES)).toEqual(FACTORY_RULES);
  });
});
