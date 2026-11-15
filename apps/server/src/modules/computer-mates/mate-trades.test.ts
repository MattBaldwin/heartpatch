import {
  GAME_DATA,
  hexDistance,
  SELL_RULES,
  STARTERS,
  TRADE_VALUES,
  type PublicUser,
} from '@heartpatch/shared';
import { COMPUTER_MATES, type ComputerMatesSecrets } from '@heartpatch/shared/server';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { squishies, users } from '../../db/schema.js';
import { heartSeedOf } from '../maps/depart.js';
import { createMapsService } from '../maps/service.js';
import { grantItems } from '../inventory/service.js';
import { gatherProgressFacts } from '../progress/facts.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { createTradesService } from '../trades/service.js';
import { createComputerMateSteps } from './intents.js';
import { createComputerMatesService } from './service.js';

/*
 * Computer patch-mates trade and gift (#386d, plan §1 D–F, §6, §8), against
 * Postgres: a mate's answer, offer and gift go through trades' own cores,
 * the caps hold across all mates, the house counts them, and switching off
 * sends open offers home but leaves a waiting gift in the kid's mailbox.
 */

const url = inject('testDatabaseUrl');
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const HERO = STARTERS.speciesIds[0]!;

/** Mates that only answer: no claims, guards, fires, offers or gifts. */
const ANSWER_ONLY: ComputerMatesSecrets = {
  rules: { ...COMPUTER_MATES.rules, fireEveryTiles: 1000 },
  personas: COMPUTER_MATES.personas.map((p) => ({
    ...p,
    weights: { claim: 0, trade: 0, gift: 0, guard: 0, challenge: 0 },
  })),
};
const TRADE_ONLY: ComputerMatesSecrets = {
  ...ANSWER_ONLY,
  personas: ANSWER_ONLY.personas.map((p) => ({ ...p, weights: { ...p.weights, trade: 1 } })),
};
const GIFT_ONLY: ComputerMatesSecrets = {
  ...ANSWER_ONLY,
  personas: ANSWER_ONLY.personas.map((p) => ({ ...p, weights: { ...p.weights, gift: 1 } })),
};

