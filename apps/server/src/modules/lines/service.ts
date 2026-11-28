import {
  HOME_BASE_RULES,
  hexKey,
  isGenerator,
  isWaterTerrain,
  powerReach,
  railCost,
  type ItemCounts,
  type LineKind,
  type LineRequest,
  type LinesView,
  type LineTileResponse,
  type PatchRules,
  type PowerRules,
  type PublicLine,
  type PublicUser,
  type RailRules,
  type TravelRules,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems, grantItems } from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { createRoadsRepo, type RoadTileRow } from '../roads/repo.js';
import { lockAndRefreshPower } from '../territory/power-refresh.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { mapPatchRules, refreshSupply, supplyFor } from '../territory/supply.js';
import { createLinesRepo, type LineRow, type LinesTxRepo } from './repo.js';

/*
 * Clockwork Isle lines (#874, owner answer Q3: wires like roads): a wire
 * carries power from its owner's generators (`POWER_RULES`), a rail hauls
 * and reaches like a road (`RAIL_RULES`). Tile attributes (`tile_lines`),
 * one of each kind per tile, laid on my own supplied land, a rail raised,
 * either taken up for half back. Owner-only, like roads. Each command is
 * one transaction (CLAUDE.md rule 7). Lock order (tech spec §7): my member
 * row (step 2), the tile (6), its line (6, after `tile_roads`), the tending
 * rows a rail moves (6, never waited for), my generator and `needsPower`
 * rows a wire changes (8, id order), my bag (11), `maps` last. Every other
 * patch type answers `NOT_FOUND`.
 */

export const MESSAGES = {
  noLines: 'There are no wires or rails on this patch.',
  noTile: "That tile isn't on this map.",
  notMine: 'You can only lay wires and rails on your own land.',
  water: "Wires and rails can't go on water. A bridge would do it!",
  cutOff: "Lay wires from land that's joined up to home!",
  railCutOff: "Lay rails from land that's joined up to home!",
  taken: (kind: LineKind) =>
    kind === 'wire' ? "There's a wire here already!" : "There's a rail here already!",
  noLine: (kind: LineKind) =>
    kind === 'wire' ? "There's no wire of yours here." : "There's no rail of yours here.",
  top: (kind: LineKind) =>
    kind === 'wire' ? 'A wire is just a wire! ⚡' : 'This rail is as tidy as it gets! ✨',
} as const;

export interface LinesService {
  /** Every wire and rail on my Clockwork Isle; wires say whether they carry power. */
  view: (user: PublicUser, mapId: string) => Promise<LinesView>;
  /** Lays a wire or a rail on one of my supplied tiles. */
  build: (user: PublicUser, mapId: string, request: LineRequest) => Promise<LineTileResponse>;
  /** Raises my rail a level. */
  upgrade: (user: PublicUser, mapId: string, request: LineRequest) => Promise<LineTileResponse>;
  /** Takes my wire or rail up for half back. */
  remove: (user: PublicUser, mapId: string, request: LineRequest) => Promise<LineTileResponse>;
}

export interface LinesServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

/** The rules a line of this kind follows, from the map's patch rules. */
interface LineRules {
  travel: TravelRules;
  power: PowerRules;
  rails: RailRules;
}

/** The map's line rules, or `NOT_FOUND` on any patch type but a Clockwork Isle. */
function lineRulesOf(rules: PatchRules | null): LineRules {
  if (!rules?.power || !rules.rails || !rules.travel) {
    throw new AppError('NOT_FOUND', MESSAGES.noLines);
  }
  return { travel: rules.travel, power: rules.power, rails: rules.rails };
}

/** The highest level of a line of this kind. */
const topLevel = (kind: LineKind, rules: LineRules) =>
  kind === 'wire' ? 1 : rules.rails.levels.length;

/** What laying (level 1) or raising a line to `level` costs; null past the top. */
function lineCost(kind: LineKind, level: number, rules: LineRules): ItemCounts | null {
  if (level < 1 || level > topLevel(kind, rules)) return null;
  return kind === 'wire' ? rules.power.wire.cost : railCost(level, rules.rails);
}

/**
 * What comes back when a line of `level` comes up (taken up, or lost with
 * its land): the home base's take-down share of everything spent on it,
 * floored, nothing listed at 0. Roads do the same (`roadRefund`).
 */
export function lineRefund(kind: LineKind, level: number, rules: LineRules): ItemCounts {
  const spent: Record<string, number> = {};
  for (let l = 1; l <= Math.min(level, topLevel(kind, rules)); l++) {
    for (const [id, n] of Object.entries(lineCost(kind, l, rules) ?? {})) {
      spent[id] = (spent[id] ?? 0) + n;
    }
  }
  const refund: Record<string, number> = {};
  for (const [id, n] of Object.entries(spent)) {
    const back = Math.floor((n * HOME_BASE_RULES.removeRefundPercent) / 100);
    if (back > 0) refund[id] = back;
  }
  return refund;
}

/** A line counts only while its owner holds its tile. */
const liveLine = (line: LineRow | null): LineRow | null =>
  line !== null && line.tileOwnerUserId === line.ownerUserId ? line : null;

