import { describe, expect, it } from 'vitest';
import { checkGameData } from '../schemas/data/game-data.js';
import { BuildingSchema, LightsBuildingSchema } from '../schemas/data/buildings.js';
import { checkPowerRules } from '../schemas/data/power.js';
import { checkRailRules, LineKindSchema, MAX_LINE_LEVEL } from '../schemas/data/rails.js';
import { checkResearchTree } from '../schemas/data/research.js';
import { BuildingKindSchema, PublicBuildingSchema } from '../schemas/buildings.js';
import { LineRequestSchema, PublicLineSchema } from '../schemas/lines.js';
import { MyMapsResponseSchema, PublicTileSchema } from '../schemas/maps.js';
import { StartResearchRequestSchema } from '../schemas/research.js';
import { GAME_EVENTS, parseGameEventPayload } from '../schemas/events.js';
import { ItemChangeReasonSchema } from '../schemas/inventory.js';
import { SpawnTableSchema } from '../schemas/data/spawn-tables.js';
import { BUILDINGS } from './buildings.js';
import { GAME_DATA } from './index.js';
import { POWER_RULES } from './power.js';
import { RAIL_RULES } from './rails.js';
import { RESEARCH_TREE } from './research.js';
import { RESOURCES } from './resources.js';
import { SPAWN_TABLES } from './server/spawn-tables.js';

const resourceIds = new Set(RESOURCES.map((r) => r.id));
const userId = '0190a000-0000-7000-8000-000000000001';
const buildingRowId = '0190a000-0000-7000-8000-0000000000b1';
const jobId = '0190a000-0000-7000-8000-0000000000c1';
const at = { q: 3, r: -2 };

