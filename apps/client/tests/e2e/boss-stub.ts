import { GAME_DATA } from '@heartpatch/shared';
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
}

export interface BossStub {
  /** The `team` actions the client sent. */
  readonly rounds: Json[];
  /** The befriend asks: body and idempotency key. */
  readonly asks: { body: Json; key: string | null }[];
}

const DAY = 24 * 60 * 60 * 1000;
const STOMP = 'big-stomp';

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
    boss.boss = true;
    boss.stats = { ...boss.stats, hp: boss.stats.hp * 3 };
    boss.energy = boss.stats.hp;
  }
  delete b.firstMeeting;
  delete b.lured;
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...b,
    kind: 'miniboss',
    moveDefs: [...((b.moveDefs as Json[] | undefined) ?? []), stomp],
    view: {
      ...b.view,
      format: { a: team, b: 1 },
      sides: { a: { ...mine, active: 0, out: [...Array(team).keys()] }, b: theirs },
    },
    boss: {
      eventWindow: {
        id: today,
        endsAt: new Date(Date.now() + (options.endsInMs ?? 2 * DAY)).toISOString(),
      },
      triesLeftToday: options.triesLeftToday ?? 2,
      charmsPerAsk: 3,
      asksLeft: 2,
      befriend: 'none',
    },
  };
}

/** The round played out: the boss's area stomp on all three, a second stomp, then the friends win (or nap). */
function playRound(
  b: Battle,
  picks: { slot: number; move: string }[],
  options: BossStubOptions,
): Battle {
  const turn = b.view.turn;
  const mine = b.view.sides.a.squishies;
  const boss = b.view.sides.b.squishies[0]!;
  const out = (b.view.sides.a.out as number[] | undefined) ?? [0];
  const log: Json[] = [...b.view.log];
  const won = (options.outcome ?? 'won') === 'won';
  const at = (side: 'a' | 'b', slot: number) => ({ turn, side, slot });
  const bossMove = boss.moves[0] ?? picks[0]!.move;
  // The first stomp lands on everyone (an area move), the second on one.
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
    log.push({ ...at('b', 0), type: 'move', move: bossMove });
    const s = mine[out[0]!]!;
    log.push({
      ...at('a', out[0]!),
      type: 'hit',
      amount: 4,
      energy: Math.max(1, Math.round(s.stats.hp * 0.45)),
      effectiveness: 'normal',
    });
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
    if (e.type === 'hit') energies.set(`${String(e.side)}${String(e.slot)}`, e.energy as number);
  }
  const sides = { ...b.view.sides };
  for (const side of ['a', 'b'] as const) {
    sides[side] = {
      ...sides[side],
      squishies: sides[side].squishies.map((s, slot) => ({
        ...s,
        energy: energies.get(`${side}${String(slot)}`) ?? s.energy,
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
        evolvingBefore: null,
        evolvingAfter: null,
      })),
      percent: 100,
      coins: won ? { patch: 5, heart: 5 } : null,
      bundle: won ? { 'heart-charm': 3, heartdust: 5, treats: 3 } : null,
    },
    boss: {
      ...b.boss,
      triesLeftToday: won
        ? b.boss?.triesLeftToday
        : Math.max(0, (b.boss?.triesLeftToday as number) - 1),
      asksLeft: won && options.winState !== 'have-one' ? 2 : 0,
      befriend: won ? (options.winState ?? 'offer') : 'none',
    },
  };
}

/** Installs the stand-in routes on `page`; returns what the client sent. */
export async function stubBossFight(page: Page, options: BossStubOptions = {}): Promise<BossStub> {
  const stub: { rounds: Json[]; asks: { body: Json; key: string | null }[] } = {
    rounds: [],
    asks: [],
  };
  let last: Battle | null = null;
  const keep = (b: Battle) => (last = b);
  const header = (req: Request) => req.headers()['idempotency-key'] ?? null;

  await page.route(/\/api\/v1\/.*battles?.*/, async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'POST' && /\/battles\/[^/]+\/actions$/.test(url) && last) {
      const body = req.postDataJSON() as { action: Json };
      stub.rounds.push(body.action);
      const picks = (body.action.picks as { slot: number; move: string }[] | undefined) ?? [];
      await route.fulfill({ json: { battle: keep(playRound(last, picks, options)) } });
      return;
    }
    if (req.method() === 'POST' && /\/battles\/[^/]+\/befriend$/.test(url) && last) {
      const body = req.postDataJSON() as { ask: number };
      stub.asks.push({ body, key: header(req) });
      const script = options.befriend ?? ['joined'];
      const outcome = script[Math.min(script.length, body.ask) - 1] ?? 'joined';
      const asksLeft = outcome === 'joined' ? 0 : Math.max(0, 2 - body.ask);
      const next = keep({ ...last, boss: { ...last.boss, asksLeft, befriend: outcome } });
      await route.fulfill({
        json: {
          outcome,
          squishyId: outcome === 'joined' ? '00000000-0000-7000-8000-0000000000b1' : null,
          battle: next,
        },
      });
      return;
    }
    const reply = await route.fetch();
    const type = reply.headers()['content-type'] ?? '';
    if (!type.includes('json')) {
      await route.fulfill({ response: reply });
      return;
    }
    const json = (await reply.json()) as { battle?: Battle | null };
    if (json.battle && json.battle.status === 'active')
      json.battle = keep(toBoss(json.battle, options));
    await route.fulfill({ response: reply, json });
  });
  return stub;
}
