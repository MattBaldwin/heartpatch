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

  it('tells the nine shots of design doc §25, in order, in under two and a half minutes', () => {
    expect(OPENING_CINEMATIC.shots.map((s) => s.id)).toEqual([
      'heartpatch',
      'seasons',
      'keepers-of-old',
      'hollow-man',
      'great-scatter',
      'land-today',
      'your-heart-seed',
      'your-part',
      'title',
    ]);
    const total = OPENING_CINEMATIC.shots.reduce((sum, s) => sum + s.duration, 0);
    expect(total).toBeGreaterThanOrEqual(90);
    expect(total).toBeLessThanOrEqual(CINEMATIC_MAX_SECONDS);
    // Raised from 120 s for "Your part" (coordinator decision 2026-10-04).
    expect(CINEMATIC_MAX_SECONDS).toBe(150);
  });

  it('shows "Your part" in 15–25 s, before the title: plant, claim, care, befriend', () => {
    const part = OPENING_CINEMATIC.shots.find((s) => s.id === 'your-part')!;
    expect(part.duration).toBeGreaterThanOrEqual(15);
    expect(part.duration).toBeLessThanOrEqual(25);
    const ids = OPENING_CINEMATIC.shots.map((s) => s.id);
    expect(ids.indexOf('your-part')).toBeLessThan(ids.indexOf('title'));
    expect(OPENING_CINEMATIC.shots.find((s) => s.titleAt !== undefined)?.id).toBe('title');
    const kinds = new Set(part.actors.map((a) => a.kind));
    // Plant and light: your seed goes in and a Hearthfire comes up, lit.
    expect(kinds).toContain('player-keeper');
    expect(kinds).toContain('heart-seed');
    expect(
      part.actors.find((a) => a.kind === 'hearthfire')?.path.every((k) => k.lit !== false),
    ).toBe(true);
    // Claim: home first, then the land around it, one tile at a time.
    expect(part.claims.length).toBeGreaterThanOrEqual(7);
    expect(new Set(part.claims.map((c) => c.at)).size).toBe(part.claims.length);
    // Care: hearts and the squishy's glow. Befriend: a Heart Charm toss.
    expect(kinds).toContain('hearts');
    expect(kinds).toContain('joy');
    expect(kinds).toContain('heart-charm');
    expect(part.captions.map((c) => c.text).join(' ')).toContain('Heart Charm');
  });

  it('shows how he scattered them: reaching arms, the joy pulled out, a shake as it breaks', () => {
    const scatter = OPENING_CINEMATIC.shots.find((s) => s.id === 'great-scatter')!;
    const hollow = scatter.actors.find((a) => a.kind === 'hollow-man')!;
    expect(Math.max(...hollow.path.map((k) => k.reach ?? 0))).toBe(1);
    // Every Heartpatch squishy's joy, drawn out as a little light.
    const squishies = new Set(
      scatter.actors.filter((a) => a.kind === 'squishy' && a.shadow !== true).map((a) => a.id),
    );
    const joy = scatter.actors
      .filter((a) => a.kind === 'joy')
      .map((a) => a.id.replace(/-joy$/, ''));
    expect(new Set(joy)).toEqual(squishies);
    expect(scatter.shakes).toHaveLength(1);
    expect(scatter.cues.map((c) => c.cue)).toEqual(
      expect.arrayContaining(['hollow-sting', 'shatter', 'cold-wind']),
    );
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

  it('caps the whole thing at two and a half minutes', () => {
    const data = copy();
    const total = OPENING_CINEMATIC.shots.reduce((sum, s) => sum + s.duration, 0);
    data.shots[0]!.duration += 151 - total;
    expect(check(data)).toContain('shots: 151.0s long; at most 150s');
  });

  it('names claims off the world or twice, shakes past the shot, and reaching non-Hollow actors', () => {
    const data = copy();
    const part = data.shots.find((s) => s.id === 'your-part')!;
    const first = part.claims![0]!;
    part.claims!.push({ at: 23, hex: { q: 40, r: 0 } }, { at: 23.5, hex: first.hex });
    part.shakes = [{ at: 30, seconds: 0.5, strength: 0.05 }];
    part.actors!.find((a) => a.kind === 'player-keeper')!.path[0]!.reach = 0.5;
    const n = part.claims!.length;
    expect(check(data)).toEqual([
      'shots["your-part"].shakes[0].at: after the shot ends (24s)',
      `shots["your-part"].claims[${String(n - 2)}].hex: not a tile of the world`,
      `shots["your-part"].claims[${String(n - 1)}].hex: claimed twice`,
      'shots["your-part"].actors["you"].path: only the Hollow Man reaches',
    ]);
  });

  it('takes the new actor kinds (heart-charm, hearts, joy), never with a species or a reach', () => {
    const data = copy();
    const part = data.shots.find((s) => s.id === 'your-part')!;
    for (const kind of ['heart-charm', 'hearts', 'joy'] as const) {
      expect(
        part.actors!.some((a) => a.kind === kind),
        kind,
      ).toBe(true);
    }
    expect(check(data)).toEqual([]);
    const charm = part.actors!.find((a) => a.kind === 'heart-charm')!;
    charm.species = 'puddlepuff';
    const joy = part.actors!.find((a) => a.kind === 'joy')!;
    joy.path[0]!.reach = 1;
    expect(check(data).sort()).toEqual([
      `shots["your-part"].actors["${joy.id}"].path: only the Hollow Man reaches`,
      `shots["your-part"].actors["${charm.id}"].species: only squishies have a species`,
    ]);
    const bad = copy();
    (bad.shots[0]!.actors![0] as { kind: string }).kind = 'sparkler';
    expect(check(bad).some((i) => i.includes('kind'))).toBe(true);
  });

  it('keeps reach between 0 and 1, and shakes short and gentle', () => {
    const data = copy();
    const scatter = data.shots.find((s) => s.id === 'great-scatter')!;
    scatter.actors!.find((a) => a.kind === 'hollow-man')!.path[0]!.reach = 1.5;
    scatter.shakes = [
      { at: 1, seconds: 3, strength: 0.05 },
      { at: 5, seconds: 0.5, strength: 0.5 },
    ];
    const issues = check(data);
    expect(issues.some((i) => i.includes('reach'))).toBe(true);
    expect(issues.some((i) => i.includes('shakes[0].seconds'))).toBe(true);
    expect(issues.some((i) => i.includes('shakes[1].strength'))).toBe(true);
  });
});
