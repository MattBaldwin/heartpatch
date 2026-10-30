import {
  BATTLE_RULES,
  CARE_RULES,
  firstHomeTiles,
  GAME_DATA,
  heartSeedOf,
  hexDistance,
  isTradingPost,
  isWaterTerrain,
  type PublicUser,
  type Species,
} from '@heartpatch/shared';
import { withTransaction, type Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createMapsRepo } from '../maps/repo.js';
import { requireMember } from '../maps/members.js';
import { FAST_FORWARD_DAYS, type FastForwardDay } from './days.js';
import { createFastForwardRepo, type FastForwardTile } from './repo.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Kid-readable messages (style guide §6).
const MESSAGES = {
  noMap: "We couldn't find that patch.",
  noPartner: 'Pick your first squishy friend first!',
  noHome: 'You need a home on this patch first!',
};

export interface FastForwardResult {
  day: FastForwardDay;
  partnerLevel: number;
  tiles: number;
  added: number;
}

export interface FastForwardService {
  /**
   * Dev only (`HP_DEV_SQUISHY_GRANTS`, #736): my account on this patch stands
   * where the casual kid does at the end of `day` (`FAST_FORWARD_DAYS`). It
   * only ever moves forward, so a second call for the same day changes nothing.
   */
  devFastForward: (
    user: PublicUser,
    mapId: string,
    day: FastForwardDay,
  ) => Promise<FastForwardResult>;
}

export interface FastForwardServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

const SPECIES = new Map(GAME_DATA.species.map((s) => [s.id, s]));

/** What `species` grows into by `level` along its own line (the first public form at each step). */
export function grownForm(species: Species, level: number): Species {
  let form = species;
  for (;;) {
    const next = form.evolutions
      .filter((e) => e.level <= level)
      .sort((a, b) => a.level - b.level)
      .map((e) => SPECIES.get(e.into))
      .find((s) => s !== undefined);
    if (!next) return form;
    form = next;
  }
}

/** Neutral main-island land a player could hold, nearest the Heart Seed first. */
function claimable(tiles: readonly FastForwardTile[], seed: { q: number; r: number }) {
  return tiles
    .filter(
      (t) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        t.communityId === null &&
        t.isle === null &&
        !isTradingPost(t) &&
        !isWaterTerrain(t.terrain),
    )
    .sort((a, b) => hexDistance(seed, a) - hexDistance(seed, b) || a.id.localeCompare(b.id));
}

export function createFastForwardService(options: FastForwardServiceOptions): FastForwardService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());

  return {
    devFastForward: async (user, mapId, day) => {
      const standing = FAST_FORWARD_DAYS[day];
      const result = await withTransaction(db, async (tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        const repo = createFastForwardRepo(tx);
        const at = now();
        const since = new Date(at.getTime() - day * DAY_MS);
        // Lock order (tech spec §7): the member row, tiles, squishies.
        const member = await createMapsRepo(tx).lockMember(mapId, user.id);
        if (!member) throw new AppError('NOT_FOUND', MESSAGES.noMap);
        if (!member.starterSquishyId) throw new AppError('CONFLICT', MESSAGES.noPartner);

        // Land: the nearest neutral tiles until I hold the day's count.
        const tiles = await repo.listTiles(mapId);
        const mine = tiles.filter((t) => t.ownerUserId === user.id);
        const seed = heartSeedOf(firstHomeTiles(mine));
        if (!seed) throw new AppError('CONFLICT', MESSAGES.noHome);
        const wanted = claimable(tiles, seed).slice(0, Math.max(0, standing.tiles - mine.length));
        const free = (await repo.lockTiles(wanted.map((t) => t.id))).filter(
          (t) => t.ownerUserId === null,
        );
        await repo.claimTiles(
          mapId,
          free.map((t) => t.id),
          user.id,
        );

        // The team: the Partner grows up along its own line; the day's teammates join.
        const squishies = await repo.lockMine(mapId, user.id);
        const partner = squishies.find((s) => s.id === member.starterSquishyId);
        let partnerLevel = partner?.level ?? 0;
        if (partner && partner.level < standing.partnerLevel) {
          const from = SPECIES.get(partner.speciesId);
          const form = from ? grownForm(from, standing.partnerLevel) : undefined;
          if (form) {
            await repo.setGrowth(partner.id, {
              speciesId: form.id,
              element: form.element,
              feeling: form.feeling,
              level: standing.partnerLevel,
            });
            partnerLevel = standing.partnerLevel;
          }
        }
        const taken = new Set(squishies.map((s) => s.teamSlot).filter((s) => s !== null));
        let added = 0;
        for (const mate of standing.team) {
          const have = squishies.some(
            (s) => s.speciesId === mate.speciesId && s.level >= mate.level,
          );
          const species = SPECIES.get(mate.speciesId);
          if (have || !species) continue;
          const slot = [...Array(BATTLE_RULES.teamSize).keys()].find((n) => !taken.has(n)) ?? null;
          if (slot !== null) taken.add(slot);
          await repo.insertSquishy({
            mapId,
            ownerUserId: user.id,
            speciesId: species.id,
            element: species.element,
            feeling: species.feeling,
            level: mate.level,
            contentment: CARE_RULES.startContentment,
            teamSlot: slot,
            at,
            createdAt: since,
          });
          added += 1;
        }

        // Timestamps, not ticking: I've been here `day` days, and so have my squishies.
        // Care, work and training timers stay as they are: a kid who plays
        // every day comes back to fresh ones, not to `day` days away.
        await repo.backdate(
          mapId,
          user.id,
          squishies.map((s) => s.id),
          since,
        );
        return { day, partnerLevel, tiles: mine.length + free.length, added };
      });
      void options.publish?.(mapId);
      return result;
    },
  };
}
