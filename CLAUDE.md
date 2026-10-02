# CLAUDE.md — Heartpatch

Heartpatch is a cozy, lightly spooky, invite-only multiplayer squishy-collecting game for ages 10–17, played mainly on iPhone and iPad as an installable web app (PWA) at `play.pumpkinpatchgames.com`.

**Read `docs/GAME_DESIGN.md`, `docs/TECH_SPEC.md`, `docs/STYLE_GUIDE.md` and `docs/DECISIONS.md` before starting any issue.** The design doc is the source of truth for game rules; the tech spec is the source of truth for repo layout, libraries, API/WebSocket conventions, data model, infrastructure (AWS Lightsail) and CI/CD. If an issue and the design doc disagree, flag it in the PR rather than guessing.

## Tech stack (decided — don't swap without asking)

- **Language:** TypeScript everywhere, `strict: true`.
- **Monorepo:** pnpm workspaces.
  - `apps/client` — Vite + **Babylon.js** (WebGPU primary, automatic WebGL2 fallback). Touch-first UI.
  - `apps/server` — Node 22 LTS, **Fastify** (REST + WebSocket via `@fastify/websocket`). **Colyseus** is added in Phase 2 for live battle rooms.
  - `packages/shared` — game data tables, types, zod schemas, the battle engine, formulas. Pure and deterministic; no I/O.
- **Database:** Postgres 16, **Drizzle ORM** with versioned migrations.
- **Validation:** zod at every API boundary.
- **Tests:** Vitest (unit), Playwright (e2e smoke, mobile Safari viewport).
- **Auth:** username + password, Argon2id (`argon2` package), session cookies.
- **Deploy:** Docker + docker compose on an AWS Lightsail Ubuntu instance, **Caddy** reverse proxy for automatic HTTPS. GitHub Actions deploys on merge to `main`.

## Architecture rules

1. **Server-authoritative.** The client sends intents (commands); the server validates and applies them. Never trust client-computed outcomes, prices, damage, timers or filters.
2. **Shared logic lives in `packages/shared`** and is imported by both client and server so rules can't drift.
3. **Deterministic battles.** The battle engine is a pure reducer `(state, action, seed) → newState` with a seeded RNG. Log seed + actions so any battle can be replayed.
4. **Timestamps, not ticking loops.** Timers (gathering, training, care decay, hatching) are stored as timestamps and resolved lazily on read or on scheduled jobs. Idle entities cost nothing.
5. **Data-driven content.** Species, moves, matrices, buildings, recipes, seasons, spawn tables and Easter-egg triggers are JSON/TS data in `packages/shared/data`, validated by zod. Adding content should not require engine code changes.
6. **Secrets stay server-side.** Easter-egg conditions, rare-spawn rules and evolution weights are never sent to the client.
7. **Atomic economy.** Anything that moves squishies or resources between players runs in a single DB transaction.
8. **Mobile performance budget.** Target 60 fps on a recent iPhone, never below 30 on an older iPad. Cap DPR at 2, use instancing, LODs, KTX2 textures, dynamic resolution scaling. Never let the game look pixelated.
9. **Kid safety.** Minimal personal data (no email). All user text (usernames, chat, nicknames) passes the server-side filter. No real-money purchases.

## Conventions

- Small, focused PRs, one issue per PR, titled `#<issue>: <summary>`. Link the issue with `Closes #N`. PRs not tied to an issue (docs, process, drift fixes) use a `Docs:`, `Chore:` or `Fix:` prefix instead.
- Include tests for all shared logic and server endpoints. Include a short "How to test on iPhone" note in PRs that touch the client.
- Keep tunable numbers in data config, not code. Mark guesses with a `// TUNE:` comment.
- **File names are kebab-case** (`game-events.ts`, `create-scene.test.ts`); identifiers inside stay camelCase/PascalCase. `pnpm lint` enforces it.
- Use `pnpm` scripts from the repo root: `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`.
- Don't add heavy dependencies without noting why in the PR.
- Art is procedural (vinyl-toy style, see design doc §19). Don't import copyrighted characters or assets. Any third-party asset must be CC0 or clearly licensed for commercial use; record it in `ASSETS.md`.

## Workflow (every session)

- **Branch from the latest `main`.** Stay inside the folders your issue owns. If you need to change a shared contract (`game_events` types, error codes, WS envelope, hex coords, data schemas, the core DB tables), stop and flag it to the coordinator instead of changing it yourself.
- **Follow the patterns already on `main`**, not just the docs. If something already has an established way (module shape, errors, logging, tests, naming), use it. A second way of doing the same thing is drift.
- **Player-facing text** follows `docs/STYLE_GUIDE.md`: cozy, cute, playful, funny, short, kid-readable.
- **Before handing off:** run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` and make them pass. Regenerate DB migrations on the latest `main` before merge (tech spec §4).
- **Review:** every PR is reviewed by the `reviewer` subagent (`.claude/agents/reviewer.md`). Address each finding with a fix or evidence; a fresh reviewer re-reviews. Points still contested after 3 rounds go to the project owner. Once the reviewer approves and CI is green, the coordinator merges and posts the verdict as a PR comment.
- Decisions already made are recorded in `docs/DECISIONS.md`. Don't re-open them; add new ones there.

## Milestones

- **Phase 1: Halloween** — first playable, due Oct 31, 2026.
- **Phase 2: Thanksgiving**
- **Phase 3: Christmas**

Work issues in dependency order (each issue lists "Depends on").
