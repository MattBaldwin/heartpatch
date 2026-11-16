import { BATTLE_RULES, GAME_DATA } from '@heartpatch/shared';
import type { Page, Request } from '@playwright/test';

/**
 * A stand-in mini-boss fight for the battle screen (#190, 190e). No boss
 * visits yet (the boss bag is empty until its content lands, #234) and the
 * server has no dev route to start one, so these routes turn the dev fight
 * the player starts into a 3-v-1 boss fight on its way to the client, and
 * answer its round and befriend asks the way 190b and 190c do (same shapes,
 * checked by the client's own zod schemas). Everything else is the real app.
 */

type Json = Record<string, unknown>;
type Battle = Json & {
  id: string;
  view: Json & {
    turn: number;
    log: Json[];
    sides: Record<
      'a' | 'b',
      Json & { squishies: (Json & { id: string; moves: string[]; stats: Json & { hp: number } })[] }
    >;
  };
  boss?: Json;
};

export type BefriendScript = readonly ('not-yet' | 'joined')[];

export interface BossStubOptions {
  /** Answers to the asks, in order (the last repeats). */
  readonly befriend?: BefriendScript;
  /** The win's befriend state: `have-one` for a duplicate (no ask, no spend). */
  readonly winState?: 'offer' | 'have-one';
  /** The round's outcome. */
  readonly outcome?: 'won' | 'lost';
  readonly triesLeftToday?: number;
  /** The visit's end, ms from now (48 h by default). */
  readonly endsInMs?: number;
  /** Heart Charms in the bag before the fight (3 by default); the win's bundle adds 3, each ask spends 3. */
  readonly charms?: number;
  /** Ask numbers whose first try is refused with a 409 (the ask moved on elsewhere). */
  readonly conflictOn?: readonly number[];
  /** The boss kind's warmth step before the fight (0–4). */
  readonly warmth?: number;
  /** Rounds before the one that ends it (0 by default): each stomps everyone and goes on. */
  readonly openRounds?: number;
}

export interface BossStub {
  /** The `team` actions the client sent. */
  readonly rounds: Json[];
  /** The befriend asks: body and idempotency key. */
  readonly asks: { body: Json; key: string | null }[];
  /** Heart Charms in the stand-in bag now. */
  readonly charms: () => number;
  /** `GET /battles/:id` calls answered from the stand-in fight. */
  readonly fetches: () => number;
}

/** The boss line's base form, as the server names it (`PlayerBattle.boss.baseName`). */
export const STUB_BASE_NAME = 'Puddlet';
const CHARMS_PER_ASK = 3;

const DAY = 24 * 60 * 60 * 1000;
const STOMP = 'big-stomp';
/** The shipped boss hp rule; a stub with no boss rule would test a fight that can't happen. */
const BOSS_HP_PERCENT = (() => {
  const hp = BATTLE_RULES.boss?.stats.hp;
  if (hp === undefined)
    throw new Error('boss-stub: BATTLE_RULES.boss is missing (no boss hp rule)');
  return hp;
})();

function toBoss(b: Battle, options: BossStubOptions): Battle {
  const mine = b.view.sides.a;
  const theirs = b.view.sides.b;
  const team = Math.min(3, mine.squishies.length);
  const boss = theirs.squishies[0];
  // Its big stomp hits every foe at once (an area move, `targets: 'all-foes'`),
  // sent as a move def the way a secret boss move is.
  const base =
    GAME_DATA.moves.find((m) => m.id === boss?.moves[0] && m.power > 0) ??
    GAME_DATA.moves.find((m) => m.power > 0)!;
  const stomp = { ...base, id: STOMP, name: 'Big Stomp', targets: 'all-foes' };
  if (boss) {
    boss.moves = [STOMP, ...boss.moves.slice(0, 3)];
    boss['boss'] = true;
    // The shipped boss rule (hp ×1.5 today), so the stub never drifts from it.
    boss.stats = { ...boss.stats, hp: Math.round((boss.stats.hp * BOSS_HP_PERCENT) / 100) };
    boss['energy'] = boss.stats.hp;
  }
  delete b['firstMeeting'];
  delete b['lured'];
  // The server's game clock (e2e runs shift it by whole days), not this runner's.
  const now = Date.parse(String(b['startedAt'])) || Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  return {
    ...b,
    kind: 'miniboss',
    moveDefs: [...((b['moveDefs'] as Json[] | undefined) ?? []), stomp],
    view: {
      ...b.view,
      format: { a: team, b: 1 },
      sides: { a: { ...mine, active: 0, out: [...Array(team).keys()] }, b: theirs },
    },
    boss: {
      eventWindow: {
        id: today,
        endsAt: new Date(now + (options.endsInMs ?? 2 * DAY)).toISOString(),
      },
      triesLeftToday: options.triesLeftToday ?? 2,
      charmsPerAsk: 3,
      asksLeft: 2,
      befriend: 'none',
      baseName: STUB_BASE_NAME,
      warmth: options.warmth ?? 0,
    },
  };
}

