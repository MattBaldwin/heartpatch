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

| Command                        | What it does                                            |
| ------------------------------ | ------------------------------------------------------- |
| `pnpm test`                    | Unit tests (Vitest) in every package                    |
| `pnpm test:e2e`                | Playwright smoke test at iPhone and iPad sizes (WebKit) |
| `pnpm lint` / `pnpm typecheck` | ESLint (strict, type-aware) / TypeScript                |
| `pnpm format`                  | Prettier                                                |
| `pnpm build`                   | Builds shared, server and client                        |

Workspace packages are consumed from source in dev and tests (`@heartpatch/source` export condition) and from `dist/` in production builds.
