# @heartpatch/server

Fastify 5 app serving REST (`/api/v1`) and, later, WebSocket (`/ws`). Read `docs/TECH_SPEC.md` §5 and §7 first.

## Module shape

Every feature lives in `src/modules/<name>/` and copies `modules/health`:

| File | Job |
|---|---|
| `routes.ts` | HTTP only: zod schemas from `@heartpatch/shared`, call the service, send the result |
| `service.ts` | Game logic; calls `@heartpatch/shared` formulas; throws `AppError` with a shared code |
| `repo.ts` | The **only** place that touches Drizzle (lint-enforced) |
| `*.test.ts` | Tests via `buildApp()` + `app.inject()` |

Register the module's routes in `src/app.ts` under the `/api/v1` prefix. `buildApp({ config, db, clock })` takes the database and the clock (and readiness checks); modules build their repos from `db` inside `buildApp`, so it doesn't grow one option per repo. Tests pass a scratch `db` and a movable `clock`.

## Transactions across repos

Repo factories take an `Executor` (`Database | Transaction`, from `db/client.ts`). A command that writes through several repos runs them in **one** transaction. Services can't import `db/client` (lint), so a repo exposes `transaction`, which wraps `withTransaction` and hands back the repo on the transaction plus the `tx` for other modules' repos:

```ts
await mapsRepo.transaction(async (maps, tx) => {
  await maps.lockSeats(mapId);          // SELECT … FOR NO KEY UPDATE first
  await createAuthRepo(tx).resetPassword(...); // another module's repo, same transaction
  await maps.appendEvent({ mapId, type: 'member.joined', actorUserId, payload }); // last write
});
```

Services own the transaction (they decide the rules); repos stay plain queries. A repo method that opens its own `db.transaction` (e.g. `AuthRepo.resetPassword`) nests as a savepoint when built from `tx`. `modules/maps/service.ts` is the worked example, including lock order.

## Clock

Take time from the clock (`lib/time.ts`), never `new Date()` in services. `createClock(config)` is the real time, or with `HP_DEV_NOW` (development/test only; refused in production) a clock that starts at that instant and keeps ticking. `localDate(at, zone)` gives a map-local or account-local `YYYY-MM-DD`; `canonicalTimeZone` validates IANA zones.

## Patterns

