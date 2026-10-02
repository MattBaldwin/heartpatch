# Heartpatch — Coordinator Playbook

> How the **supervisor (coordinator) session** runs the build: launching parallel build sessions, merging their PRs, and keeping the codebase consistent. Any supervisor session follows this file, so the process survives a handoff. Rules for build sessions live in `CLAUDE.md`; decisions and their reasons live in `docs/DECISIONS.md`.

Session tools (`create_session`, `send_message`, `archive_session`, `list_triggers`, `delete_trigger`) are claude-code-remote MCP tools; GitHub actions use the `mcp__github__*` tools. Load either with ToolSearch if they are deferred.

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

**Don't wait for pings.** On every `check_suite.completed` event, check for a verdict on the current head yourself: read the PR comments (`pull_request_read` → `get_comments`) for the build session's verdict comment naming that SHA. The "ready" ping is a convenience, not a dependency.

## 4. After a merge

- **Tell dependent sessions** what landed that affects them (new contracts, files they also touch). Use `send_message` with priority `next`; use `now` only for something blocking or urgent.
- **Check the other open PRs for conflicts** (`pull_request_read` → `get`, `mergeable_state: "dirty"`, or `git merge-tree` locally). A PR that conflicts with `main` runs **no** `pull_request` CI, so no `check_suite` event ever fires and its session can wait forever. Tell each conflicted session to merge `main` now.
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
| Exceptions named by the owner (currently: the #13 build session) | Fable |

**Keeping supervisor cost down:**
- Treat trivial wakes (subscription confirmations, merge echoes) as one-liners.
- Batch tool calls.
- Don't re-read large files.
- When the supervisor's context gets large (≈ 600K+ tokens), **hand off** to a fresh supervisor session (§8).

**Avoid mid-flight scope changes** unless they're blocking contracts. They roughly doubled one lane's cost (#6).

Report usage to the owner when asked, and flag any lane above about $20 (except #13: about $30, see §9). A typical phase-1 lane cost $5–12; read per-session cost from `get_session`.

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

1. Wait until the build sessions this supervisor started have merged, or hand them over explicitly: send each one the new supervisor's session id to report to, and subscribe the new supervisor to their PRs. Their `@parent` reports and PR subscriptions belong to the session that started them.
2. Make sure everything durable is in the repo: DECISIONS.md, this playbook, and the briefs' carry-over notes (§9).
3. Start the new supervisor with a compact prompt:
   - read this playbook, CLAUDE.md and DECISIONS.md;
   - current `main` state, open PRs and sessions;
   - the queued follow-ups (§9);
   - the next batch to launch.
4. Retire the old session (rename it "(retired)"). Don't archive it until the owner says so. (Build sessions are archived after merge, per §4; supervisor sessions are not.)

## 9. Open follow-ups for upcoming briefs

The supervisor keeps this list current. Remove items as they land.

- **In flight (batch 7, all Opus):**
  - #43 wardrobe, PR #78 (session_0128FWWezZzy46QQHXWn3YgT): must merge main (#18 + #15) and regenerate its migration after 0009.
  - #19 care/XP, PR #81 (session_01N3QHczH14p3onN2fbzG4Ww): owns a shared `applyXp` that every battle kind calls; care coins go only in the `squishy.cared` payload (`coin_ledger` is #45's).
  - #21 Hollow Man (session_0153wdmXfxfmoWPzjjKoAZfB): uses `litSafeTiles`/`protectsNight` (#18) and `isOnWatch` (#15); `hollow_events` keeps nightfall idempotent.
- **Next, by dependency:**
  - #10 roster: after #43 merges, because content issues run one at a time. Adds spawn rows to #14's tables.
  - #16 raid AI: replaces #15's `defendingSide` choice and adds the raid log.
  - #20 close-up view: after #19.
  - #12 sim: after #10.
  - Fillers: #25 audio and #23 quick messages (check #22 is really done).
- **Briefs:** follow §7, plus:
  - reporting with the fallback trigger;
  - neither sessions nor the supervisor can re-run CI (403), so a flaky test gets a robustness fix in the PR, never a skip;
  - e2e players must pick a Keeper (`HP_KEEPER_REQUIRED`).
  - Name tables exactly as TECH_SPEC §4's core table list. #17 cost a mid-flight rename because a brief invented names.
- **Merge order and churn:**
  - Every PR adds a migration, so later PRs regenerate theirs after each merge.
  - Hold lanes that edit the same files (battles module, spawn tables) rather than run them in parallel. Lanes that started on a current main and never re-merged were the cheapest (#18 $25.77, #15 $23.11, #42 $23.57).
- **Lock order** on main: member row, seats, player, tiles, buildings, then maps. New code must follow it.
- **Test robustness:**
  - `keeper-gallery.spec.ts` ignores Babylon's shader-fallback console noise (headless WebKit has no GPU). Check a real iPad for the fallback during #28.
  - `keeper.spec` timed out once under a full local run.
  - #9's `squishy-gallery.spec.ts:168` (jiggle to idle) should wait on a signal, not on timing.
  - The auth login rate-limit test runs about 2.6 s against a 5 s timeout: raise the timeout, or lower the Argon2 cost in tests.
- **Docs drift:**
  - TECH_SPEC §8 asks for a shared `spawnWindowId`; #14 put `spawnWindowFor` in server `lib/time.ts`.
  - TECH_SPEC §2 layout; §10 `SESSION_SECRET` (unused); §6 "short benchmark" versus the continuous quality governor (#6).
  - Possibly closed but still open on GitHub: #5 and #22. Confirm and close.
- **Earlier follow-ups still open:**
  - #9: count real draw calls in the "flat draw calls" e2e; NullEngine tests for `SquishyField.move` and `remove`; partial buffer updates; rebase `squishTime`; forward part taps to the body; the crypto ban misses `globalThis.crypto`.
  - #7: a FORBIDDEN resync for map A while the player opens map B lands them in the lobby; a doc comment on `generation`.
  - #47: start, replay and skip each have their own limiter; add a live wake-up delivery check.
  - #27 deploy: `restore.sh` should re-allow connections on a leftover `heartpatch_restore`; add a `/ws` check to `local-smoke.sh`.
  - Server hardening: shared `lib/rate-limit.ts`, a loose global per-IP limit, helmet/CSP or a note that Caddy sets the headers.
  - The avoided-words scan over error messages.
  - Each merged PR's "Coordinator notes" list that lane's own follow-ups.
- **Cost so far (USD):**
  - Batch 6: #13 48.88, #42 23.57, #17 36.72, #14 43.98.
  - Batch 7 so far: #18 25.77, #15 23.11.
  - Supervisor 3: about 28.
  - Big lanes run $25–50; flag above about $35.
- **Owner questions queued:**
  - How a player gets their first squishy (recommended: a free starter in each new patch, replaced by the tutorial's Partner later).
  - Wild-battle XP farming: a beaten-but-not-captured squishy can be fought again all window. Recommended: it leaves after a win, or repeat wins give no XP.
  - Whether a squishy can live in a habitat and stand watch at the same time.
  - Jack-o'-Lantern questions in PR #79.
  - Guardians in the tile panel.
  - Confirm the four #4 decisions; confirm or revert the 4-round review cap.
  - OK for the DECISIONS merge Chore.
  - AWS: Matt chose the new AWS experience ("project"), Region us-east-2, profile `heartpatch`. The CLI is installed in supervisor 3's container only. Remote `aws login` was started but the code never arrived. Restart with `aws login --remote --region us-east-2 --profile heartpatch` when he's ready. Agent Toolkit rules go in an uncommitted `CLAUDE.local.md` (his choice). Check Lightsail is available on the new experience, and update DEPLOY.md step 1 for projects (spend limits in AWS Settings rather than root MFA and budgets).
