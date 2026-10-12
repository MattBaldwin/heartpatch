// One building per tile (#295): a read-only dry run of the boot pass's
// tidy-up, for a copy of live data restored into a dev database (DEPLOY.md
// §8). It writes nothing.
//   docker compose exec server node dist/ops/tile-uses-check.js
// Locally: pnpm --filter @heartpatch/server tile-uses:check
//
// Prints one line per player the pass would change (what moves where, what
// comes down, which gatherers stop), then the totals. `--totals` prints only
// the totals line (no ids at all): the line the dry-run workflow posts on a PR.
import { parseArgs } from 'node:util';
import { pino } from 'pino';
import { loadConfig } from '../config.js';
import { createDbClient } from '../db/client.js';
import { listTileUseOwners, planOwnerTileUses, tidies } from '../modules/buildings/tile-uses.js';

const log = pino({ name: 'ops' });
// `allowPositionals`: `pnpm tile-uses:check -- --totals` passes a bare `--` along.
const { values } = parseArgs({
  allowPositionals: true,
  options: { totals: { type: 'boolean', default: false } },
});

const config = loadConfig();
const client = createDbClient(config.DATABASE_URL, { max: 1 });
try {
  const owners = await listTileUseOwners(client.db);
  let players = 0;
  let moved = 0;
  let packed = 0;
  let stopped = 0;
  const lines: string[] = [];
  for (const owner of owners) {
    const uses = await planOwnerTileUses(client.db, owner);
    if (!tidies(uses)) continue;
    const rows = new Map(uses.rows.map((r) => [r.id, r]));
    const tiles = new Map(uses.tiles.map((t) => [t.id, t]));
    const at = (t: { q: number; r: number } | undefined) =>
      t ? `(${String(t.q)},${String(t.r)})` : '(?)';
    players += 1;
    moved += uses.plan.move.length;
    packed += uses.plan.pack.length;
    stopped += uses.gatherers.length;
    lines.push(
      [
        `map ${owner.mapId} player ${owner.userId}:`,
        ...uses.plan.move.map((m) => {
          const row = rows.get(m.id);
          return `  move ${row?.buildingId ?? m.id} ${at(row)} -> ${at(tiles.get(m.toTileId))}`;
        }),
        ...uses.plan.pack.map((id) => {
          const row = rows.get(id);
          return `  pack ${row?.buildingId ?? id} ${at(row)} (everything back)`;
        }),
        ...uses.gatherers.map((id) => `  stop gatherer ${id}`),
      ].join('\n'),
    );
  }
  process.stdout.write(
    [
      ...(values.totals ? [] : lines),
      `tile-use dry run: ${String(owners.length)} players scanned, ${String(players)} would change: ` +
        `${String(moved)} moved, ${String(packed)} packed, ${String(stopped)} gatherers stopped.`,
      '',
    ].join('\n'),
  );
} catch (err) {
  log.fatal({ err }, 'tile-uses:check failed');
  process.exitCode = 1;
} finally {
  await client.close();
}
