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

Register the module's routes in `src/app.ts` under the `/api/v1` prefix. Pass dependencies (repos, readiness checks) in through `buildApp` options so tests can swap them.

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

- `buildApp` creates `authHooks` (`createAuthHooks` in `modules/auth/hooks.ts`). Pass `authHooks.requireAuth` into your module's routes factory and use it as the route's `preHandler`; it responds `UNAUTHENTICATED` when logged out. `authHooks.loadUser` is the same without the 401.
- In the handler, `requireUser(request)` returns the logged-in `PublicUser` (`{ id, username }`) and throws `UNAUTHENTICATED` if there isn't one.
- **CSRF:** every non-GET request under `/api/v1` must send `X-Requested-With: heartpatch`, or it gets `FORBIDDEN` (tech spec §5). The guard runs for every module; nothing to add per route.
- Password resets by a map owner (#4) go through `AuthRepo.resetPassword`, which revokes sessions and rotates the recovery code in one transaction.

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