/** A round that doesn't end it: the boss's one area stomp (one action a round), then each friend's move. */
function openRound(b: Battle, picks: { slot: number; move: string }[]): Battle {
  const turn = b.view.turn;
  const mine = b.view.sides.a.squishies;
  const boss = b.view.sides.b.squishies[0]!;
  const out = (b.view.sides.a['out'] as number[] | undefined) ?? [0];
  const log: Json[] = [...b.view.log];
  const at = (side: 'a' | 'b', slot: number) => ({ turn, side, slot });
  const bossMove = boss.moves[0] ?? picks[0]!.move;
  const energy = (s: Json & { stats: Json & { hp: number } }) =>
    Math.max(1, Math.round(((s['energy'] as number | undefined) ?? s.stats.hp) * 0.8));
  const next = new Map<string, number>();
  log.push({ ...at('b', 0), type: 'move', move: bossMove });
  for (const slot of out) {
    const e = energy(mine[slot]!);
    next.set(`a${String(slot)}`, e);
    log.push({ ...at('a', slot), type: 'hit', amount: 5, energy: e, effectiveness: 'normal' });
  }
  let left = (boss['energy'] as number | undefined) ?? boss.stats.hp;
  for (const pick of picks) {
    left = Math.max(1, Math.round(left * 0.85));
    log.push({ ...at('a', pick.slot), type: 'move', move: pick.move });
    log.push({ ...at('b', 0), type: 'hit', amount: 10, energy: left, effectiveness: 'normal' });
  }
  next.set('b0', left);
  const sides = { ...b.view.sides };
  for (const side of ['a', 'b'] as const) {
    sides[side] = {
      ...sides[side],
      squishies: sides[side].squishies.map((s, slot) => ({
        ...s,
        energy: next.get(`${side}${String(slot)}`) ?? s['energy'],
      })),
    };
  }
  return { ...b, view: { ...b.view, turn: turn + 1, log, sides } };
}

/** The round played out: the boss's one area stomp on all three, then the friends win (or nap). */
function playRound(
  b: Battle,
  picks: { slot: number; move: string }[],
  options: BossStubOptions,
): Battle {
  const turn = b.view.turn;
  const mine = b.view.sides.a.squishies;
  const boss = b.view.sides.b.squishies[0]!;
  const out = (b.view.sides.a['out'] as number[] | undefined) ?? [0];
  const log: Json[] = [...b.view.log];
  const won = (options.outcome ?? 'won') === 'won';
  const at = (side: 'a' | 'b', slot: number) => ({ turn, side, slot });
  const bossMove = boss.moves[0] ?? picks[0]!.move;
  // One action a round (`BATTLE_RULES.boss.actionsPerRound`): the stomp lands on everyone (an area move).
  log.push({ ...at('b', 0), type: 'move', move: bossMove });
  for (const slot of out) {
    const s = mine[slot]!;
    const energy = won ? Math.max(1, Math.round(s.stats.hp * 0.55)) : 0;
    log.push({
      ...at('a', slot),
      type: 'hit',
      amount: s.stats.hp - energy,
      energy,
      effectiveness: 'normal',
    });
    if (!won) log.push({ ...at('a', slot), type: 'tuckered-out' });
  }
  if (won) {
    let left = boss.stats.hp;
    picks.forEach((pick, i) => {
      left = i === picks.length - 1 ? 0 : Math.round(left * 0.5);
      log.push({ ...at('a', pick.slot), type: 'move', move: pick.move });
      log.push({ ...at('b', 0), type: 'hit', amount: 10, energy: left, effectiveness: 'normal' });
    });
    log.push({ ...at('b', 0), type: 'tuckered-out' });
  }
  const energies = new Map<string, number>();
  for (const e of log) {
    if (e['type'] === 'hit')
      energies.set(`${String(e['side'])}${String(e['slot'])}`, e['energy'] as number);
  }
  const sides = { ...b.view.sides };
  for (const side of ['a', 'b'] as const) {
    sides[side] = {
      ...sides[side],
      squishies: sides[side].squishies.map((s, slot) => ({
        ...s,
        energy: energies.get(`${side}${String(slot)}`) ?? s['energy'],
      })),
    };
  }
  const xp = out.map((slot) => ({ side: 'a', squishyId: mine[slot]!.id, xp: won ? 180 : 40 }));
  return {
    ...b,
    status: 'finished',
    endedAt: new Date().toISOString(),
    view: {
      ...b.view,
      turn: turn + 1,
      log,
      sides,
      phase: {
        type: 'over',
        result: {
          winner: won ? 'a' : 'b',
          reason: 'tuckered-out',
          contentHash: 'stub',
          turns: turn + 1,
          xp,
        },
      },
    },
    rewards: {
      xp: xp.map((x) => ({
        squishyId: x.squishyId,
        xp: x.xp,
        // Each friend's evolving meter (#205) moves a little on a win.
        evolvingBefore: won ? 20 : null,
        evolvingAfter: won ? 35 : null,
      })),
      percent: 100,
      coins: won ? { patch: 5, heart: 5 } : null,
      bundle: won ? { 'heart-charm': 3, heartdust: 5, treats: 3 } : null,
    },
    boss: {
      ...b.boss,
      triesLeftToday: won
        ? b.boss?.['triesLeftToday']
        : Math.max(0, (b.boss?.['triesLeftToday'] as number) - 1),
      asksLeft: won && options.winState !== 'have-one' ? 2 : 0,
      befriend: won ? (options.winState ?? 'offer') : 'none',
    },
  };
}

