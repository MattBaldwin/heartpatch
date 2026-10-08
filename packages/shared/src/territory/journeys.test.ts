import { describe, expect, it } from 'vitest';
import { GROWTH_RULES } from '../data/care.js';
import { JOURNEY_RULES } from '../data/journeys.js';
import { SPECIES } from '../data/species.js';
import { deriveSeed } from '../rng/index.js';
import { checkJourneyRules, type JourneyRules } from '../schemas/data/journeys.js';
import { journeyFor, journeyLevel, journeyTeam, journeyTeamSize, visitOpen } from './journeys.js';

const MAX = GROWTH_RULES.maxLevel;

describe('JOURNEY_RULES', () => {
  it('passes its checks: public, non-seasonal base forms only', () => {
    expect(checkJourneyRules(JOURNEY_RULES, SPECIES)).toEqual([]);
  });

  it('refuses an evolved, seasonal, unknown or repeated trail squishy', () => {
    const trail = ['splashmallow', 'gourdon', 'nobody', 'emberbun', 'emberbun'];
    const problems = checkJourneyRules({ ...JOURNEY_RULES, trail }, SPECIES).join('\n');
    expect(problems).toMatch(/"splashmallow" is not a base form/);
    expect(problems).toMatch(/"gourdon" is seasonal/);
    expect(problems).toMatch(/unknown species "nobody"/);
    expect(problems).toMatch(/listed twice/);
  });

  it('refuses team sizes that don’t start at 1 or go backwards, and a window that doesn’t divide 24', () => {
    const late = { ...JOURNEY_RULES, teamSize: [{ fromDistance: 2, size: 1 }] };
    expect(checkJourneyRules(late, SPECIES).join()).toMatch(/start at distance 1/);
    const back = {
      ...JOURNEY_RULES,
      teamSize: [
        { fromDistance: 1, size: 1 },
        { fromDistance: 5, size: 2 },
        { fromDistance: 3, size: 3 },
      ],
    };
    expect(checkJourneyRules(back, SPECIES).join()).toMatch(/go up by fromDistance/);
    expect(checkJourneyRules({ ...JOURNEY_RULES, windowHours: 5 }, SPECIES).join()).toMatch(
      /divide 24/,
    );
  });
});

describe('journey level and team size (acceptance: match the data at every distance, no cap)', () => {
  it('is baseLevel + levelsPerTile × distance at every distance', () => {
    for (let d = 1; d <= 40; d++) {
      const level = JOURNEY_RULES.baseLevel + JOURNEY_RULES.levelsPerTile * d;
      expect(journeyLevel(d, JOURNEY_RULES, MAX)).toBe(Math.min(level, MAX));
    }
    // The shipped draft (#30 contract §4): 6 at 1 tile, 24 at 10.
    expect(journeyLevel(1, JOURNEY_RULES, MAX)).toBe(6);
    expect(journeyLevel(10, JOURNEY_RULES, MAX)).toBe(24);
  });

  it('has no cap of its own: only the game’s top level stops it', () => {
    expect(journeyLevel(30, JOURNEY_RULES, MAX)).toBe(64);
    expect(journeyLevel(60, JOURNEY_RULES, MAX)).toBe(MAX);
  });

  it('follows the team-size rows: 1 at 1–2, 2 at 3–5, 3 from 6', () => {
    const sizes = [1, 2, 3, 4, 5, 6, 7, 20].map((d) => journeyTeamSize(d, JOURNEY_RULES));
    expect(sizes).toEqual([1, 1, 2, 2, 2, 3, 3, 3]);
  });

  it('reads any rows from the data, not fixed numbers', () => {
    const rules: JourneyRules = {
      ...JOURNEY_RULES,
      baseLevel: 2,
      levelsPerTile: 5,
      teamSize: [
        { fromDistance: 1, size: 2 },
        { fromDistance: 4, size: 3 },
      ],
    };
    expect(journeyFor(3, rules, MAX)).toEqual({ level: 17, teamSize: 2 });
    expect(journeyFor(4, rules, MAX)).toEqual({ level: 22, teamSize: 3 });
  });
});

describe('journeyTeam (acceptance: a retry in the same window meets the same team)', () => {
  const seed = deriveSeed('map-seed', 'journey', 3, -2, 'kid', '2026-11-04/2');

  it('is the same team for the same seed', () => {
    expect(journeyTeam({ seed, distance: 4 }, JOURNEY_RULES, MAX)).toEqual(
      journeyTeam({ seed, distance: 4 }, JOURNEY_RULES, MAX),
    );
  });

  it('has the size and level for its distance, from the trail pool only', () => {
    const team = journeyTeam({ seed, distance: 7 }, JOURNEY_RULES, MAX);
    expect(team.map((s) => s.id)).toEqual(['trail-1', 'trail-2', 'trail-3']);
    for (const s of team) {
      expect(s.level).toBe(18);
      expect(JOURNEY_RULES.trail).toContain(s.speciesId);
    }
  });

  it('changes with the window (a new window may meet someone new)', () => {
    const teams = new Set(
      [0, 1, 2, 3, 4, 5].map((w) =>
        journeyTeam(
          {
            seed: deriveSeed('map-seed', 'journey', 3, -2, 'kid', `2026-11-04/${String(w)}`),
            distance: 7,
          },
          JOURNEY_RULES,
          MAX,
        )
          .map((s) => s.speciesId)
          .join(),
      ),
    );
    expect(teams.size).toBeGreaterThan(1);
  });
});

describe('visitOpen', () => {
  const now = new Date('2026-11-04T10:00:00Z');
  it('is open until the pass runs out, and never without one', () => {
    expect(visitOpen('2026-11-04T10:00:01Z', now)).toBe(true);
    expect(visitOpen(new Date('2026-11-04T10:00:00Z'), now)).toBe(false);
    expect(visitOpen(null, now)).toBe(false);
    expect(visitOpen(undefined, now)).toBe(false);
  });
});