export function createLinesService(options: LinesServiceOptions): LinesService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createLinesRepo(db);

  /** Runs one command in one transaction, then publishes. */
  async function command(
    user: PublicUser,
    mapId: string,
    request: LineRequest,
    run: (
      repo: LinesTxRepo,
      tx: Executor,
      ctx: { at: Date; rules: LineRules; tile: RoadTileRow; line: LineRow | null },
    ) => Promise<LineTileResponse>,
  ): Promise<LineTileResponse> {
    let result: LineTileResponse;
    try {
      result = await store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        const rules = lineRulesOf(await mapPatchRules(tx, mapId));
        // Step 2: my member row, before the tile (a new line's key to it).
        if (!(await createMapsRepo(tx).lockMember(mapId, user.id))) {
          throw new AppError('NOT_FOUND', MESSAGES.noTile);
        }
        const tile = await createRoadsRepo(tx).lockTileAt(mapId, request.q, request.r);
        if (!tile) throw new AppError('NOT_FOUND', MESSAGES.noTile);
        if (isWaterTerrain(tile.terrain)) throw new AppError('FORBIDDEN', MESSAGES.water);
        if (tile.ownerUserId !== user.id) throw new AppError('FORBIDDEN', MESSAGES.notMine);
        const line = await repo.lockLine(tile.id, request.kind);
        return run(repo, tx, { at: now(), rules, tile, line });
      });
    } catch (err) {
      // Two taps raced to lay the same tile's line (`tile_lines_pkey`).
      if (isUniqueViolation(err)) throw new AppError('CONFLICT', MESSAGES.taken(request.kind));
      throw err;
    }
    void options.publish?.(mapId);
    return result;
  }

  /** The tile's line now and my bag, in the command's transaction. */
  async function tileView(
    tx: Executor,
    mapId: string,
    userId: string,
    tile: RoadTileRow,
    kind: LineKind,
    level: number | null,
    refund: ItemCounts = {},
  ): Promise<LineTileResponse> {
    const items = await createInventoryRepo(tx).list({ mapId, userId });
    const line = level === null ? null : { level };
    return { q: tile.q, r: tile.r, kind, line, items, refund };
  }

  /**
   * What a line moved, events to append: a rail is part of my supply line
   * (step 6 tending rows), a wire my power (step 8, my generator and
   * `needsPower` rows), each before my bag (plan R2.2: after `resupply`,
   * before `consumeItems`).
   */
  async function refreshFor(tx: Executor, mapId: string, userId: string, kind: LineKind, at: Date) {
    return kind === 'rail'
      ? refreshSupply(tx, mapId, [userId], at)
      : lockAndRefreshPower(tx, mapId, [userId], at);
  }

  return {
    view: async (user, mapId) => {
      await requireMember(db, user, mapId);
      const rules = lineRulesOf(await mapPatchRules(db, mapId));
      const [lines, tiles, standing] = await Promise.all([
        store.listLive(mapId),
        createTerritoryRepo(db).listTiles(mapId),
        createBuildingsRepo(db).listOnMap(mapId),
      ]);
      const wires = lines.filter((l) => l.kind === 'wire');
      const generators = standing.filter((b) => isGenerator(b.buildingId));
      const carrying = new Map<string, Set<string>>();
      const carries = (ownerUserId: string) => {
        let reach = carrying.get(ownerUserId);
        if (!reach) {
          reach = new Set(powerReach(tiles, wires, generators, ownerUserId, rules.power).keys());
          carrying.set(ownerUserId, reach);
        }
        return reach;
      };
      return {
        lines: lines.map(({ q, r, kind, ownerUserId, level }): PublicLine => ({
          q,
          r,
          kind,
          ownerUserId,
          level,
          ...(kind === 'wire' ? { powered: carries(ownerUserId).has(hexKey({ q, r })) } : {}),
        })),
      };
    },

    build: (user, mapId, request) =>
      command(user, mapId, request, async (repo, tx, { at, rules, tile, line }) => {
        const { kind } = request;
        if (liveLine(line)) throw new AppError('CONFLICT', MESSAGES.taken(kind));
        const supply = await supplyFor(tx, mapId, user.id, rules.travel);
        if (!supply.supplied.has(hexKey(tile))) {
          throw new AppError('FORBIDDEN', kind === 'wire' ? MESSAGES.cutOff : MESSAGES.railCutOff);
        }
        // A leaver's line left behind (its owner no longer holds the tile) goes quietly.
        if (line) await repo.deleteLine(tile.id, kind);
        const cost = lineCost(kind, 1, rules) ?? {};
        await repo.insertLine({
          tileId: tile.id,
          kind,
          mapId,
          ownerUserId: user.id,
          level: 1,
          builtAt: at,
        });
        const events = await refreshFor(tx, mapId, user.id, kind, at);
        // Short of anything: CONFLICT ("You need 1 more Parts first!").
        await consumeItems(tx, { mapId, userId: user.id }, cost, 'line', tile.id);
        await repo.appendEvent({
          mapId,
          type: 'line.built',
          actorUserId: user.id,
          payload: { userId: user.id, q: tile.q, r: tile.r, kind, level: 1, cost },
        });
        for (const event of events) await repo.appendEvent(event);
        return tileView(tx, mapId, user.id, tile, kind, 1);
      }),

    upgrade: (user, mapId, request) =>
      command(user, mapId, request, async (repo, tx, { at, rules, tile, line: row }) => {
        const { kind } = request;
        const line = liveLine(row);
        if (!line) throw new AppError('NOT_FOUND', MESSAGES.noLine(kind));
        const level = line.level + 1;
        // C3 adds the level's `requiresResearch` check here (Tidy rails).
        const cost = lineCost(kind, level, rules);
        if (!cost) throw new AppError('CONFLICT', MESSAGES.top(kind));
        await repo.setLevel(tile.id, kind, level);
        const events = await refreshFor(tx, mapId, user.id, kind, at);
        await consumeItems(tx, { mapId, userId: user.id }, cost, 'line', tile.id);
        await repo.appendEvent({
          mapId,
          type: 'line.upgraded',
          actorUserId: user.id,
          payload: {
            userId: user.id,
            q: tile.q,
            r: tile.r,
            kind,
            fromLevel: line.level,
            level,
            cost,
          },
        });
        for (const event of events) await repo.appendEvent(event);
        return tileView(tx, mapId, user.id, tile, kind, level);
      }),

    remove: (user, mapId, request) =>
      command(user, mapId, request, async (repo, tx, { at, rules, tile, line: row }) => {
        const { kind } = request;
        const line = liveLine(row);
        if (!line) throw new AppError('NOT_FOUND', MESSAGES.noLine(kind));
        const refund = lineRefund(kind, line.level, rules);
        await repo.deleteLine(tile.id, kind);
        const events = await refreshFor(tx, mapId, user.id, kind, at);
        if (Object.keys(refund).length > 0) {
          await grantItems(tx, { mapId, userId: user.id }, refund, 'line-refund', tile.id);
        }
        await repo.appendEvent({
          mapId,
          type: 'line.removed',
          actorUserId: user.id,
          payload: { userId: user.id, q: tile.q, r: tile.r, kind, level: line.level, refund },
        });
        for (const event of events) await repo.appendEvent(event);
        return tileView(tx, mapId, user.id, tile, kind, null, refund);
      }),
  };
}

