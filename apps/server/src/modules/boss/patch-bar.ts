import type { BossPatchBar, BossThanksKind } from '@heartpatch/shared';
import type { BossEventRules, ChristmasEveBossRules } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { grantItems, lockGrantRows } from '../inventory/service.js';
import type { BattleRow } from '../battles/repo.js';
import { barGoal, barHeadStart, barStateAt, chipPoints } from './bar.js';
import { createBossRepo, type BossBarDbRow, type BossWindowRow } from './repo.js';

/*
 * The Christmas Eve patch bar (#37 X2; addendum "The patch bar", "When it
 * falls", "If the bar is short"; owner answers 2 and 4). Every fight a
 * Keeper finishes against the Eve visit chips one shared bar; when it fills
 * the BIG squishy is tuckered out for everyone, and if it's short at the
 * close it dozes off. Contributors are thanked lazily (rule 4), once each.
 * Nothing is ever taken.
 *
 * Lock order (tech spec §7, step 5e):
 * - a finish: the battle (5), its `boss_windows` row `FOR SHARE`, then the
 *   bar `FOR UPDATE`, then its `boss_bar_chips` insert; it never takes a
 *   `boss_encounters` row on the Eve (a weekly win's `markWon` takes that
 *   after the window, as before);
 * - a pin or a conversion: `boss_windows` (insert or update), then
 *   `boss_encounters` (the conversion's reset), then the bar's insert;
 * - a doze: the bar `FOR UPDATE` alone;
 * - a thanks: the Keeper's `boss_encounters` row (the `thanked_at IS NULL`
 *   update is its lock and its uniqueness), then their inventory rows (11),
 *   then `boss.thanked` (`maps`, 13). It reads the bar unlocked: `fell` and
 *   `dozed` never change once written.
 * No transaction takes a bar after an encounter, so none can wait in a cycle.
 */

type EveRules = ChristmasEveBossRules;

/** The bar as a Keeper sees it (`PlayerBattle.boss.patchBar`, `MapView.christmas.eve`). */
export function barView(bar: BossBarDbRow, at: Date): BossPatchBar {
  return { goal: bar.goal, chipped: bar.chipped, state: barStateAt(bar, at) };
}

/**
 * Opens a Christmas Eve visit's bar once (the insert is the idempotency),
 * in the caller's transaction: the goal from the patch's active Keepers,
 * the head start from its lit lights and star right now. `opensAt` is the
 * Eve's own opening (a converted weekly row keeps its earlier `opens_at`),
 * `closesAt` the visit's end. Null if it was already open.
 */
export async function openBar(
  tx: Executor,
  window: Pick<BossWindowRow, 'mapId' | 'windowId' | 'endsAt'>,
  opensAt: Date,
  eve: EveRules,
): Promise<BossBarDbRow | null> {
  const repo = createBossRepo(tx);
  const goal = barGoal(eve.bar, await repo.activeKeepers(window.mapId));
  const lights = await repo.litLights(window.mapId);
  const star = await repo.starLit(window.mapId);
  const headStart = barHeadStart(eve.bar, goal, lights, star);
  return repo.insertBar({
    mapId: window.mapId,
    windowId: window.windowId,
    goal,
    chipped: headStart,
    state: 'open',
    headStart,
    headStartLights: Math.min(lights, 32_767),
    headStartStar: star,
    opensAt,
    closesAt: window.endsAt,
    fellAt: null,
  });
}

/**
 * A finished fight's chip (#37 X2), in its finish transaction right after
 * the visit's shared lock: the bar `FOR UPDATE`, this fight's points added
 * once (unique per battle), and the fall set once, by the chip that fills
 * it. Win, loss or wander-off, every finish counts, and a fight after the
 * fall still counts. Returns the events to append (`boss.chipped`, and
 * `boss.fell` once); the battle's finish publishes them after commit.
 *
 * Nothing chips for a fight started before the Eve's own opening (a weekly
 * fight still going on a converted row), or one finished after the close.
 */
export async function chipOnFinish(
  tx: Executor,
  battle: Pick<BattleRow, 'id' | 'mapId' | 'playerUserId' | 'state'>,
  bar: BossBarDbRow,
  eve: EveRules,
  at: Date,
): Promise<NewGameEvent[]> {
  const repo = createBossRepo(tx);
  if (bar.state === 'dozed' || at >= bar.closesAt) return [];
  const boss = battle.state.sides.b.squishies[0];
  if (!boss) return [];
  const points = chipPoints(eve.bar, boss);
  const fresh = await repo.insertChip({
    mapId: bar.mapId,
    windowId: bar.windowId,
    userId: battle.playerUserId,
    battleId: battle.id,
    points,
    createdAt: at,
  });
  if (!fresh) return [];
  const chipped = bar.chipped + points;
  const falls = bar.state === 'open' && chipped >= bar.goal;
  const fellAt = falls ? at : bar.fellAt;
  await repo.setBar(bar.mapId, bar.windowId, {
    chipped,
    state: falls ? 'fell' : bar.state,
    fellAt,
  });
  const events: NewGameEvent[] = [
    {
      mapId: bar.mapId,
      type: 'boss.chipped',
      actorUserId: battle.playerUserId,
      payload: {
        window: bar.windowId,
        userId: battle.playerUserId,
        battleId: battle.id,
        points,
        chipped,
        goal: bar.goal,
      },
    },
  ];
  if (falls) {
    events.push({
      mapId: bar.mapId,
      type: 'boss.fell',
      actorUserId: null,
      payload: { window: bar.windowId, fellAt: at.toISOString(), chipped, goal: bar.goal },
    });
  }
  return events;
}

