# Heartpatch 🎃

A cozy, lightly spooky, invite-only multiplayer game about collecting, raising and evolving adorable **squishies**, building a home base where they thrive, and defending your territory from rival Keepers — and from the Hollow Man.

Made by **Pumpkin Patch Games**. Play (soon) at `play.pumpkinpatchgames.com`.

- Game design: [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)
- Technical spec: [`docs/TECH_SPEC.md`](docs/TECH_SPEC.md)
- Agent/contributor guide: [`CLAUDE.md`](CLAUDE.md)
- Roadmap: see the GitHub milestones (Phase 1: Halloween → Phase 2: Thanksgiving → Phase 3: Christmas)

Built with TypeScript, Babylon.js, Fastify and Postgres. Installable on iPhone and iPad as a web app.

## Development

Requires Node 22 (see `.nvmrc`) and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev          # server on :3000, client on :5173 (proxies /api to the server)
```

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests (Vitest) in every package |
| `pnpm test:e2e` | Playwright smoke test at iPhone and iPad sizes (WebKit) |
| `pnpm lint` / `pnpm typecheck` | ESLint (strict, type-aware) / TypeScript |
| `pnpm format` | Prettier (code and config; Markdown is excluded) |
| `pnpm build` | Builds shared, server and client |

Workspace packages are consumed from source via the `@heartpatch/source` export condition in dev, tests, typecheck and the client build (Vite bundles the source). The server's production build resolves `dist/`, so build shared first (`pnpm -r build` does this in order). See `apps/server/README.md`.

## Balance simulator

`pnpm sim` plays about 190,000 seeded AI-vs-AI battles with the real battle engine and AI stances, in a few seconds on one thread. It writes `reports/sim/balance-report.md` and `reports/sim/balance-report.csv` (git-ignored; `pnpm sim --out <dir>` to write elsewhere). It reads public and secret (server-only) data and never changes a table: it says what to tune, and people decide. The code lives in `packages/shared/scripts/sim/`, outside `src/`, so nothing in the game or the client bundle can import it. Settings (root seed, stances, levels, games per pairing and the flag thresholds) are in `scripts/sim/config.ts`.

Every battle is a 1v1 at matched levels, so a result points at one table:

| Section | Who fights | If it's flagged, tune |
|---|---|---|
| Base forms / Evolved forms | each species against every other species of its stage (base at level 12, evolved at 25), in every stance | that species' base stats or moves (`packages/shared/src/data/species.ts`, secret ones in `src/data/server/secret-species.ts`) |
| Elements | equal-stat stand-ins (average base stats, up to 4 of the element's public moves, the ones most base forms know), against other elements | the element matrix, or that element's moves |
| Feelings | the same stand-ins, against other feelings | the feeling matrix |
| Element × feeling combos | every combo against every other combo | the synergy table |
| Stances | every base form against itself, one stance against another (the second stance's rate is 100% minus the row's) | the AI stances (`BATTLE_RULES.ai`) |

How to read it:

- **Win rate** is wins plus half the draws, over every game in that row. Anything above 65% or below 35% is flagged (🔺 strong, 🔻 weak) and listed at the top, furthest from 50% first, with the table to tune.
- **Rarer squishies are meant to win a little more.** A legendary at 66% may be just right; a common at 66% probably isn't. The rarity column is there for that call.
- **Head-to-head pairs are never flagged.** Counters are by design (Fire beats Leaf almost every time at equal stats). They're in the CSV (`section` `pair`) and, for elements, the head-to-head matrix, for digging into why a row is flagged.
- **The same data gives the same report.** Seeds come from `deriveSeed(rootSeed, …)` and the report records the content hash, so two runs with different hashes are two versions of the data. Change `rootSeed` to check that a flag isn't luck.
- Teams of three and swaps aren't simulated yet: 1v1 keeps each result pointing at one table.
