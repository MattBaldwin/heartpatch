import { GAME_DATA } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { WEATHER_EMOJI } from '../weather/weather-model.js';
import { weatherNotesLine } from './night-text.js';

const [first, second, third, fourth] = GAME_DATA.buildings;

describe('weatherNotesLine', () => {
  it('says nothing with nothing knocked', () => {
    expect(weatherNotesLine([])).toBeNull();
  });

  it('names one building and asks kindly for a fix', () => {
    const line = weatherNotesLine([{ buildingId: first!.id }]);
    expect(line?.text).toBe(`The storm knocked your ${first!.name} about. Fix it when you can!`);
    expect(line?.icon).toBe(WEATHER_EMOJI.storm);
  });

  it.each([
    ['storm', 'The storm'],
    ['rain', 'The rain'],
    ['fog', 'The fog'],
    ['drought', 'The dry spell'],
  ] as const)('a %s gets its own emoji, as the icon and never mid-sentence', (kind, who) => {
    const line = weatherNotesLine([{ buildingId: first!.id }], kind);
    expect(line?.icon).toBe(WEATHER_EMOJI[kind]);
    expect(line?.text).toBe(`${who} knocked your ${first!.name} about. Fix it when you can!`);
    for (const emoji of Object.values(WEATHER_EMOJI)) expect(line?.text).not.toContain(emoji);
  });

  it('counts when there are many', () => {
    const line = weatherNotesLine(
      [first, second, third, fourth].map((b) => ({ buildingId: b!.id })),
    );
    expect(line?.text).toContain('4 of your buildings');
    expect(line?.text).toContain('Fix them');
    expect(line?.text).not.toMatch(/damag|destroy|broke/i);
  });
});