/** Installs the stand-in routes on `page`; returns what the client sent. */
export async function stubBossFight(page: Page, options: BossStubOptions = {}): Promise<BossStub> {
  let charms = options.charms ?? 3;
  let open = options.openRounds ?? 0;
  let fetches = 0;
  const conflicts = new Set(options.conflictOn ?? []);
  const stub: BossStub = {
    rounds: [],
    asks: [],
    charms: () => charms,
    fetches: () => fetches,
  };
  let last: Battle | null = null;
  /** Answered asks, by number: a retried ask with its key gets the same answer. */
  const answered = new Map<number, Json>();

  // The bag's Heart Charms, as the stand-in fight moves them (the real bag never sees it).
  await page.route(/\/api\/v1\/maps\/[^/]+\/inventory$/, async (route) => {
    const reply = await route.fetch();
    const json = (await reply.json()) as { items?: Record<string, number> };
    json.items = { ...json.items, 'heart-charm': charms };
    await route.fulfill({ response: reply, json });
  });
  const keep = (b: Battle) => (last = b);
  const header = (req: Request) => req.headers()['idempotency-key'] ?? null;

  await page.route(/\/api\/v1\/.*battles?.*/, async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'POST' && /\/battles\/[^/]+\/actions$/.test(url) && last) {
      const body = req.postDataJSON() as { action: Json };
      stub.rounds.push(body.action);
      const picks = (body.action['picks'] as { slot: number; move: string }[] | undefined) ?? [];
      if (open > 0) {
        open -= 1;
        await route.fulfill({ json: { battle: keep(openRound(last, picks)) } });
        return;
      }
      const played = keep(playRound(last, picks, options));
      const bundle = (played['rewards'] as { bundle?: Record<string, number> | null } | null)
        ?.bundle;
      charms += bundle?.['heart-charm'] ?? 0;
      await route.fulfill({ json: { battle: played } });
      return;
    }
    // The finished stand-in fight, as the server would have it now.
    if (
      req.method() === 'GET' &&
      last?.['status'] === 'finished' &&
      new RegExp(`/battles/${last.id}$`).test(url)
    ) {
      fetches += 1;
      await route.fulfill({ json: { battle: last } });
      return;
    }
    if (req.method() === 'POST' && /\/battles\/[^/]+\/befriend$/.test(url) && last) {
      const body = req.postDataJSON() as { ask: number };
      stub.asks.push({ body, key: header(req) });
      const stored = answered.get(body.ask);
      if (stored) {
        await route.fulfill({ json: stored });
        return;
      }
      if (conflicts.delete(body.ask)) {
        await route.fulfill({
          status: 409,
          json: { error: { code: 'CONFLICT', message: 'Oops, that ask got mixed up. Try again!' } },
        });
        return;
      }
      if (charms < CHARMS_PER_ASK) {
        await route.fulfill({
          status: 409,
          json: { error: { code: 'CONFLICT', message: 'You need 3 Heart Charms to ask. 💗' } },
        });
        return;
      }
      charms -= CHARMS_PER_ASK;
      const script = options.befriend ?? ['joined'];
      const outcome = script[Math.min(script.length, body.ask) - 1] ?? 'joined';
      const asksLeft = outcome === 'joined' ? 0 : Math.max(0, 2 - body.ask);
      const warmth = Math.min(
        4,
        Number(last.boss?.['warmth'] ?? 0) + (outcome === 'joined' ? 0 : 1),
      );
      const next = keep({ ...last, boss: { ...last.boss, asksLeft, befriend: outcome, warmth } });
      const json = {
        outcome,
        squishyId: outcome === 'joined' ? '00000000-0000-7000-8000-0000000000b1' : null,
        battle: next,
      };
      answered.set(body.ask, json);
      await route.fulfill({ json });
      return;
    }
    const reply = await route.fetch();
    const type = reply.headers()['content-type'] ?? '';
    if (!type.includes('json')) {
      await route.fulfill({ response: reply });
      return;
    }
    const json = (await reply.json()) as { battle?: Battle | null };
    if (json.battle && json.battle['status'] === 'active')
      json.battle = keep(toBoss(json.battle, options));
    await route.fulfill({ response: reply, json });
  });
  return stub;
}
