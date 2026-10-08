import { describe, expect, it } from 'vitest';
import { TERRITORY_RULES } from '../data/territory.js';
import { checkTerritoryRules } from '../schemas/data/territory.js';
import {
  attackTargetProblem,
  challengeRewardPercent,
  dailyLossCap,
  isOnWatch,
  landCount,
  tileBattleKindFor,
  type TerritoryTile,
} from './index.js';

const ME = 'me';
const RIVAL = 'rival';
const tile = (
  q: number,
  r: number,
  ownerUserId: string | null = null,
  homeSlot: number | null = null,
) => ({ q, r, ownerUserId, homeSlot }) satisfies TerritoryTile;

// My home tile at (0,0); a neighbour of mine at (1,0); a rival's tile at (2,0)
// next to it; a rival home tile at (1,-1), also next to mine; and far land.
const TILES: TerritoryTile[] = [
  tile(0, 0, ME, 0),
  tile(1, 0, ME),
  tile(2, 0, RIVAL),
  tile(1, -1, RIVAL, 1),
  tile(2, -1),
  tile(5, 5),
];
const at = (q: number, r: number) => TILES.find((t) => t.q === q && t.r === r)!;

describe('territory rules', () => {
  it('accepts the shipped raid rules', () => {
    expect(checkTerritoryRules(TERRITORY_RULES)).toEqual([]);
    expect(checkTerritoryRules({ ...TERRITORY_RULES, attemptsPerDay: 0 }).join()).toMatch(
      /attemptsPerDay/,
    );
  });

  it('only lets a player battle for land next to theirs, never a home base', () => {
    expect(attackTargetProblem(at(2, -1), TILES, ME, 'gentle')).toBeNull();
    expect(attackTargetProblem(at(2, 0), TILES, ME, 'gentle')).toBeNull();
    expect(attackTargetProblem(at(1, -1), TILES, ME, 'on')).toBe('home');
    expect(attackTargetProblem(at(0, 0), TILES, ME, 'on')).toBe('home');
    expect(attackTargetProblem(at(1, 0), TILES, ME, 'on')).toBe('mine');
    expect(attackTargetProblem(at(5, 5), TILES, ME, 'on')).toBe('too-far');
  });

  it('never lets anyone battle for a trading post (#269), even right next to their land', () => {
    const post = { ...tile(2, -1), terrain: 'trading-post' };
    expect(attackTargetProblem(post, TILES, ME, 'on')).toBe('post');
    expect(attackTargetProblem({ ...post, terrain: 'meadow' }, TILES, ME, 'on')).toBeNull();
  });

  it('blocks challenges, not claims, when PvP is Off', () => {
    expect(attackTargetProblem(at(2, 0), TILES, ME, 'off')).toBe('pvp-off');
    expect(attackTargetProblem(at(2, -1), TILES, ME, 'off')).toBeNull();
    expect(tileBattleKindFor(at(2, -1))).toBe('tile');
    expect(tileBattleKindFor(at(2, 0))).toBe('rival-tile');
  });

  it('caps daily tile losses by PvP mode', () => {
    expect(dailyLossCap(TERRITORY_RULES, 'on')).toBe(3);
    expect(dailyLossCap(TERRITORY_RULES, 'gentle')).toBe(1);
    expect(dailyLossCap(TERRITORY_RULES, 'off')).toBe(0);
  });

  it('counts land without home rings, and halves rewards for picking on much smaller players under Gentle', () => {
    expect(landCount(TILES, ME)).toBe(1);
    expect(landCount(TILES, RIVAL)).toBe(1);
    expect(challengeRewardPercent(TERRITORY_RULES, 'gentle', 10, 4)).toBe(50);
    expect(challengeRewardPercent(TERRITORY_RULES, 'gentle', 10, 5)).toBe(100);
    expect(challengeRewardPercent(TERRITORY_RULES, 'gentle', 0, 0)).toBe(100);
    expect(challengeRewardPercent(TERRITORY_RULES, 'on', 10, 1)).toBe(100);
  });

  it('counts a squishy on watch only on its owner’s land (decision C)', () => {
    const squishy = { ownerUserId: ME, state: 'active' as const };
    expect(isOnWatch(squishy, { tileOwnerUserId: ME })).toBe(true);
    expect(isOnWatch(squishy, null)).toBe(false);
    expect(isOnWatch(squishy, { tileOwnerUserId: RIVAL })).toBe(false);
    expect(isOnWatch(squishy, { tileOwnerUserId: null })).toBe(false);
    expect(isOnWatch({ ...squishy, state: 'hollowed' }, { tileOwnerUserId: ME })).toBe(false);
  });
});
