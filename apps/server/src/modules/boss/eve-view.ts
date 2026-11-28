import {
  addDays,
  type MapViewChristmasEve,
  type MapViewChristmasEveThanks,
} from '@heartpatch/shared';
import { bossWeekOf, type BossEventRules } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { localDate } from '../../lib/time.js';
import { eveAsksLeft } from './befriend.js';
import { barView, thanksOf } from './patch-bar.js';
import { createBossRepo, type BossBarDbRow, type BossRepo, type BossWindowRow } from './repo.js';
import { bossGatesFor, plannedBossVisit } from './service.js';
import { minibossOpenFor, type MinibossSwitch } from './switch.js';

const HOUR_MS = 3_600_000;

/*
 * `MapView.christmas.eve` (#37 X1, X2, X5a): the patch's Christmas Eve visit
 * as the map shows it to one Keeper. Every read here is a plain read (rule
 * 4): the boss module pins the visit, opens its bar and pays the thanks; this
 * never takes a lock or writes. Nothing while the mini-boss switch is closed
 * for the patch (it follows `/boss`).
 *
 * - **The notice** (`{ opensAt }`): from the start of the patch-local day
 *   `noticeDays` before the Eve until it opens, from the planned schedule
 *   (`plannedBossVisit`), on a patch that would pin it (an active member with
 *   a Partner, the Eve's partner gate if it has one).
 * - **The visit** while it's out: the bar whole (`state`, `chipped`,
 *   `goal`), how many Keepers chipped in (`chippers`, never who) and whether
 *   lights or the star warmed it up (`warmedUp`, never by how much).
 * - **The viewer's thanks** once paid (fell or dozed), until its asks close
 *   (`befriend.askHours` from the thanks), even past the visit's close.
 */
export async function christmasEveViewFor(
  db: Executor,
  rules: BossEventRules,
  miniBosses: MinibossSwitch,
  mapId: string,
  userId: string,
  at: Date,
): Promise<MapViewChristmasEve | null> {
  const eve = rules.christmasEve;
  if (!eve || miniBosses.mode === 'off') return null;
  const repo = createBossRepo(db);
  const map = await repo.findMap(mapId);
  if (!map || !minibossOpenFor(miniBosses, map.ownerUsername)) return null;

  const out = await repo.findChristmasEve(mapId, at);
  if (out) return visitView(repo, rules, out, userId, at);

  // Past its close, for this Keeper only while their thanks' asks are open.
  const since = new Date(at.getTime() - rules.befriend.askHours * HOUR_MS);
  const thanked = await repo.findThankedEve(mapId, userId, since);
  if (thanked) {
    const view = await visitView(repo, rules, thanked, userId, at);
    return view?.thanks ? view : null;
  }

  // The notice: this year's Eve, from `noticeDays` before until it opens.
  const today = localDate(at, map.timeZone);
  const day = `${today.slice(0, 4)}-${eve.day}`;
  if (today < addDays(day, -eve.noticeDays) || today > day) return null;
  const plan = plannedBossVisit(map, bossWeekOf(day), rules);
  if (plan?.kind !== 'christmas-eve' || at >= plan.opensAt) return null;
  // Only on a patch the Eve would pin on (`openVisit`'s own check).
  const { minPartnerLevel } = bossGatesFor(plan.kind, rules);
  const top = await repo.topPartnerLevel(mapId);
  if (top === null || (minPartnerLevel !== null && top < minPartnerLevel)) return null;
  return { opensAt: plan.opensAt.toISOString() };
}

/** A pinned Eve visit: its bar and the viewer's thanks, or `opensAt` alone before its bar opens. */
async function visitView(
  repo: BossRepo,
  rules: BossEventRules,
  window: BossWindowRow,
  userId: string,
  at: Date,
): Promise<MapViewChristmasEve | null> {
  const bar = await repo.findBar(window.mapId, window.windowId);
  if (!bar) return { opensAt: await eveOpening(repo, rules, window) };
  const thanks = await thanksView(repo, rules, window, bar, userId, at);
  return {
    opensAt: bar.opensAt.toISOString(),
    ...barView(bar, at),
    chippers: await repo.chippers(bar.mapId, bar.windowId),
    warmedUp: bar.headStart > 0,
    ...(thanks ? { thanks } : {}),
  };
}

/**
 * A visit pinned before X2 with no bar yet: the Eve's own opening in the
 * patch's zone, or the row's if that's later (a converted weekly row keeps
 * its earlier `opens_at`).
 */
async function eveOpening(
  repo: BossRepo,
  rules: BossEventRules,
  window: BossWindowRow,
): Promise<string> {
  const map = await repo.findMap(window.mapId);
  const plan = map ? plannedBossVisit(map, window.windowId, rules) : null;
  const opensAt =
    plan?.kind === 'christmas-eve' && plan.opensAt > window.opensAt ? plan.opensAt : window.opensAt;
  return opensAt.toISOString();
}

/**
 * The viewer's thanks (#37 X5a), once it's paid (`thanked_at`) and until its
 * asks close: what it put in their bag, the fall's asks left (`eveAsksLeft`,
 * as the battle view counts them; 0 after a doze) and the Eve fight an ask
 * goes on (their latest finished one, which `befriendBoss` takes).
 */
async function thanksView(
  repo: BossRepo,
  rules: BossEventRules,
  window: BossWindowRow,
  bar: BossBarDbRow,
  userId: string,
  at: Date,
): Promise<MapViewChristmasEveThanks | null> {
  const eve = rules.christmasEve;
  if (!eve || (bar.state !== 'fell' && bar.state !== 'dozed')) return null;
  const visitRow = await repo.findEncounter(bar.mapId, userId, bar.windowId);
  const thankedAt = visitRow?.thankedAt;
  if (!visitRow || !thankedAt) return null;
  if (at.getTime() >= thankedAt.getTime() + rules.befriend.askHours * HOUR_MS) return null;
  const battleId = await repo.lastFinishedFight(bar.mapId, userId, bar.opensAt, window.endsAt);
  if (!battleId) return null;
  const { kind, items } = thanksOf(bar.state, eve);
  const bond = kind === 'fell' ? await repo.findBond(bar.mapId, userId, window.speciesId) : null;
  return {
    kind,
    items,
    asksLeft: kind === 'fell' ? eveAsksLeft(visitRow, bond, rules, at) : 0,
    battleId,
  };
}