describe('Clockwork Isle contracts (#874 C0)', () => {
  describe('power', () => {
    it('passes its checks: wires, a six-tile run, faster where it blows', () => {
      expect(checkPowerRules(POWER_RULES, resourceIds)).toEqual([]);
      expect(POWER_RULES.model).toBe('wires');
      expect(POWER_RULES.wire).toEqual({ cost: { parts: 1 }, maxRun: 6 });
      expect(POWER_RULES.windPace).toEqual({ '1': 75, '2': 100, '3': 150 });
    });

    it('catches a broken table', () => {
      const problems = checkPowerRules(
        {
          ...POWER_RULES,
          wire: { cost: { moonbeams: 1 }, maxRun: 6 },
          windPace: { 1: 120, 2: 100, 3: 90 },
        },
        resourceIds,
      ).join('\n');
      expect(problems).toMatch(/wire.cost.moonbeams: unknown resource "moonbeams"/);
      expect(problems).toMatch(/windPace.2: slower than wind 1/);
      expect(problems).toMatch(/windPace.3: slower than wind 2/);
      for (const bad of [
        { ...POWER_RULES, model: 'flow' },
        { ...POWER_RULES, wire: { cost: {}, maxRun: 13 } },
        { ...POWER_RULES, windPace: { '1': 75, '2': 100 } },
      ]) {
        expect(checkPowerRules(bad, resourceIds)).not.toEqual([]);
      }
    });
  });

  describe('rails', () => {
    it('pass their checks: two levels, each reaching further and quicker', () => {
      expect(checkRailRules(RAIL_RULES, resourceIds)).toEqual([]);
      expect(RAIL_RULES.levels.map((l) => [l.reach, l.speedPercent])).toEqual([
        [2, 125],
        [3, 150],
      ]);
      expect(RAIL_RULES.levels.length).toBeLessThanOrEqual(MAX_LINE_LEVEL);
      expect(LineKindSchema.options).toEqual(['wire', 'rail']);
    });

    it('catch a broken table', () => {
      const [rail, tidy] = RAIL_RULES.levels;
      const problems = checkRailRules(
        {
          levels: [
            { ...rail!, cost: { moonbeams: 1 } },
            { ...tidy!, reach: 1, speedPercent: 110 },
          ],
        },
        resourceIds,
      ).join('\n');
      expect(problems).toMatch(/levels.0.cost.moonbeams: unknown resource "moonbeams"/);
      expect(problems).toMatch(/levels.1.reach: shorter than below/);
      expect(problems).toMatch(/levels.1.speedPercent: slower than below/);
      // No third level: `tile_lines.level` is 1–2.
      expect(checkRailRules({ levels: [rail, tidy, tidy] }, resourceIds)).not.toEqual([]);
    });
  });

  describe('research', () => {
    it('passes its checks, and every building that needs research names a node', () => {
      expect(checkResearchTree(RESEARCH_TREE, resourceIds, BUILDINGS)).toEqual([]);
      expect(RESEARCH_TREE.nodes.map((n) => [n.id, n.tier])).toEqual([
        ['sorting', 1],
        ['bright-bulbs', 1],
        ['tidy-rails', 1],
        ['wrapping', 1],
      ]);
      // Paid in Parts and Spark, paid back in Blueprints.
      for (const n of RESEARCH_TREE.nodes) {
        expect(Object.keys(n.cost).sort(), n.id).toEqual(['parts', 'spark']);
        expect(Object.keys(n.grants), n.id).toEqual(['blueprints']);
      }
      expect(BUILDINGS.find((b) => b.id === 'sorter')?.requiresResearch).toBe('sorting');
      expect(BUILDINGS.find((b) => b.id === 'clockwork-beacon')?.requiresResearch).toBe(
        'bright-bulbs',
      );
      // The presents tie-in (plan R1.1): a powered machine that wraps presents in December.
      expect(BUILDINGS.find((b) => b.id === 'gift-wrapper')).toMatchObject({
        kind: 'works',
        season: 'christmas',
        needsPower: true,
        requiresResearch: 'wrapping',
        makes: { resource: 'presents', quantity: 1 },
      });
    });

    it('catches a broken tree', () => {
      const [sorting] = RESEARCH_TREE.nodes;
      const tree = {
        oneAtATime: true,
        nodes: [
          sorting!,
          { ...sorting!, id: 'sorting' },
          { ...sorting!, id: 'pressing', tier: 1, requires: ['sorting', 'sorting'] },
          { ...sorting!, id: 'stargazing', tier: 2, requires: ['moon-maps'] },
          { ...sorting!, id: 'gizmos', tier: 2, cost: { moonbeams: 1 }, grants: { stardust: 1 } },
        ],
      };
      const problems = checkResearchTree(tree, resourceIds, [
        { id: 'press', requiresResearch: 'pressing' },
        { id: 'observatory', requiresResearch: 'telescopes' },
      ]).join('\n');
      expect(problems).toMatch(/nodes.1.id: duplicate id "sorting"/);
      expect(problems).toMatch(/nodes.2.requires.0: "sorting" is not on a lower tier/);
      expect(problems).toMatch(/nodes.2.requires.1: listed twice/);
      expect(problems).toMatch(/nodes.3.requires.0: unknown research "moon-maps"/);
      expect(problems).toMatch(/nodes.4.cost.moonbeams: unknown resource "moonbeams"/);
      expect(problems).toMatch(/nodes.4.grants.stardust: unknown resource "stardust"/);
      expect(problems).toMatch(
        /buildings.observatory.requiresResearch: unknown research "telescopes"/,
      );
      expect(problems).not.toMatch(/press\b/);
      expect(checkResearchTree({ ...tree, oneAtATime: false }, resourceIds, [])).not.toEqual([]);
    });
  });

  describe('buildings', () => {
    const windmill = BUILDINGS.find((b) => b.id === 'windmill')!;

    it('parse a Depot, a Bench and the new flags, and the DB row kinds know them', () => {
      for (const kind of ['depot', 'research']) expect(BuildingKindSchema.parse(kind)).toBe(kind);
      expect(windmill).toMatchObject({ kind: 'works', wind: true, makes: { resource: 'spark' } });
      expect(BUILDINGS.find((b) => b.id === 'sorter')).toMatchObject({
        needsPower: true,
        eats: { spark: 1, greens: 2 },
      });
      // A Beacon is a `lights` row with no glow nights: it glows every night.
      const beacon = {
        id: 'clockwork-beacon',
        kind: 'lights',
        name: 'Clockwork Beacon',
        description: 'The Beacon hums. The Hollow Man keeps his distance.',
        patchTypes: ['clockwork-isle'],
        placement: 'homestead',
        maxPerTile: 1,
        slot: 'ring',
        needsPower: true,
        requiresResearch: 'bright-bulbs',
        safeRadius: 2,
        levels: [{ cost: { stone: 10, parts: 12 } }],
      };
      expect(LightsBuildingSchema.parse(beacon)).toEqual(beacon);
      expect(BuildingSchema.safeParse({ ...beacon, needsPower: false }).success).toBe(false);
      expect(BuildingSchema.safeParse({ ...beacon, glowNights: ['12-24', '12-24'] }).success).toBe(
        false,
      );
    });

    it('keep Clockwork rows to a Clockwork Isle, and power, research and wind to them', () => {
      expect(checkGameData(GAME_DATA)).toEqual([]);
      const withRow = (row: object) =>
        checkGameData({ ...GAME_DATA, buildings: [...BUILDINGS, row] });
      const bench = BUILDINGS.find((b) => b.id === 'research-bench')!;
      expect(withRow({ ...bench, id: 'cozy-bench', patchTypes: undefined }).join('\n')).toMatch(
        /"cozy-bench" is a Clockwork Isle building/,
      );
      expect(
        withRow({ ...bench, id: 'both-bench', patchTypes: ['clockwork-isle', 'wild-isle'] }).join(
          '\n',
        ),
      ).toMatch(/"both-bench" is a Clockwork Isle building/);
      const hut = BUILDINGS.find((b) => b.id === 'woodcutters-hut')!;
      expect(withRow({ ...hut, id: 'tin-hut', patchTypes: ['clockwork-isle'] }).join('\n')).toMatch(
        /"tin-hut": a Clockwork Isle building is works, lights, depot or research/,
      );
      expect(withRow({ ...hut, id: 'zappy-hut', needsPower: true }).join('\n')).toMatch(
        /"zappy-hut": only Clockwork Isle buildings need power/,
      );
      expect(withRow({ ...hut, id: 'clever-hut', requiresResearch: 'sorting' }).join('\n')).toMatch(
        /"clever-hut": only Clockwork Isle buildings need research/,
      );
      const pier = BUILDINGS.find((b) => b.id === 'fishing-pier')!;
      expect(withRow({ ...pier, id: 'windy-pier', wind: true }).join('\n')).toMatch(
        /"windy-pier": only Clockwork Isle buildings feel the wind/,
      );
      // A Clockwork works row isn't a Wild Isle one.
      expect(
        withRow({ ...windmill, id: 'wild-windmill', patchTypes: ['wild-isle'] }).join('\n'),
      ).toMatch(/"wild-windmill": only Clockwork Isle buildings feel the wind/);
    });

    it('show a building unpowered and a Bench at work, and nothing on older payloads', () => {
      const base = {
        id: buildingRowId,
        buildingId: 'sorter',
        kind: 'works',
        level: 1,
        spot: 1,
        lit: null,
        safeRadius: null,
      };
      expect(PublicBuildingSchema.parse(base)).toEqual(base);
      expect(PublicBuildingSchema.parse({ ...base, unpowered: true }).unpowered).toBe(true);
      expect(PublicBuildingSchema.safeParse({ ...base, unpowered: false }).success).toBe(false);
      const bench = {
        ...base,
        buildingId: 'research-bench',
        kind: 'research',
        research: { nodeId: 'sorting', readyAt: '2026-12-01T12:00:00.000Z' },
      };
      expect(PublicBuildingSchema.parse(bench)).toEqual(bench);
    });
  });

  describe('API and events', () => {
    it('parse line and research requests strictly', () => {
      expect(LineRequestSchema.parse({ ...at, kind: 'wire' })).toEqual({ ...at, kind: 'wire' });
      expect(LineRequestSchema.safeParse({ ...at, kind: 'road' }).success).toBe(false);
      expect(LineRequestSchema.safeParse({ ...at, kind: 'rail', level: 2 }).success).toBe(false);
      expect(
        PublicLineSchema.parse({
          ...at,
          kind: 'wire',
          ownerUserId: userId,
          level: 1,
          powered: true,
        }),
      ).toMatchObject({ powered: true });
      expect(
        StartResearchRequestSchema.parse({ buildingId: buildingRowId, nodeId: 'sorting' }),
      ).toEqual({ buildingId: buildingRowId, nodeId: 'sorting' });
      expect(
        StartResearchRequestSchema.safeParse({ buildingId: buildingRowId, nodeId: 'Sorting!' })
          .success,
      ).toBe(false);
    });

    it('show wind on a tile and the Clockwork switch, both optional', () => {
      expect(PublicTileSchema.shape.wind.safeParse(undefined).success).toBe(true);
      for (const wind of [1, 2, 3]) expect(PublicTileSchema.shape.wind.parse(wind)).toBe(wind);
      for (const wind of [0, 4, 1.5]) {
        expect(PublicTileSchema.shape.wind.safeParse(wind).success).toBe(false);
      }
      expect(MyMapsResponseSchema.parse({ maps: [], requests: [] })).toEqual({
        maps: [],
        requests: [],
      });
      expect(
        MyMapsResponseSchema.parse({ maps: [], requests: [], canMakeClockworkIsle: true }),
      ).toMatchObject({ canMakeClockworkIsle: true });
    });

    it('register the line, power and research events, keeping bills and grants internal', () => {
      const cases = [
        [
          'line.built',
          { userId, ...at, kind: 'wire', level: 1, cost: { parts: 1 } },
          { userId, ...at, kind: 'wire', level: 1 },
        ],
        [
          'line.upgraded',
          { userId, ...at, kind: 'rail', fromLevel: 1, level: 2, cost: { timber: 4 } },
          { userId, ...at, kind: 'rail', level: 2 },
        ],
        [
          'line.removed',
          { userId, ...at, kind: 'rail', level: 2, refund: { timber: 2 }, lost: 'wild' },
          { userId, ...at, kind: 'rail' },
        ],
        ['building.powered', { userId, buildingRowId, ...at }, { userId, buildingRowId, ...at }],
        ['building.unpowered', { userId, buildingRowId, ...at }, { userId, buildingRowId, ...at }],
        [
          'research.started',
          {
            userId,
            jobId,
            buildingRowId,
            nodeId: 'sorting',
            readyAt: '2026-12-01T12:00:00.000Z',
            cost: { parts: 6, spark: 4 },
          },
          { userId, nodeId: 'sorting', readyAt: '2026-12-01T12:00:00.000Z' },
        ],
        [
          'research.done',
          { userId, jobId, nodeId: 'sorting', grants: { blueprints: 2 } },
          { userId, nodeId: 'sorting' },
        ],
      ] as const;
      for (const [type, internal, shown] of cases) {
        expect(parseGameEventPayload(type, internal), type).toEqual(internal);
        expect(GAME_EVENTS[type].public.parse(internal), type).toEqual(shown);
      }
      expect(() =>
        parseGameEventPayload('line.built', { userId, ...at, kind: 'wire', level: 3, cost: {} }),
      ).toThrow();
      expect(() =>
        parseGameEventPayload('line.built', { userId, ...at, kind: 'fence', level: 1, cost: {} }),
      ).toThrow();
    });

    it('ledgers lines, research and the Depot by their own reasons', () => {
      for (const reason of ['line', 'line-refund', 'research', 'research-grant', 'depot']) {
        expect(ItemChangeReasonSchema.parse(reason)).toBe(reason);
      }
    });

    it('lets a spawn table name its patch types, and every table so far leaves them out', () => {
      const table = {
        id: 'clockwork-meadow',
        terrains: ['meadow'],
        patchTypes: ['clockwork-isle'],
        entries: [{ species: 'gearbit', weight: 1 }],
      };
      expect(SpawnTableSchema.parse(table)).toEqual(table);
      expect(SpawnTableSchema.safeParse({ ...table, patchTypes: [] }).success).toBe(false);
      expect(SpawnTableSchema.safeParse({ ...table, patchTypes: ['volcano'] }).success).toBe(false);
      // Nothing reads `patchTypes` until the spawn filter lands (lane C6).
      expect(SPAWN_TABLES.filter((t) => t.patchTypes !== undefined).map((t) => t.id)).toEqual([]);
    });
  });
});