/**
 * Where a Keeper's tries on this visit start counting (#37 X2, keyed by
 * window): a Christmas Eve visit's own opening, so weekly fights earlier on
 * December 24 leave the Eve's tries whole; any other visit's `opens_at`.
 * Tries are still per patch-local day from there.
 */
export async function triesFrom(
  db: Executor,
  window: Pick<BossWindowRow, 'mapId' | 'windowId' | 'kind' | 'opensAt'>,
): Promise<Date> {
  if (window.kind !== 'christmas-eve') return window.opensAt;
  const bar = await createBossRepo(db).findBar(window.mapId, window.windowId);
  return bar && bar.opensAt > window.opensAt ? bar.opensAt : window.opensAt;
}

/** What a settled bar thanks its contributors with: the fall's bundle and asks, or the doze's. */
function thanksOf(state: 'fell' | 'dozed', eve: EveRules) {
  return state === 'fell'
    ? { kind: 'fell' as BossThanksKind, items: { ...eve.fallBundle }, asks: eve.fallAsks }
    : { kind: 'dozed' as BossThanksKind, items: { ...eve.dozedBundle }, asks: 0 };
}

/**
 * Pays one Keeper's Christmas Eve thanks if it's due (#37 X2, owner answers
 * 2 and 4): the bar fell or dozed off, they finished at least
 * `contributorMinFights` fights before the close, and it isn't paid yet.
 * One transaction: their visit row's `thanked_at` (once), the bundle into
 * their bag (`christmas-boss`, ref the bar), then `boss.thanked`. True if
 * this call paid it; the caller publishes after commit.
 */
export async function thankKeeper(
  db: Executor,
  rules: BossEventRules,
  bar: BossBarDbRow,
  userId: string,
  at: Date,
): Promise<boolean> {
  const eve = rules.christmasEve;
  const state = barStateAt(bar, at);
  if (!eve || state === 'open' || bar.state === 'open') return false;
  return createBossRepo(db).transaction(async (repo, tx) => {
    const fights = await repo.chipsBy(bar.mapId, bar.windowId, userId, bar.closesAt);
    if (fights < eve.contributorMinFights) return false;
    if (!(await repo.markThanked(bar.mapId, userId, bar.windowId, at))) return false;
    const thanks = thanksOf(state, eve);
    await lockGrantRows(tx, bar.mapId, [{ userId, items: thanks.items }]);
    await grantItems(tx, { mapId: bar.mapId, userId }, thanks.items, 'christmas-boss', bar.id, at);
    await repo.appendEvent({
      mapId: bar.mapId,
      type: 'boss.thanked',
      actorUserId: userId,
      payload: { window: bar.windowId, userId, ...thanks },
    });
    return true;
  });
}

/**
 * The sweep's bar pass (#37 X2): an open bar past its close dozes off (its
 * own transaction, under the bar's lock, so a last-second fall wins), then
 * every settled bar's unpaid contributors are thanked. Returns the patches
 * whose live sync should run. Idempotent: a retry pays nobody twice.
 */
export async function settleBars(
  db: Executor,
  rules: BossEventRules,
  at: Date,
  only?: readonly string[],
): Promise<string[]> {
  const eve = rules.christmasEve;
  if (!eve) return [];
  const touched = new Set<string>();
  for (const due of await createBossRepo(db).barsToSettle(at)) {
    if (only && !only.includes(due.mapId)) continue;
    let bar = due;
    if (bar.state === 'open') {
      bar = await createBossRepo(db).transaction(async (repo) => {
        const locked = await repo.lockBar(due.mapId, due.windowId);
        if (!locked || locked.state !== 'open' || at < locked.closesAt) return locked ?? due;
        const dozed = { chipped: locked.chipped, state: 'dozed', fellAt: null };
        await repo.setBar(locked.mapId, locked.windowId, dozed);
        return { ...locked, ...dozed };
      });
      if (bar.state === 'open') continue;
      touched.add(bar.mapId);
    }
    const owed = await createBossRepo(db).unthanked(
      bar.mapId,
      bar.windowId,
      bar.closesAt,
      eve.contributorMinFights,
    );
    for (const userId of owed) {
      if (await thankKeeper(db, rules, bar, userId, at)) touched.add(bar.mapId);
    }
  }
  return [...touched];
}
