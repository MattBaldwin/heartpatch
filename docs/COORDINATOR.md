# Heartpatch — Coordinator Playbook

> How the **supervisor (coordinator) session** runs the build: launching parallel build sessions, merging their PRs, and keeping the codebase consistent. Any supervisor session follows this file, so the process survives a handoff. Rules for build sessions live in `CLAUDE.md`; decisions and their reasons live in `docs/DECISIONS.md`.

## 1. Roles

- **Project owner (Matt):** makes product and design calls, provides accounts (AWS, GoDaddy, GitHub secrets), and approves anything that changes a decision.
- **Supervisor:** plans batches from the issue dependency graph, writes briefs, starts build sessions, runs the merge gates, merges, audits for drift, and escalates owner decisions. It doesn't write feature code, except small `Chore:`/`Docs:`/`Fix:` PRs and taking over a stuck lane.
- **Build session:** one issue, one lane, one PR. It runs its own reviewer loop and reports milestones (CLAUDE.md, "Report to the coordinator"). It never merges.
- **Reviewer subagent** (`.claude/agents/reviewer.md`): independent, read-only, runs every check itself.

## 2. Launching a build session

1. **Pick work** whose "Depends on" issues are merged. Run issues in parallel only when they touch separate folders. Contract-defining work merges before the work that consumes it.
2. **Write the brief** from the template in §7. Every brief includes:
   - the reporting block
   - lane **Owns / Must not change**
   - concrete files on `main` to copy
   - the decisions that apply (DECISIONS.md entries by name)
   - issue-specific guidance
   - build checks, PR rules, and a review loop capped at 4 rounds
3. **Start it** with `create_session` (source = repo, `outcome_branch` = `issue-<n>-<slug>`, tags `heartpatch:phase-1` and `heartpatch:batch-<k>`). Pick the model per §6.
4. **Subscribe** to the PR as soon as the session reports `PR #<n> opened`.

## 3. Merge gates (all required)

1. A reviewer **APPROVE** verdict comment for the **current head** commit.
2. **CI green** on that same commit.
3. **Cross-PR pass (supervisor):** read the diff against `main` and the other open PRs. Look for lane violations, duplicate helpers, a second way of doing something, naming, and contract changes nobody flagged.
4. **Decision compliance:** the PR follows every DECISIONS.md entry that applies to it. Spot-check the code, not just the PR body.
5. **Base is current:** if `main` moved in a way that could interact, the branch has merged `main` and CI is green again.

Merge with **squash**, passing `expectedHeadSha`. Post or confirm the verdict comment.

**Don't wait for pings.** On every `check_suite.completed` event, check for a verdict on the current head yourself. The "ready" ping is a convenience, not a dependency.

## 4. After a merge

- **Tell dependent sessions** what landed that affects them (new contracts, files they also touch). Use `send_message` with priority `next`; use `now` only for something blocking or urgent.
- **Archive the finished session** (owner-approved). Before archiving, delete its self-scheduled "Re-check PR" triggers (`list_triggers`, filter by `persistent_session_id`).
- **Start what the merge unblocked.**
- **Drift audit after each batch:** run a fresh read-only auditor over `main`. It looks for duplicate implementations, pattern drift, code vs docs, secret data reachable from the client, and contracts the next batch will need. Turn findings into:
  - a small `Chore:`/`Docs:` PR,
  - plus a lint rule or doc change so the drift can't recur,
  - and notes for the briefs of upcoming issues.

## 5. Watching sessions

**A session is stuck if any of these is true:**
- the same check fails on 3 consecutive pushes;
- more than 4 review rounds without APPROVE;
- no new commit in about 40 minutes while it shows as working;
- its cost is more than about 3× a typical lane with no green CI in sight.

**When stuck:** read its recent actions, then send a specific fix or narrow its scope. If that fails, stop it and take over or restart with a tighter brief. Scope changes beyond existing decisions go to the owner.

**Sessions can't run WebKit** (only CI can). Client e2e tests assert on the game's own signals (counters, state), never pixel-exact screenshots.

**Don't schedule check-ins to poll sessions** (owner decision). Rely on reports, GitHub events, and session-failure notifications.

## 6. Usage and models (owner decision)

| Work | Model |
|---|---|
| Build sessions that write code; reviewers on code PRs | Opus (strongest) |
| Docs-only PR reviews, drift audits, simple content/docs sessions | Sonnet 5.5 |

**Keeping supervisor cost down:**
- Treat trivial wakes (subscription confirmations, merge echoes) as one-liners.
- Batch tool calls.
- Don't re-read large files.
- When the supervisor's context gets large (≈ 600K+ tokens), **hand off** to a fresh supervisor session (§8).

