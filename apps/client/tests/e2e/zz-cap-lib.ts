import { expect, test, type Page, type Route } from '@playwright/test';
import { tradeBalance, tradeValuer, heartsOf, type ValuedLine } from '@heartpatch/shared';

export const OUT = '/tmp/claude-0/-home-user-heartpatch/5b0adc95-b891-5120-8619-9610cd69cc02/scratchpad/shots';
export const MATES = ['Bramble', 'Marigold', 'Pocket'];
export const mateId = (i: number) => `00000000-0000-4000-8000-00000000038${String(i)}`;
export const uuid = (n: number) => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, '0')}`;

export interface Member {
  user: { id: string; username: string };
  role: string;
  homeSlot: number | null;
  computer?: { personaId: string };
}

export function withMates(members: Member[]): Member[] {
  const base = members[0];
  if (!base) return members;
  return [
    ...members,
    ...MATES.map((name, i) => ({
      ...base,
      user: { ...base.user, id: mateId(i), username: name },
      role: 'member',
      homeSlot: members.length + i,
      computer: { personaId: name.toLowerCase() },
    })),
  ];
}

export interface Rig {
  on: boolean;
  mapId: string;
  claim: { q: number; r: number } | null;
  me: string;
  seq: number;
  push: (type: string, data: Record<string, unknown>) => void;
  /** Extra patch applied to GET /trades. */
  trades: ((t: Record<string, any>) => void) | null;
  shelf: Record<string, unknown> | null;
  raids: Record<string, unknown> | null;
  challenge: { hold: Promise<void>; release: () => void } | null;
}

export async function rig(page: Page): Promise<Rig> {
  const r: Rig = {
    on: false, mapId: '', claim: null, me: '', seq: 0, push: () => undefined,
    trades: null, shelf: null, raids: null, challenge: null,
  };
  await page.context().addInitScript(() => {
    try {
      if (!location.search.includes('tier=')) history.replaceState(null, '', location.pathname + '?tier=high');
    } catch {}
  });
  let sock: { send: (m: string) => void } | null = null;
  await page.routeWebSocket(/\/ws/, (ws) => {
    const server = ws.connectToServer();
    sock = ws;
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      try {
        const j = JSON.parse(String(m)) as { seq?: number };
        if (typeof j.seq === 'number') r.seq = Math.max(r.seq, j.seq);
      } catch {}
      ws.send(m);
    });
  });
  r.push = (type, data) => {
    r.seq += 1;
    sock?.send(JSON.stringify({ v: 1, type, mapId: r.mapId, seq: r.seq, at: new Date().toISOString(), data }));
  };
  const json = async (route: Route, edit: (j: any) => void) => {
    const response = await route.fetch();
    const j = await response.json();
    edit(j);
    return route.fulfill({ response, json: j });
  };
  await page.route(/\/api\/v1\/maps\/[0-9a-f-]{36}\/computer-mates$/, async (route) => {
    const body = route.request().postDataJSON() as { enabled: boolean };
    r.on = body.enabled;
    await route.fulfill({ json: { enabled: r.on, changeAt: null } });
  });
  await page.route(/\/api\/v1\/maps\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    r.mapId = /[0-9a-f-]{36}$/.exec(route.request().url())?.[0] ?? r.mapId;
    return json(route, (j) => {
      j.map.computerMates = { enabled: r.on, changeAt: null };
      if (r.on) j.map.members = withMates(j.map.members);
    });
  });
  await page.route(/\/api\/v1\/maps$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return json(route, (j) => {
      r.mapId = j.map.id;
      j.map.computerMates = { enabled: r.on, changeAt: null };
    });
  });
  await page.route(/\/api\/v1\/maps\/[0-9a-f-]{36}\/view$/, async (route) =>
    json(route, (j) => {
      if (!r.on) return;
      j.members = withMates(j.members);
      const slots = new Map(j.members.map((m: Member) => [m.homeSlot, m.user.id] as const));
      for (const t of j.tiles) {
        const owner = t.homeSlot === null ? undefined : slots.get(t.homeSlot);
        if (owner && t.ownerUserId === null) t.ownerUserId = owner;
        if (r.claim && t.q === r.claim.q && t.r === r.claim.r) { t.ownerUserId = mateId(0); t.guardianHint = null; }
      }
    }),
  );
  await page.route(/\/api\/v1\/maps\/[0-9a-f-]{36}\/trades$/, async (route) => {
    if (route.request().method() !== 'GET' || !r.trades) return route.continue();
    return json(route, (j) => r.trades?.(j.trades));
  });
  await page.route(/\/api\/v1\/maps\/[0-9a-f-]{36}\/trades\/shelf\/00000000-0000-4000-8000-00000000038\d$/, async (route) => {
    if (!r.shelf) return route.continue();
    const id = /(00000000-[0-9a-f-]{27})$/.exec(route.request().url())?.[1];
    return route.fulfill({ json: { shelf: { ...r.shelf, userId: id } } });
  });
  await page.route(/\/api\/v1\/maps\/[0-9a-f-]{36}\/raids$/, async (route) => {
    if (!r.raids) return route.continue();
    return route.fulfill({ json: { report: r.raids } });
  });
  await page.route(/\/api\/v1\/maps\/[0-9a-f-]{36}\/challenges$/, async (route) => {
    if (route.request().method() !== 'POST' || !r.challenge) return route.continue();
    const body = route.request().postDataJSON() as { toUserId: string };
    await r.challenge.hold;
    const now = Date.now();
    return route.fulfill({
      json: {
        challenge: {
          id: uuid(1), kind: 'friendly', status: 'pending',
          fromUserId: r.me, toUserId: body.toUserId, fromTeamLevel: 1, toTeamLevel: 1,
          createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), battleId: null,
        },
      },
    });
  });
  return r;
}

/** Hides the dev badge and Sprout's tip, waits a beat, writes the original-size PNG. */
export async function snap(page: Page, name: string): Promise<void> {
  await page.addStyleTag({ content: '.dev-status,[data-testid="sprout-tip"]{display:none!important}' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${test.info().project.name}-${name}.png` });
}

/** An offer's lines that fall inside the fair band, from the shared value functions. */
export function fairLines(): { give: ValuedLine[]; want: ValuedLine[]; hearts: number } {
  const ids = ['stone', 'timber', 'greens', 'heart-charm'];
  let best: { give: ValuedLine[]; want: ValuedLine[]; hearts: number } | null = null;
  for (const a of ids) for (const b of ids) {
    if (a === b) continue;
    for (let qa = 1; qa <= 6; qa++) for (let qb = 1; qb <= 6; qb++) {
      const give: ValuedLine[] = [{ kind: 'item', itemId: a, quantity: qa }];
      const want: ValuedLine[] = [{ kind: 'item', itemId: b, quantity: qb }];
      const g = tradeValuer.sideValue(give);
      const w = tradeValuer.sideValue(want);
      const bal = tradeBalance(w, g);
      const hearts = heartsOf(g);
      if (bal.tip === 'even' && !bal.lopsided && (!best || hearts > best.hearts)) best = { give, want, hearts };
    }
  }
  expect(best, 'a fair pair of lines').not.toBeNull();
  return best!;
}
