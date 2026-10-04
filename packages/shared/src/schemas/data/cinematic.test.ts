import { describe, expect, it } from 'vitest';
import { GREAT_SCATTER, OPENING_CINEMATIC } from '../../data/cinematics/index.js';
import { GAME_DATA } from '../../data/index.js';
import { KEEPER_DATA } from '../../data/keepers.js';
import {
  CAPTION_READING,
  captionReadSeconds,
  checkCinematic,
  CINEMATIC_MAX_SECONDS,
  type CinematicInput,
} from './cinematic.js';

const check = (data: unknown) => checkCinematic(data, GAME_DATA, KEEPER_DATA);
const copy = (): CinematicInput => structuredClone(GREAT_SCATTER);

describe('checkCinematic', () => {
  it('accepts the shipped opening cinematic', () => {
    expect(check(GREAT_SCATTER)).toEqual([]);
  });

  it('tells the seven shots of design doc §25, in order, in under two minutes', () => {
    expect(OPENING_CINEMATIC.shots.map((s) => s.id)).toEqual([
      'heartpatch',
      'seasons',
      'keepers-of-old',
      'hollow-man',
      'great-scatter',
      'land-today',
      'your-heart-seed',
    ]);
    const total = OPENING_CINEMATIC.shots.reduce((sum, s) => sum + s.duration, 0);
    expect(total).toBeGreaterThanOrEqual(90);
    expect(total).toBeLessThanOrEqual(CINEMATIC_MAX_SECONDS);
  });

  it('drains the colour for shots 4–6 and brings it back for the last one', () => {
    const peak = (id: string) =>
      Math.max(
        ...(OPENING_CINEMATIC.shots.find((s) => s.id === id)?.mood ?? []).map((m) => m.drain),
      );
    for (const id of ['heartpatch', 'seasons', 'keepers-of-old']) expect(peak(id)).toBe(0);
    for (const id of ['hollow-man', 'great-scatter', 'land-today']) {
      expect(peak(id)).toBeGreaterThan(0.5);
    }
    const last = OPENING_CINEMATIC.shots.at(-1)!;
    expect(last.mood.at(-1)!.drain).toBe(0);
    // The last shot stars the player's own Keeper, and ends on the title card.
    expect(last.actors.some((a) => a.kind === 'player-keeper')).toBe(true);
    expect(last.titleAt).toBeDefined();
  });

  it('keeps every caption short and up long enough to read', () => {
    for (const shot of OPENING_CINEMATIC.shots) {
      for (const c of shot.captions) {
        expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(CAPTION_READING.maxWords);
        expect(c.until - c.at).toBeGreaterThanOrEqual(captionReadSeconds(c.text));
      }
    }
  });

  it('names captions that are too long, too quick, or use avoided words', () => {
    const data = copy();
    data.shots[0]!.captions![0] = {
      at: 1,
      until: 2,
      text: 'Long ago every squishy was born in the Heartpatch and nobody was ever hurt there',
    };
    expect(check(data)).toEqual([
      'shots["heartpatch"].captions[0].text: 15 words; at most 12',
      'shots["heartpatch"].captions[0].until: up for too short to read (needs 7.2s)',
      'shots["heartpatch"].captions[0].text: avoided words: hurt',
    ]);
  });

  it('names overlapping captions and keys out of order or past the shot', () => {
    const data = copy();
    const shot = data.shots[0]!;
    shot.captions![1]!.at = 5;
    shot.camera[2]!.at = 3;
    shot.cues![0]!.at = 99;
    const issues = check(data);
    expect(issues).toContain('shots["heartpatch"].captions[1].at: overlaps the caption before');
    expect(issues).toContain('shots["heartpatch"].camera[2].at: keys must be in time order');
    expect(issues).toContain('shots["heartpatch"].cues[0].at: after the shot ends (15s)');
  });

  it('checks actors against the species and Keeper data', () => {
    const data = copy();
    const actors = data.shots[2]!.actors!;
    const squishy = actors.find((a) => a.kind === 'squishy')!;
    squishy.species = 'not-a-squishy';
    const keeper = actors.find((a) => a.kind === 'keeper')!;
    keeper.keeperBase = 'nobody';
    actors.push({ ...structuredClone(squishy), id: squishy.id, species: 'puddlepuff' });
    const issues = check(data);
    expect(issues).toContain(
      `shots["keepers-of-old"].actors["${squishy.id}"].species: unknown species "not-a-squishy"`,
    );
    expect(issues).toContain(
      `shots["keepers-of-old"].actors["${keeper.id}"].keeperBase: unknown Keeper base "nobody"`,
    );
    expect(issues.some((i) => i.includes(`duplicate id "${squishy.id}"`))).toBe(true);
  });

  it('caps the whole thing at two minutes', () => {
    const data = copy();
    data.shots[0]!.duration = 40;
    expect(check(data)).toContain('shots: 136.0s long; at most 120s');
  });
});