describe.skipIf(!url)('computer patch-mates trade and gift (#386d, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let counter = 0;
  // 11:00 in Chicago, so a test's rounds stay inside one patch day.
  let at = new Date('2026-11-16T17:00:00Z');

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());

  const trades = () => createTradesService({ db, clock: () => at });
  const mates = (secrets?: ComputerMatesSecrets) =>
    createComputerMatesService({
      db,
      computerMates: { mode: 'on', testers: [] },
      clock: () => at,
      departed: (mapId, userId, actor) => trades().memberLeft(mapId, userId, actor),
      ...(secrets ? { secrets } : {}),
    });
  const steps = (secrets: ComputerMatesSecrets) =>
    createComputerMateSteps({ db, clock: () => at, secrets });

  async function player(): Promise<PublicUser> {
    const username = `mtkid_${String(process.pid)}_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014 })
      .returning({ id: users.id });
    return { id: user!.id, username };
  }

  /** The kid's land joined to their nearest post (as trades.test's `connect`). */
  async function connect(mapId: string, kid: PublicUser) {
    const tiles = await createTerritoryRepo(db).listTiles(mapId);
    const seed = heartSeedOf(tiles.filter((t) => t.ownerUserId === kid.id && t.homeSlot !== null));
    const post = tiles
      .filter((t) => t.terrain === 'trading-post')
      .sort((a, b) => hexDistance(seed, a) - hexDistance(seed, b))[0]!;
    const reach = hexDistance(seed, post);
    for (const t of tiles) {
      if (
        t.ownerUserId === null &&
        t.homeSlot === null &&
        t.terrain !== 'trading-post' &&
        hexDistance(seed, t) < reach &&
        hexDistance(t, post) + hexDistance(seed, t) === reach
      ) {
        await db.execute(`update tiles set owner_user_id = '${kid.id}' where id = '${t.id}'`);
      }
    }
    return { q: post.q, r: post.r };
  }

  async function pet(mapId: string, kid: PublicUser) {
    const species = GAME_DATA.species.find((s) => s.id === HERO)!;
    const [row] = await db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: kid.id,
        speciesId: HERO,
        element: species.element,
        feeling: species.feeling,
        level: 1,
      })
      .returning({ id: squishies.id });
    return row!.id;
  }

  /** A solo kid's patch with the switch on: three mates, a post, a bag and two squishies. */
  async function soloPatch(secrets?: ComputerMatesSecrets) {
    at = new Date(at.getTime() + 3 * 24 * HOUR_MS);
    const kid = await player();
    const maps = createMapsService({
      db,
      tutorialRequired: false,
      keeperRequired: false,
      clock: () => at,
    });
    const map = await maps.create(kid, { name: 'Mate Trades', timeZone: 'America/Chicago' });
    await mates(secrets).setEnabled(kid, map.id, true);
    const rows = await db.query.computerMates.findMany({
      where: (t, { eq }) => eq(t.mapId, map.id),
      orderBy: (t, { asc }) => [asc(t.userId)],
    });
    expect(rows).toHaveLength(3);
    const post = await connect(map.id, kid);
    await withTransaction(db, (tx) =>
      grantItems(tx, { mapId: map.id, userId: kid.id }, { timber: 40, stone: 40 }, 'dev-grant'),
    );
    const pets = [await pet(map.id, kid), await pet(map.id, kid)];
    return { kid, mapId: map.id, post, mateIds: rows.map((r) => r.userId), pets };
  }

  const mateRow = async (userId: string) =>
    (await db.query.computerMates.findFirst({ where: (t, { eq }) => eq(t.userId, userId) }))!;
  /** Runs the mate's next step at `when` (or right when it's due). */
  async function stepAt(secrets: ComputerMatesSecrets, userId: string, when?: Date) {
    const row = await mateRow(userId);
    at = when ?? new Date(row.nextActAt!.getTime());
    await db.execute(
      `update computer_mates set next_act_at = '${at.toISOString()}' where user_id = '${userId}'`,
    );
    return steps(secrets).act(userId, row.step);
  }
  const offerRow = async (id: string) =>
    (await db.query.tradeOffers.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!;
  const offersOn = (mapId: string) =>
    db.query.tradeOffers.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const bag = async (mapId: string, userId: string) =>
    Object.fromEntries(
      (
        await db.query.inventories.findMany({
          where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, userId)),
        })
      )
        .filter((r) => r.quantity > 0)
        .map((r) => [r.itemId, r.quantity]),
    );
  const item = (itemId: string, quantity: number) => ({ kind: 'item' as const, itemId, quantity });

  /** The kid sends an offer to `to` at their post; returns its id. */
  async function kidOffers(
    p: Awaited<ReturnType<typeof soloPatch>>,
    to: string,
    give: Parameters<ReturnType<typeof trades>['send']>[2]['give'],
    want: Parameters<ReturnType<typeof trades>['send']>[2]['want'],
    kind: 'trade' | 'gift' = 'trade',
  ) {
    const view = await trades().send(p.kid, p.mapId, {
      kind,
      toUserId: to,
      give,
      want,
      ...p.post,
    });
    return view.offers.find((o) => o.toUserId === to && o.status === 'open')!.id;
  }

  it('a computer mate declines an unfair offer and accepts a fair one after its delay', async () => {
    const p = await soloPatch();
    const mate = p.mateIds[0]!;
    const { personaId } = await mateRow(mate);
    const wait = COMPUTER_MATES.personas.find((x) => x.id === personaId)!.answerMinutes;

    // Unfair (4 for 40): untouched before the delay, a no after it.
    const unfair = await kidOffers(p, mate, [item('timber', 1)], [item('stone', 10)]);
    expect(await bag(p.mapId, p.kid.id)).toMatchObject({ timber: 39 });
    const sentAt = at;
    const early = await stepAt(
      ANSWER_ONLY,
      mate,
      new Date(sentAt.getTime() + (wait - 1) * MINUTE_MS),
    );
    expect(early).toMatchObject({ intent: null });
    expect((await offerRow(unfair)).status).toBe('open');
    const late = await stepAt(ANSWER_ONLY, mate, new Date(sentAt.getTime() + wait * MINUTE_MS));
    expect(late).toMatchObject({ intent: 'answer-offer', applied: true });
    expect((await offerRow(unfair)).status).toBe('declined');
    expect(await bag(p.mapId, p.kid.id)).toMatchObject({ timber: 40 });

    // Fair (a squishy for 8 stone, by TRADE_VALUES, no more than offerValue.max): a yes.
    // The kid's squishy goes to the mate (owner decision 6), and the stone
    // the kid asked for waits in the kid's mailbox, made at the yes.
    const fair = await kidOffers(
      p,
      mate,
      [{ kind: 'squishy', squishyId: p.pets[0]! }],
      [item('stone', 8)],
    );
    const fairAt = at;
    expect(
      await stepAt(ANSWER_ONLY, mate, new Date(fairAt.getTime() + wait * MINUTE_MS)),
    ).toMatchObject({ intent: 'answer-offer', applied: true });
    expect((await offerRow(fair)).status).toBe('accepted');
    const moved = await db.query.squishies.findFirst({
      where: (t, { eq }) => eq(t.id, p.pets[0]!),
    });
    expect(moved).toMatchObject({ ownerUserId: mate, state: 'active' });
    const view = await trades().view(p.kid, p.mapId);
    expect(view.mailbox.map((m) => m.lines)).toEqual([[item('stone', 8)]]);
    await trades().pickup(p.kid, p.mapId, p.post);
    expect(await bag(p.mapId, p.kid.id)).toMatchObject({ stone: 48 });

    // Worth more than offerValue.max from the mate (10 stone, 40): a no, even though fair.
    const big = await kidOffers(p, mate, [item('timber', 10)], [item('stone', 10)]);
    const bigAt = at;
    await stepAt(ANSWER_ONLY, mate, new Date(bigAt.getTime() + wait * MINUTE_MS));
    expect((await offerRow(big)).status).toBe('declined');
  });

  it('a kid can’t ask a mate for a squishy or clothing, only items from its shelf', async () => {
    const p = await soloPatch();
    const mate = p.mateIds[0]!;
    const [mateSquishy] = await db.query.squishies.findMany({
      where: (t, { eq }) => eq(t.ownerUserId, mate),
    });
    await expect(
      kidOffers(p, mate, [item('timber', 10)], [{ kind: 'squishy', squishyId: mateSquishy!.id }]),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const shelf = await trades().shelf(p.kid, p.mapId, mate);
    expect(shelf.squishies).toEqual([]);
    expect(shelf.clothing).toEqual([]);
    expect(shelf.items.every((i) => i.quantity === COMPUTER_MATES.rules.shelfPerItem)).toBe(true);
    // Everyday gathered resources only (386d): never a rescue-only, neverSold or crafted item.
    expect(shelf.items.map((i) => i.itemId)).toEqual([...COMPUTER_MATES.rules.mateItems].sort());
    const kinds = new Map(GAME_DATA.resources.map((r) => [r.id, r.kind]));
    for (const { itemId } of shelf.items) {
      expect(kinds.get(itemId), itemId).toBe('gathered');
      expect(['heartdust', 'glimmer', ...SELL_RULES.neverSold], itemId).not.toContain(itemId);
    }
    // Asking for something off the list: no.
    for (const off of ['heartdust', 'glimmer', 'heart-charm', 'jack-o-lantern-hearthfire']) {
      await expect(
        kidOffers(p, mate, [item('timber', 1)], [item(off, 1)]),
        off,
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    expect(await offersOn(p.mapId)).toEqual([]);
  });

  it('a computer offer is always inside the fair band; a kid’s yes counts for the house', async () => {
    const p = await soloPatch();
    const mate = p.mateIds[0]!;
    expect(await stepAt(TRADE_ONLY, mate)).toMatchObject({ intent: 'offer', applied: true });
    const [offer] = (await offersOn(p.mapId)).filter((o) => o.fromUserId === mate);
    expect(offer).toMatchObject({ kind: 'trade', toUserId: p.kid.id, noteId: 'want-to-trade' });
    const view = await trades().view(p.kid, p.mapId);
    const shown = view.offers.find((o) => o.id === offer!.id)!;
    expect([...shown.give, ...shown.want].every((l) => l.kind === 'item')).toBe(true);
    const worth = (lines: typeof shown.give) =>
      lines.reduce(
        (sum, l) =>
          sum + (l.kind === 'item' ? (TRADE_VALUES.items[l.itemId] ?? 0) * l.quantity : 0),
        0,
      );
    const [give, want] = [worth(shown.give), worth(shown.want)];
    expect(Math.min(give, want) * 100).toBeGreaterThanOrEqual(
      Math.max(give, want) * COMPUTER_MATES.rules.minFairPercent,
    );
    // Nothing left a mate's bag: its items were made at send.
    expect(await bag(p.mapId, mate)).toEqual({});

    const before = await bag(p.mapId, p.kid.id);
    await trades().accept(p.kid, p.mapId, offer!.id, p.post);
    expect((await offerRow(offer!.id)).status).toBe('accepted');
    // The kid's side went to the mate at once: nothing waits in its mailbox.
    const waiting = await db.query.mailbox.findMany({
      where: (t, { and, eq, isNull }) => and(eq(t.userId, mate), isNull(t.pickedUpAt)),
    });
    expect(waiting).toEqual([]);
    const after = await bag(p.mapId, p.kid.id);
    for (const l of shown.give) {
      if (l.kind === 'item') expect(after[l.itemId]).toBe((before[l.itemId] ?? 0) + l.quantity);
    }

    // House (#381): trades with mates count for trades and patch-mates, not posts.
    const facts = await gatherProgressFacts(db, {
      mapId: p.mapId,
      userId: p.kid.id,
      timeZone: 'America/Chicago',
      at,
    });
    expect(facts.trades).toEqual([{ kind: 'trade', partnerUserId: mate }]);
  });

  it('completedPerPatchDay and giftsPerPatchWeek hold across all mates', async () => {
    // Gifts: three gift-only mates, many steps, two gifts in the week.
    const g = await soloPatch();
    for (let round = 0; round < 3; round++) {
      for (const mate of g.mateIds) await stepAt(GIFT_ONLY, mate);
    }
    const gifts = (await offersOn(g.mapId)).filter((o) => o.kind === 'gift');
    expect(gifts).toHaveLength(COMPUTER_MATES.rules.giftsPerPatchWeek);
    const worth = await trades().view(g.kid, g.mapId);
    for (const m of worth.mailbox) {
      const value = m.lines.reduce(
        (sum, l) =>
          sum + (l.kind === 'item' ? (TRADE_VALUES.items[l.itemId] ?? 0) * l.quantity : 0),
        0,
      );
      expect(value).toBeLessThanOrEqual(COMPUTER_MATES.rules.giftMaxValue);
    }

    // Trades: one finished a patch day across all mates (cap 1 here).
    const ONE_A_DAY: ComputerMatesSecrets = {
      ...ANSWER_ONLY,
      rules: { ...ANSWER_ONLY.rules, completedPerPatchDay: 1 },
    };
    const p = await soloPatch(ONE_A_DAY);
    const sent: string[] = [];
    for (const mate of p.mateIds) {
      sent.push(await kidOffers(p, mate, [item('timber', 8)], [item('stone', 8)]));
    }
    const start = at;
    for (const mate of p.mateIds) {
      await stepAt(ONE_A_DAY, mate, new Date(start.getTime() + 40 * MINUTE_MS));
    }
    const statuses = async () => Promise.all(sent.map(async (id) => (await offerRow(id)).status));
    expect((await statuses()).filter((s) => s === 'accepted')).toHaveLength(1);
    expect((await statuses()).filter((s) => s === 'open')).toHaveLength(2);
    // The next patch day, one more.
    const tomorrow = new Date(start.getTime() + 24 * HOUR_MS);
    for (const mate of p.mateIds) await stepAt(ONE_A_DAY, mate, tomorrow);
    expect((await statuses()).filter((s) => s === 'accepted')).toHaveLength(2);
  });

  it('two mates stepping at once can’t both take the day’s last trade or the week’s last gift', async () => {
    const ONE: ComputerMatesSecrets = {
      ...ANSWER_ONLY,
      rules: { ...ANSWER_ONLY.rules, completedPerPatchDay: 1, giftsPerPatchWeek: 1 },
    };
    /** Both mates due at `when`, then both steps at once (the job runs two at a time). */
    const together = async (secrets: ComputerMatesSecrets, pair: string[], when: Date) => {
      const rows = await Promise.all(pair.map(mateRow));
      at = when;
      for (const mate of pair) {
        await db.execute(
          `update computer_mates set next_act_at = '${when.toISOString()}' where user_id = '${mate}'`,
        );
      }
      return Promise.all(rows.map((r) => steps(secrets).act(r.userId, r.step)));
    };

    // Yes: two fair offers waiting, room for one.
    const p = await soloPatch(ONE);
    const pair = p.mateIds.slice(0, 2);
    const sent: string[] = [];
    for (const mate of pair) {
      sent.push(await kidOffers(p, mate, [item('timber', 8)], [item('stone', 8)]));
    }
    await together(ONE, pair, new Date(at.getTime() + 40 * MINUTE_MS));
    const statuses = await Promise.all(sent.map(async (id) => (await offerRow(id)).status));
    expect(statuses.filter((s) => s === 'accepted')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'open')).toHaveLength(1);

    // Gifts: two gift-only mates, room for one gift this week.
    const GIFT_ONE: ComputerMatesSecrets = {
      ...ONE,
      personas: GIFT_ONLY.personas,
      rules: { ...ONE.rules, completedPerPatchDay: 3 },
    };
    const g = await soloPatch(GIFT_ONE);
    const gpair = g.mateIds.slice(0, 2);
    const results = await together(GIFT_ONE, gpair, new Date(at.getTime() + 40 * MINUTE_MS));
    expect(results.map((r) => r?.intent)).toEqual(['gift', 'gift']);
    expect((await offersOn(g.mapId)).filter((o) => o.kind === 'gift')).toHaveLength(1);
  });

  it('a mate picks up a kid’s gift, and it counts for the house', async () => {
    const p = await soloPatch();
    const mate = p.mateIds[1]!;
    const gift = await kidOffers(p, mate, [item('timber', 5)], [], 'gift');
    expect(await stepAt(ANSWER_ONLY, mate, new Date(at.getTime() + 40 * MINUTE_MS))).toMatchObject({
      intent: 'answer-offer',
      applied: true,
    });
    expect((await offerRow(gift)).status).toBe('accepted');
    expect(await bag(p.mapId, mate)).toMatchObject({ timber: 5 });
    const facts = await gatherProgressFacts(db, {
      mapId: p.mapId,
      userId: p.kid.id,
      timeZone: 'America/Chicago',
      at,
    });
    expect(facts.trades).toEqual([{ kind: 'gift', partnerUserId: mate }]);
  });

  it('switching off departs every mate: land wild, offers home, a waiting gift stays', async () => {
    const p = await soloPatch();
    const [giver, trader, asked] = p.mateIds as [string, string, string];
    expect(await stepAt(GIFT_ONLY, giver)).toMatchObject({ intent: 'gift', applied: true });
    expect(await stepAt(TRADE_ONLY, trader)).toMatchObject({ intent: 'offer', applied: true });
    const kidOffer = await kidOffers(p, asked, [item('timber', 10)], [item('stone', 10)]);
    const offers = await offersOn(p.mapId);
    const gift = offers.find((o) => o.fromUserId === giver)!;
    const mateOffer = offers.find((o) => o.fromUserId === trader)!;

    at = new Date(at.getTime() + 25 * HOUR_MS);
    await mates().setEnabled(p.kid, p.mapId, false);
    expect((await offerRow(mateOffer.id)).status).toBe('cancelled');
    expect((await offerRow(kidOffer)).status).toBe('cancelled');
    expect(await bag(p.mapId, p.kid.id)).toMatchObject({ timber: 40 });
    // The gift still waits for the kid, and they can pick it up.
    expect((await offerRow(gift.id)).status).toBe('open');
    const view = await trades().view(p.kid, p.mapId);
    expect(view.mailbox.map((m) => m.offerId)).toEqual([gift.id]);
    await trades().pickup(p.kid, p.mapId, p.post);
    expect((await offerRow(gift.id)).status).toBe('accepted');
    // A made thing that went home lands in no bag.
    expect(await bag(p.mapId, trader)).toEqual({});
  });
});
