import { describe, expect, it } from 'vitest';
import { TERRITORY_RULES } from '../../src/data/territory.js';
import {
  ENGAGED,
  FADING_GENTLE,
  FADING_ON,
  MAP_FILL_CONFIG,
  MAP_FILL_RULES,
  MAP_FILL_SCENARIOS,
  NO_FADING,
  PART_TIME,
  type MapFillScenario,
} from './map-fill-config.js';
import { awayTiles, renderMapFill, summariseMapFill } from './map-fill-report.js';
import { runMapFill } from './map-fill.js';

const SHORT = { ...MAP_FILL_CONFIG, days: 60 };
const scenario = (id: string): MapFillScenario => {
  const found = MAP_FILL_SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`no scenario ${id}`);
  return found;
};
/** Home ring (7) plus the ring outside it (12) never fade with `keepRadius: 2`. */
const KEPT = 19;

describe('runMapFill', () => {
  it('gives the same run for the same config and data', () => {
    const run = () => runMapFill(scenario('engaged-stops'), FADING_GENTLE, SHORT);
    expect(run()).toEqual(run());
  });

  it('never takes land from kids who keep playing, even three days a week', () => {
    for (const id of ['engaged-2', 'casual-2', 'part-time-2', 'four-one-stops']) {
      for (const rules of [FADING_GENTLE, FADING_ON]) {
        expect(summariseMapFill(runMapFill(scenario(id), rules, SHORT)).lostByPlayers).toBe(0);
      }
    }
  });

  it('keeps everything for a week away, then gives land back a little at a time', () => {
    expect(TERRITORY_RULES.tending.keepRadius).toBe(2);
    const run = runMapFill(scenario('engaged-stops'), FADING_GENTLE, SHORT);
    const away = awayTiles(run, [3, 7, 14, 30])!;
    expect(away.away[0]!.tiles).toBe(away.atStop);
    expect(away.away[1]!.tiles).toBe(away.atStop);
    expect(away.away[2]!.tiles!).toBeLessThan(away.atStop!);
    const perNight = TERRITORY_RULES.tending.wildPerNight.gentle;
    const stop = scenario('engaged-stops').seats[1]!.stopsAfterDay!;
    run.days.forEach((d, i) => {
      expect(d.wentWild[1]).toBeLessThanOrEqual(perNight);
      if (d.day > stop) expect(d.tiles[1]).toBeGreaterThanOrEqual(KEPT);
      const before = run.days[i - 1];
      if (before && d.day <= stop) expect(d.wentWild[1]).toBe(0);
    });
  });

  it('gives the kid who keeps playing land to claim once a rival stops', () => {
    const frozen = summariseMapFill(runMapFill(scenario('engaged-stops'), NO_FADING, SHORT));
    const fading = summariseMapFill(runMapFill(scenario('engaged-stops'), FADING_GENTLE, SHORT));
    expect(fading.nothingToClaim[0]!).toBeLessThan(frozen.nothingToClaim[0]!);
    expect(fading.reclaimed).toBeGreaterThan(0);
  });

  it('plays only on a kid’s play days', () => {
    const run = runMapFill(
      { id: 'pt', title: 'pt', mapSeats: 2, seats: [{ kid: PART_TIME, stopsAfterDay: null }] },
      NO_FADING,
      { ...SHORT, days: 7 },
    );
    // Tuesday (day 2) is not a play day: nothing new is claimed.
    expect(run.days[1]!.tiles[0]).toBe(run.days[0]!.tiles[0]);
    expect(run.days[2]!.tiles[0]).toBeGreaterThan(run.days[1]!.tiles[0]!);
  });

  it('renders every table', () => {
    const runs = MAP_FILL_RULES.map((rules) =>
      runMapFill(
        {
          id: 'one-stops',
          title: 'one stops',
          mapSeats: 2,
          seats: [
            { kid: ENGAGED, stopsAfterDay: null },
            { kid: ENGAGED, stopsAfterDay: 20 },
          ],
        },
        rules,
        { ...SHORT, days: 40 },
      ),
    );
    const report = renderMapFill(runs, MAP_FILL_RULES, { days: 40, awayDays: [3, 7], seconds: 1 });
    expect(report).toMatch(/Map-full day/);
    expect(report).toMatch(/Tiles a kid keeps after stopping/);
    expect(report).toMatch(/\| 7 days \|/);
  });
});
