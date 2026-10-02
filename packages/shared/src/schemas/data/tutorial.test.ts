import { describe, expect, it } from 'vitest';
import { findAvoidedWords } from '../../data/avoided-words.js';
import { GAME_DATA } from '../../data/index.js';
import { TUTORIAL_DATA } from '../../data/tutorial/index.js';
import { hexKey, hexSpiral } from '../../hex/index.js';
import { checkTutorialData, type TutorialData } from './tutorial.js';

const check = (data: TutorialData) => checkTutorialData(data, GAME_DATA);
const copy = () => structuredClone(TUTORIAL_DATA);

describe('checkTutorialData', () => {
  it('accepts the shipped tutorial', () => {
    expect(check(TUTORIAL_DATA)).toEqual([]);
  });

  it('lays out the Tutorial Glade: radius 3, 37 tiles, home base in the middle', () => {
    const { layout } = TUTORIAL_DATA;
    expect(layout.tiles).toHaveLength(37);
    expect(new Set(layout.tiles.map(hexKey))).toEqual(
      new Set(hexSpiral({ q: 0, r: 0 }, 3).map(hexKey)),
    );
    const home = layout.tiles.filter((t) => t.homeSlot === 0);
    expect(home).toHaveLength(7);
    // Step 2 gathers Timber and Emberwood right next to home (design doc §26).
    // Like every real home ring (design doc §11, decision B): step 6 feeds Treats.
    expect(home.map((t) => t.nodeResource)).toEqual(
      expect.arrayContaining(GAME_DATA.mapGen.homeRingNodes),
    );
    expect(home.find((t) => t.q === 0 && t.r === 0)?.terrain).toBe(GAME_DATA.mapGen.homeTerrain);
  });

  it('keeps Sprout short, kind and free of avoided words (style guide §2, §9)', () => {
    for (const step of TUTORIAL_DATA.steps) {
      for (const text of [step.goal, ...step.sproutLines]) {
        expect(findAvoidedWords(text)).toEqual([]);
        expect(text.split(/\s+/).length).toBeLessThanOrEqual(20);
      }
      // Style guide §6: at most two sentences per bubble.
      for (const line of step.sproutLines) {
        expect(line.split(/[.!?…]+(?:\s|$)/).filter(Boolean).length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('names duplicate steps and engine-only or unknown completion events', () => {
    const data = copy();
    data.steps[1]!.id = 'welcome';
    data.steps[1]!.completeOn.where = [{ op: 'equals', field: 'stepId', value: 'welcome' }];
    expect(check(data)).toEqual(['steps["welcome"].id: duplicate id "welcome"']);

    const engine = copy();
    engine.steps[0]!.completeOn.eventType = 'tutorial.advanced';
    engine.steps[0]!.completeOn.where = [];
    expect(check(engine)).toEqual([
      `steps["welcome"].completeOn.eventType: steps can't complete on "tutorial.advanced"`,
    ]);

    const unknown = copy() as unknown as { steps: { completeOn: { eventType: string } }[] };
    unknown.steps[0]!.completeOn.eventType = 'tile.exploded';
    expect(checkTutorialData(unknown, GAME_DATA)).toHaveLength(1);
  });

  it('checks predicate fields against the event payload schema', () => {
    const data = copy();
    data.steps[0]!.completeOn = {
      eventType: 'map.created',
      actor: 'player',
      where: [
        { op: 'equals', field: 'heartSeed.q', value: 0 },
        { op: 'exists', field: 'heartSeed.s' },
        { op: 'atLeast', field: 'maxPlayer', value: 1 },
      ],
    };
    expect(check(data)).toEqual([
      'steps["welcome"].completeOn.where[1].field: "map.created" has no payload field "heartSeed.s"',
      'steps["welcome"].completeOn.where[2].field: "map.created" has no payload field "maxPlayer"',
    ]);
  });

  it('rejects code strings and unknown predicate ops', () => {
    const data = copy() as unknown as { steps: { completeOn: { where: unknown[] } }[] };
    data.steps[0]!.completeOn.where = [{ op: 'eval', field: 'stepId', value: 'x' }];
    expect(checkTutorialData(data, GAME_DATA)).toHaveLength(1);
    data.steps[0]!.completeOn.where = [{ op: 'equals', field: 'a; drop()', value: 'x' }];
    expect(checkTutorialData(data, GAME_DATA)[0]).toMatch(
      /^steps\["welcome"\]\.completeOn\.where\[0\]\.field: Invalid string/,
    );
  });

  it('names layout tiles that are missing, doubled, outside or mismatched', () => {
    const data = copy();
    const { tiles } = data.layout;
    tiles.pop(); // (-3, 2)
    tiles.push({ ...tiles[10]! }); // (1, 1) again
    tiles[1]!.homeSlot = null; // a home tile without its slot
    tiles[11]!.nodeResource = 'glimmer'; // forest can't have Glimmer
    tiles[8]!.guardianStrength = 9; // too strong
    tiles[0]!.guardianStrength = 1; // a guardian on the Heart Seed
    expect(check(data)).toEqual([
      'layout.tiles[0].guardianStrength: home tiles have no guardian',
      'layout.tiles[1].homeSlot: home tiles need homeSlot 0',
      'layout.tiles[8].guardianStrength: must be 1–4 (map-gen guardian strength)',
      'layout.tiles[11].nodeResource: "forest" tiles can\'t have a "glimmer" node',
      'layout.tiles[36]: tile (1,1) is listed twice',
      'layout.tiles: missing tile (-3,2)',
    ]);
  });

  it('names unknown terrain and resources, and a home base off the map', () => {
    const data = copy();
    data.layout.tiles[0]!.terrain = 'swamp';
    data.layout.tiles[0]!.nodeResource = 'gold';
    data.layout.heartSeed = { q: 3, r: 0 };
    const problems = check(data);
    expect(problems).toContain('layout.heartSeed: the home base must fit inside the Glade');
    expect(problems).toContain('layout.tiles[0].terrain: unknown terrain "swamp"');
    expect(problems).toContain('layout.tiles[0].nodeResource: unknown resource "gold"');
  });

  it('needs the home ring nodes, on any terrain, and a plain Heart Seed', () => {
    const data = copy();
    const farm = data.layout.tiles.find((t) => t.nodeResource === 'treats')!;
    farm.nodeResource = null;
    data.layout.tiles[0]!.terrain = 'forest';
    data.layout.tiles[0]!.nodeResource = 'timber';
    expect(check(data)).toEqual([
      'layout.tiles[0].terrain: the Heart Seed sits on "meadow" (map-gen)',
      'layout.tiles[0].nodeResource: the Heart Seed tile has no node',
      'layout.tiles: the home ring needs a "treats" node (map-gen homeRingNodes)',
    ]);
  });

  it('makes talk-only steps name themselves, so a stale tap cannot skip ahead', () => {
    const data = copy();
    data.steps[1]!.completeOn.where = [];
    expect(check(data)).toEqual([
      'steps["graduation"].completeOn.where: needs { op: "equals", field: "stepId", value: "graduation" }',
    ]);
  });

  it('fixes the design-doc rules in the overrides shape', () => {
    const data = copy() as unknown as { overrides: Record<string, unknown> };
    data.overrides['hollowManCanTake'] = true;
    data.overrides['captureAlwaysSucceeds'] = false;
    expect(checkTutorialData(data, GAME_DATA)).toHaveLength(2);
  });
});