/** A line that came down with its land, for the caller to finish. */
export interface LostLine {
  readonly ownerUserId: string;
  readonly tileId: string;
  readonly kind: LineKind;
  readonly refund: ItemCounts;
  /** `line.removed`, `lost` set: append it with the caller's other events. */
  readonly event: NewGameEvent<'line.removed'>;
}

/**
 * Lines on land that changed hands (captured, or gone wild) come down
 * (step 6, right after the roads, `(tile_id, kind)` order), each worth its
 * take-down share to the Keeper who held the tile (`heldBy`, before the
 * change). The caller locks those players' inventory rows with its other
 * grants and calls `grantLostLines`, and refreshes their power with its
 * buildings lock (`refreshPower`). A line a leaver left behind just goes.
 * Nothing on any patch type but a Clockwork Isle.
 */
export async function takeDownLinesOnLostLand(
  tx: Executor,
  mapId: string,
  heldBy: ReadonlyMap<string, string | null>,
  lost: 'captured' | 'wild',
): Promise<LostLine[]> {
  const patch = await mapPatchRules(tx, mapId);
  if (!patch?.power || !patch.rails || !patch.travel || heldBy.size === 0) return [];
  const rules = lineRulesOf(patch);
  const repo = createLinesRepo(tx);
  const rows = await repo.lockOnTiles([...heldBy.keys()]);
  if (rows.length === 0) return [];
  await repo.deleteOnTiles([...new Set(rows.map((r) => r.tileId))]);
  return rows.flatMap((row) => {
    if (heldBy.get(row.tileId) !== row.ownerUserId) return [];
    const refund = lineRefund(row.kind, row.level, rules);
    const event: NewGameEvent<'line.removed'> = {
      mapId,
      type: 'line.removed',
      actorUserId: null,
      payload: {
        userId: row.ownerUserId,
        q: row.q,
        r: row.r,
        kind: row.kind,
        level: row.level,
        refund,
        lost,
      },
    };
    return [{ ownerUserId: row.ownerUserId, tileId: row.tileId, kind: row.kind, refund, event }];
  });
}

/** What lost lines give back, as `lockGrantRows` wants it. */
export const lostLineGrants = (lines: readonly LostLine[]) =>
  lines
    .filter((l) => Object.keys(l.refund).length > 0)
    .map((l) => ({ userId: l.ownerUserId, items: l.refund }));

/** Grants lost lines' take-down share (`line-refund`); their rows are locked already. */
export async function grantLostLines(
  tx: Executor,
  mapId: string,
  lines: readonly LostLine[],
): Promise<void> {
  for (const l of lines) {
    if (Object.keys(l.refund).length === 0) continue;
    await grantItems(tx, { mapId, userId: l.ownerUserId }, l.refund, 'line-refund', l.tileId);
  }
}