**Avoid mid-flight scope changes** unless they're blocking contracts. They roughly doubled one lane's cost (#6).

Report usage to the owner when asked, and flag any lane above about $20.

## 7. Brief template

```
You are a Heartpatch build session working on GitHub issue #{N}: "{TITLE}" in mattbaldwin/heartpatch.
A coordinator session assigned this to you and will merge your PR. Other sessions are working in
parallel right now ({PARALLEL}), so stay inside your lane.

## Reporting (required by the project owner; part of this task)
Follow "Report to the coordinator" in CLAUDE.md: send_message to "@parent" with one line:
`#{N} PR #<n> opened` / `#{N} PR #<n> ready: reviewer APPROVE, CI green on <sha>` (only once CI is
green on your final head) / `#{N} blocked: <one line>` / `#{N} CI red on <sha>: <check>, fixing`.
Subscribe to your own PR (subscribe_pr_activity) so CI results wake you.

## Before writing code
Read CLAUDE.md, the relevant GAME_DESIGN/TECH_SPEC sections, STYLE_GUIDE, DECISIONS (name the
entries), apps/server/README.md. Read the issue. Copy these files on main: {CONCRETE FILES}.

## Your lane
- Owns: {OWNS}
- Must not change: {NOT}
- Shared-contract changes: don't; report `#{N} blocked:` instead.

## Issue-specific guidance
{GUIDANCE, including applicable decisions, audit carry-overs from the coordinator notes}

## Build
Branch issue-{N}-{slug} from latest origin/main. Before every push: pnpm format:check && pnpm lint
&& pnpm typecheck && pnpm test && pnpm build (+ PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium
pnpm test:e2e if client). DB tests: DATABASE_URL against local Postgres 16.

## Pull request
Title `#{N}: <summary>`, `Closes #{N}` (or `Part of #{N}` + what remains), deps with reasons,
"How to test on iPhone" for client work, "Coordinator notes".

## Review loop
Reviewer subagent until APPROVE; fresh reviewer each round; at most 4 rounds, then report blocked.
Post the verdict comment summarizing each round. Don't merge.
```

## 8. Supervisor handoff

1. Wait until the build sessions this supervisor started have merged, or hand them over explicitly. Their `@parent` reports and PR subscriptions belong to the session that started them.
2. Make sure everything durable is in the repo: DECISIONS.md, this playbook, and the briefs' carry-over notes (§9).
3. Start the new supervisor with a compact prompt:
   - read this playbook, CLAUDE.md and DECISIONS.md;
   - current `main` state, open PRs and sessions;
   - the queued follow-ups (§9);
   - the next batch to launch.
4. Retire the old session (rename it "(retired)"). Don't archive it until the owner says so.

## 9. Open follow-ups for upcoming briefs

The supervisor keeps this list current. Remove items as they land.

- **Before #10 (roster):** secret species and forms need a server-only home. Add `secretSpecies`/`secretEvolutions` to `ServerGameDataSchema`; check references against public + secret data; ban `rarity: 'secret'` in the public table; add a `serverBattleData` merge; extend the boundary test.
- **#9 (squishy generator):**
  - a `BODIES`/`PARTS` id registry with `checkGameData` references (before #10 writes content);
  - the renderer takes `(species, instanceId)`, with variation seeded by `instanceId`;
  - `Math.random` is banned in `apps/client/src/procedural/`;
  - e2e tests assert on signals, not pixels.
- **#7 (hex map render):**
  - add `hexToWorld(hex, size) → {x, z}` (north = +z) in shared `hex/`;
  - render from `PublicTileSchema`/`MapViewSchema` (#4);
  - the client REST client is `apps/client/src/net/api.ts`.
- **#13/#14 (battles, spawns):**
  - add a zod `ClientBattleViewSchema`;
  - map `BattleRuleError` → `AppError`;
  - a content-hash mismatch mid-battle ends it as "no contest" and refunds the attempt;
  - add an `idempotency_keys` table plus a preHandler in `lib/`;
  - a `speciesDefs` field for species the client hasn't been sent;
  - battle seeds from `newSeed()` (revealable); spawn seeds from `deriveSeed(mapSeed, 'spawn', q, r, windowId)` (never revealed);
  - add a shared `spawnWindowId` helper with DST tests.
- **#19 (care):**
  - put `careRules` (`fullActionsPerDay`, falloff, `dailyCoinCap`) in data;
  - shorten the anti-spam cooldowns, or justify the long ones;
  - the day boundary is the account time zone.
- **#47 (tutorial framework):**
  - a `HighlightTargetSchema` enum;
  - `event_consumers` + pg-boss, with the consumer wake-up enqueued inside the command's transaction via `appendGameEvent`.
- **Server hardening** (small PR, or with #27):
  - shared `lib/rate-limit.ts`;
  - a loose global per-IP limit;
  - helmet/CSP, or note that Caddy sets the headers.
- **Tests:** run the avoided-words scan over error messages, auth/filter messages and client UI strings.
- **Docs drift:**
  - TECH_SPEC §2 layout (module `schemas.ts`, `lib/time`, `formulas/` home);
  - §10 `SESSION_SECRET` (unused);
  - the `(state, action, seed)` wording in CLAUDE.md/GAME_DESIGN, versus RNG-in-state (DECISIONS "Battle engine (#11)").
- **Owner FYI:** #11 resolved a design ambiguity: synergy multiplies damage once, for the attacker, not stats too.