- **Schemas:** declare `params`, `querystring`, `body` and **every response status you send** with zod (`fastify.withTypeProvider<ZodTypeProvider>()`). Responses are checked and unknown keys stripped on the way out, which keeps secret fields out of replies. A status without a schema is not stripped.
- **Query params:** use `queryInt`, `queryBool` and `queryArray` from `@heartpatch/shared`, not `z.coerce` (`?n=` would become `0`, and a single `?tag=a` arrives as a string).
- **Errors:** `throw new AppError('NOT_FOUND', 'kid-readable message')`. The error handler sends `{ error: { code, message } }` with the right status and never leaks internals, even on routes that declare schemas for error statuses.
- **Handlers:** return the value from a sync handler, or use an `async` handler when you need `reply.code(x).send(...)` (a sync `return reply.send()` doesn't typecheck with the type provider).
- **Logging:** `request.log` / `app.log` (pino). `console` is lint-banned here.
- **Randomness:** never `Math.random()`. Seeds come from `crypto.randomBytes` and feed the shared seeded RNG.

## Auth

Accounts live in `src/modules/auth` (issue #3). The session is the `hp_session` cookie (HttpOnly, SameSite=Lax, Secure in production, 30-day rolling expiry); only a SHA-256 hash of its token is stored in `sessions.token_hash`.

| Endpoint | Does |
|---|---|
| `POST /api/v1/auth/signup` | Family code + username + password + birth year + time zone → 201 `{ user, recoveryCode }`, logged in |
| `POST /api/v1/auth/login` | → `{ user }`, logged in |
| `POST /api/v1/auth/logout` | → 204, ends this device's session |
| `POST /api/v1/auth/recover` | Username + recovery code + new password → `{ user, recoveryCode }`; revokes every session, logs this device in, rotates the code |
| `GET /api/v1/me` | → `{ user }`, or `{ user: null }` when logged out (never 401) |

Signup, login and recover are rate limited per IP and per username (`modules/auth/limits.ts`).

**The contract for other modules** (keep it this small):

- `buildApp` creates `authHooks` (`createAuthHooks` in `modules/auth/hooks.ts`) inside its `if (db)` block. Register modules that need a logged-in player in that block, pass `authHooks.requireAuth` into your module's routes factory and use it as the route's `preHandler`; it responds `UNAUTHENTICATED` when logged out. `authHooks.loadUser` is the same without the 401.
- In the handler, `requireUser(request)` returns the logged-in `PublicUser` (`{ id, username }`) and throws `UNAUTHENTICATED` if there isn't one.
- **CSRF:** every non-GET request under `/api/v1` must send `X-Requested-With: heartpatch`, or it gets `FORBIDDEN` (tech spec §5). The guard runs for every module; nothing to add per route.
- Password resets by a map owner (#4) go through `AuthRepo.resetPassword`, which revokes sessions and rotates the recovery code in one transaction.

## Maps

Maps (players say "patches") live in `src/modules/maps` (issue #4; design doc §3, decisions B and D). Every route needs a logged-in player; non-members get `NOT_FOUND` so maps can't be probed, and members get `FORBIDDEN` for owner-only actions.

| Endpoint | Does |
|---|---|
| `GET /api/v1/maps` | → `{ maps, requests }`: my maps and my unanswered join requests |
| `POST /api/v1/maps` | Name + IANA zone → 201 `{ map }`. Generates the map once (`generateMap` for `max_players` seats, secret seed), stores every tile, gives the owner home slot 0, makes the first invite code, appends `map.created` — one transaction |
| `GET /api/v1/maps/:mapId` | → `{ map }` (members; `admin` with the code and pending requests for the owner) |
| `GET /api/v1/maps/:mapId/view` | → `MapView`: map, members and public tiles (no seed, no guardian strength) |
| `POST /api/v1/maps/join` | `{ code }` → 201 `{ request }` (200 with the existing one if already pending) |
| `POST /api/v1/maps/:mapId/invite` | Owner: a fresh code (7 days); the old one stops working |
| `POST /api/v1/maps/:mapId/invite/revoke` | Owner: → 204, no live code |
| `POST /api/v1/maps/:mapId/requests/:requestId/approve` | Owner: → 204. Under the seats lock: checks a free seat, gives the next free home slot, appends `member.joined` |
| `POST /api/v1/maps/:mapId/requests/:requestId/deny` | Owner: → 204 |
| `POST /api/v1/maps/:mapId/members/:userId/remove` | Owner: → 204. Archives the member, frees their tiles and home slot, appends `member.removed` |
| `POST /api/v1/maps/:mapId/leave` | Member (not the owner): → 204, `member.left` |
| `POST /api/v1/maps/:mapId/pvp-mode` | Owner: `{ pvpMode: on \| gentle \| off }`, appends `map.updated` when it changes |
| `POST /api/v1/maps/:mapId/members/:userId/reset-password` | Owner: → `{ user, temporaryPassword, recoveryCode }` (`no-store`), only if every multiplayer map the member is in is this owner's (decision D) |

**Seats:** `MAP_MAX_PLAYERS` (4). Commands that add or remove members take the per-map seats lock first (`lockSeats`: the owner's `map_members` row, `FOR NO KEY UPDATE`), so two approvals racing for the last seat can't both win; a partial unique index on `(map_id, home_slot)` for active members backs it up. **Tutorial gate:** with `HP_TUTORIAL_REQUIRED=true`, creating a map or asking to join needs `users.tutorial_completed_at`. Rate limits are in `modules/maps/limits.ts`.

**Text filter:** run every piece of player-typed text through `assertAllowedText(text, 'name' | 'message')` from `lib/filter.ts` before storing it (tech spec §9). It throws `VALIDATION_FAILED` with a kid-readable message. `checkText` returns the verdict without throwing.

**Operator reset** (tech spec §9): `docker compose exec server node dist/ops/reset-password.js <username>` (locally `pnpm --filter @heartpatch/server ops:reset-password <username>`) sets a temporary password, revokes sessions and prints a new recovery code. Never exposed over HTTP.

## Workspace source condition

`@heartpatch/shared` resolves to its TypeScript source under the `@heartpatch/source` export condition, and to `dist/` otherwise.

- `pnpm dev` and tests already pass the condition.
- **Any new `tsx` entrypoint** (seed scripts, ops tools) must pass `--conditions=@heartpatch/source`, or run after `pnpm -r build`.
- **Tools with their own loader** (e.g. drizzle-kit): keep their config and the DB schema free of `@heartpatch/shared` imports, or run them with `NODE_OPTIONS=--conditions=@heartpatch/source`.
- The production build (`pnpm build`) resolves `dist/`, so shared must be built first. `pnpm -r build` and `pnpm --filter @heartpatch/server... build` both do this in order.

## Config

Environment variables are parsed in `src/config.ts` (zod) and the server refuses to start on invalid values. `NODE_ENV` defaults to `production`; `pnpm dev` sets `development`. Keep `.env.example` current.

## Database

Postgres 16 via Drizzle. Schema, migrations, the `game_events` helper and the `db:*` scripts are documented in [`src/db/README.md`](src/db/README.md).
